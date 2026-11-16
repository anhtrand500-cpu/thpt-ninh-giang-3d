// Máy chủ nhiều người chơi chạy trên Cloudflare Workers (gói Free).
// - Worker: phục vụ file tĩnh trong public/, chuyển /api/* vào Durable Object.
// - SchoolRoom (Durable Object, SQLite): một "sân trường" chung — WebSocket realtime + sổ lưu bút.
//   Dùng WebSocket Hibernation API để không tốn thời gian chạy khi mọi người đứng yên.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 500; // Workers Paid — giới hạn phòng san-truong (giảm tải)
const STALE_MS = 45 * 60_000; // đứng yên / tab nền — không quét đá khỏi phòng (chấp nhận lag hơn là disconnect)
const GHOST_MS = 8 * 60_000;  // socket chưa hello xong quá lâu → dọn
const SWEEP_MS = 5 * 60_000;  // quét nhẹ, tránh giật khi đông người
const NOTE_COOLDOWN_MS = 30_000;
const CHAT_COOLDOWN_MS = 1_200;
const ACT_COOLDOWN_MS = 5_000;
const CLASS_MSG_KEEP = 300; // số tin nhắn lưu lại mỗi lớp
const NEAR_CHAT_M = 15;      // chat sân chỉ tới người trong bán kính này
const TALK_RANGE_M = 6;      // phải đứng gần mới mời trò chuyện được
const TALK_REQ_MS = 30_000;  // lời mời hết hạn sau 30 giây
const VIEW_M = 72;           // đồng bộ vị trí gần — đủ rộng cho sân + hành lang nhà chính
const SNAP_MS = 2400;
const MV_MAX_PER_S = 12;

// Mã lớp = tên lớp + năm nhập học, ví dụ 12A1-2011 (dùng làm link mời ?lop=12A1-2011).
function classCode(className, year) {
  const c = String(className ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  const y = String(year ?? '');
  if (!/^\d{1,2}[A-Z]{1,2}\d{0,2}$/.test(c) || !/^\d{4}$/.test(y) || +y < 1961 || +y > 2100) return null;
  return `${c}-${y}`;
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : 0));

function cleanProfile(p = {}) {
  return {
    role: p.role === 'teacher' ? 'teacher' : 'student',
    gender: p.gender === 'female' ? 'female' : 'male',
    season: p.season === 'winter' ? 'winter' : 'summer',
    style: p.style === 'somi' ? 'somi' : 'aodai',
    name: clean(p.name, 25) || 'Khách',
    className: clean(p.className, 8).toUpperCase(),
    year: /^\d{4}$/.test(String(p.year)) ? String(p.year) : '',
    subject: clean(p.subject, 12),
  };
}

// [x, y, z, hướng, tốc độ, tư thế?] — làm tròn cho gói tin nhỏ (tư thế: 0 đứng, 1 ngồi, 2 nằm, 3 nhảy múa).
function cleanPos(p) {
  if (!Array.isArray(p)) return null;
  const r = v => Math.round(v * 100) / 100;
  const out = [r(clamp(p[0], -100, 100)), r(clamp(p[1], 0, 20)), r(clamp(p[2], -40, 60)), r(clamp(p[3], -10, 10)), r(clamp(p[4], 0, 10))];
  if (p.length > 5 && p[5] != null) out[5] = clamp(Math.round(p[5]), 0, 3);
  return out;
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs((a[1] || 0) - (b[1] || 0));
}

// Ngày theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD.
function dayVN(ts) {
  return new Date(ts + 7 * 3600_000).toISOString().slice(0, 10);
}

function displayName(p) {
  return (p.role === 'teacher' ? (p.gender === 'female' ? 'Cô ' : 'Thầy ') : '') + p.name;
}

function profileInfo(p) {
  return p.role === 'teacher' ? `GV ${p.subject}` : `Lớp ${p.className} · ${p.year}–${+p.year + 3}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await env.ROOM.get(env.ROOM.idFromName('san-truong')).fetch(request);
      } catch (e) {
        const msg = String(e?.message || e);
        if (url.pathname === '/api/ws') {
          return new Response(msg.includes('free tier') ? 'Sân chung tạm quá tải (hạn mức Cloudflare)' : 'Máy chủ tạm lỗi', { status: 503 });
        }
        return Response.json({ error: 'room_unavailable', detail: msg.slice(0, 120) }, { status: 503 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};

export class SchoolRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, info TEXT, text TEXT, ts INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS classes (
      code TEXT PRIMARY KEY, class_name TEXT, year TEXT, created_by TEXT, ts INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS class_msgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, info TEXT, text TEXT, ts INTEGER)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS class_msgs_code ON class_msgs (code, id)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      player_key TEXT PRIMARY KEY, name TEXT, info TEXT, pages INTEGER NOT NULL DEFAULT 0,
      notes INTEGER NOT NULL DEFAULT 0, ts INTEGER)`);
    // Thống kê: mỗi người (tên+lớp) lần đầu/lần cuối vào, số lượt vào; và số lượt vào theo ngày.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seen (
      player_key TEXT PRIMARY KEY, name TEXT, info TEXT, role TEXT, first_ts INTEGER, last_ts INTEGER, visits INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS visits (day TEXT PRIMARY KEY, conns INTEGER NOT NULL DEFAULT 0)');
    // Trả lời "ping" mà không đánh thức object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.state = new Map(); // WebSocket -> trạng thái (dựng lại từ attachment sau khi ngủ đông)
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null && ctx.getWebSockets().length) await ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    });
  }

  // Quét định kỳ: đóng các socket không còn hoạt động (client tắt đột ngột, không gửi close).
  async alarm() {
    this.sweep();
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  lastSeen(ws, s) {
    const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
    return Math.max(s.openedAt || 0, s.savedAt || 0, s.seenAt || 0, auto ? auto.getTime() : 0);
  }

  sweep(now = Date.now()) {
    let closed = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const s = this.get(ws);
      const idle = now - this.lastSeen(ws, s);
      if (s.left) {
        this.leave(ws);
        try { ws.close(1000, 'bye'); } catch { /* đã đóng */ }
        closed++;
        continue;
      }
      if (!s.profile && idle > GHOST_MS) {
        try { ws.close(1000, 'ghost'); } catch { /* đã đóng */ }
        closed++;
        continue;
      }
      if (s.profile && idle > STALE_MS) {
        this.leave(ws);
        try { ws.close(1001, 'stale'); } catch { /* đã đóng */ }
        closed++;
      }
    }
    return closed;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/guestbook') return Response.json(this.recentNotes(60));
    if (url.pathname === '/api/leaderboard') {
      const rows = this.sql.exec(
        'SELECT name, info, pages, notes FROM scores ORDER BY pages DESC, notes DESC, ts ASC LIMIT 30',
      ).toArray();
      return Response.json(rows);
    }
    if (url.pathname === '/api/stats') {
      const one = (q, ...a) => Object.values(this.sql.exec(q, ...a).one())[0];
      const today = dayVN(Date.now());
      return Response.json({
        online: this.players().length,
        nguoi_da_vao: one('SELECT COUNT(*) FROM seen'),
        nguoi_da_vao_hoc_sinh: one("SELECT COUNT(*) FROM seen WHERE role = 'student'"),
        nguoi_da_vao_giao_vien: one("SELECT COUNT(*) FROM seen WHERE role = 'teacher'"),
        nguoi_vao_hom_nay: one('SELECT COUNT(*) FROM seen WHERE last_ts >= ?', Date.parse(today + 'T00:00:00+07:00')),
        luot_vao_tong: one('SELECT COALESCE(SUM(conns), 0) FROM visits'),
        luot_vao_theo_ngay: this.sql.exec('SELECT day, conns FROM visits ORDER BY day DESC LIMIT 30').toArray(),
        nguoi_co_diem: one('SELECT COUNT(*) FROM scores'),
        nguoi_du_10_trang: one('SELECT COUNT(*) FROM scores WHERE pages >= 10'),
        luu_but: one('SELECT COUNT(*) FROM notes'),
        nguoi_viet_luu_but: one('SELECT COUNT(DISTINCT name) FROM notes'),
        lop_da_tao: one('SELECT COUNT(*) FROM classes'),
        tin_nhan_lop: one('SELECT COUNT(*) FROM class_msgs'),
        nien_khoa: this.sql.exec("SELECT substr(info, instr(info, '·') + 2, 4) AS nam, COUNT(*) AS n FROM scores WHERE info LIKE 'Lớp %' GROUP BY nam ORDER BY n DESC LIMIT 15").toArray(),
        ghi_chu: 'nguoi_da_vao / luot_vao chỉ đếm từ lúc bản này được deploy; nguoi_co_diem là tổng người chơi từ trước tới nay.',
      });
    }
    if (url.pathname === '/api/online') {
      const swept = this.sweep();
      if (url.searchParams.get('thongke') !== '1') {
        return Response.json({ online: this.players().length, swept });
      }
      const one = (q, ...a) => Object.values(this.sql.exec(q, ...a).one())[0];
      const today = dayVN(Date.now());
      return Response.json({
        online: this.players().length,
        swept,
        nguoi_da_vao: one('SELECT COUNT(*) FROM seen'),
        nguoi_da_vao_hoc_sinh: one("SELECT COUNT(*) FROM seen WHERE role = 'student'"),
        nguoi_da_vao_giao_vien: one("SELECT COUNT(*) FROM seen WHERE role = 'teacher'"),
        nguoi_vao_hom_nay: one('SELECT COUNT(*) FROM seen WHERE last_ts >= ?', Date.parse(today + 'T00:00:00+07:00')),
        luot_vao_tong: one('SELECT COALESCE(SUM(conns), 0) FROM visits'),
        luot_vao_theo_ngay: this.sql.exec('SELECT day, conns FROM visits ORDER BY day DESC LIMIT 30').toArray(),
        nguoi_co_diem: one('SELECT COUNT(*) FROM scores'),
        nguoi_du_10_trang: one('SELECT COUNT(*) FROM scores WHERE pages >= 10'),
        luu_but: one('SELECT COUNT(*) FROM notes'),
        nguoi_viet_luu_but: one('SELECT COUNT(DISTINCT name) FROM notes'),
        lop_da_tao: one('SELECT COUNT(*) FROM classes'),
        tin_nhan_lop: one('SELECT COUNT(*) FROM class_msgs'),
        ghi_chu: 'Không có đăng ký tài khoản — đếm theo hồ sơ (tên+lớp) khi vào sân online. seen/visits chỉ từ bản có thống kê.',
      });
    }
    if (url.pathname === '/api/class') {
      const c = this.classInfo(url.searchParams.get('code'));
      return c ? Response.json({ ...c, online: this.classMembers(c.code).length }) : Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (url.pathname !== '/api/ws') return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (this.onlineCount() >= MAX_PLAYERS) {
      this.sweep();
      if (this.onlineCount() >= MAX_PLAYERS) return new Response('Sân trường đang quá đông', { status: 503 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const s = { id: Math.floor(Math.random() * 2 ** 31), profile: null, p: [0, 0, 48, Math.PI, 0], savedAt: 0, openedAt: Date.now(), yardChatAt: 0, classChatAt: 0, talkAt: 0, noteAt: 0, actAt: 0, win: 0, winN: 0 };
    server.serializeAttachment(s);
    this.state.set(server, s);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  get(ws) {
    let s = this.state.get(ws);
    if (!s) {
      s = ws.deserializeAttachment() || {};
      this.state.set(ws, s);
    }
    return s;
  }

  save(ws, s) {
    s.savedAt = Date.now();
    ws.serializeAttachment(s);
  }

  players(exceptId) {
    return this.ctx.getWebSockets().map(ws => this.get(ws)).filter(s => s.profile && s.id !== exceptId);
  }

  onlineCount() {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) if (this.get(ws).profile) n++;
    return n;
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const s = this.get(ws);
      if (!s.profile || s.id === exceptId) continue;
      try { ws.send(data); } catch { /* socket đang đóng */ }
    }
  }

  /** Chỉ gửi tới client đứng gần điểm `fromP` — giảm tải khi sân đông. */
  broadcastNear(msg, fromP, exceptId) {
    const data = JSON.stringify(msg);
    const anchor = fromP || [0, 0, 0];
    for (const [ws, o] of this.sockets()) {
      if (!o.profile || o.id === exceptId) continue;
      if (dist(o.p, anchor) > VIEW_M) continue;
      try { ws.send(data); } catch { /* socket đang đóng */ }
    }
  }

  classInfo(code) {
    const row = this.sql.exec('SELECT code, class_name AS className, year, created_by AS createdBy FROM classes WHERE code = ?', String(code ?? '')).toArray()[0];
    return row || null;
  }

  classMembers(code, exceptId) {
    return this.players(exceptId).filter(x => x.cls === code).map(x => ({ id: x.id, name: displayName(x.profile), info: profileInfo(x.profile) }));
  }

  classHistory(code) {
    return this.sql.exec('SELECT id, name, info, text, ts FROM class_msgs WHERE code = ? ORDER BY id DESC LIMIT 60', code).toArray().reverse();
  }

  sendToClass(code, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const s = this.get(ws);
      if (s.profile && s.cls === code) try { ws.send(data); } catch { /* socket đang đóng */ }
    }
  }

  ensureClassRow(code, createdBy, now = Date.now()) {
    const canon = classCode(...String(code ?? '').toUpperCase().split('-').slice(0, 2));
    if (!canon || canon !== String(code ?? '').toUpperCase().slice(0, 16)) return null;
    const [cn, y] = canon.split('-');
    this.sql.exec('INSERT OR IGNORE INTO classes (code, class_name, year, created_by, ts) VALUES (?, ?, ?, ?, ?)', canon, cn, y, createdBy || 'Hệ thống', now);
    return this.classInfo(canon);
  }

  joinClass(ws, s, code) {
    let info = this.classInfo(code);
    if (!info) info = this.ensureClassRow(code, s.profile ? displayName(s.profile) : '');
    if (!info) {
      ws.send(JSON.stringify({ t: 'classErr', msg: 'Không tìm thấy lớp này. Kiểm tra lại mã mời nhé.' }));
      return;
    }
    const old = s.cls;
    s.cls = info.code;
    this.save(ws, s);
    if (old && old !== info.code) this.sendToClass(old, { t: 'classMembers', code: old, members: this.classMembers(old) });
    ws.send(JSON.stringify({ t: 'classJoined', cls: info, history: this.classHistory(info.code), members: this.classMembers(info.code) }));
    this.sendToClass(info.code, { t: 'classMembers', code: info.code, members: this.classMembers(info.code) });
  }

  recentNotes(n) {
    return this.sql.exec('SELECT id, name, info, text, ts FROM notes ORDER BY id DESC LIMIT ?', n).toArray();
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 24000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const s = this.get(ws), now = Date.now();
    s.seenAt = now;
    const pub = x => ({ id: x.id, profile: x.profile, p: x.p });

    switch (m.t) {
      case 'hello': {
        const first = !s.profile;
        s.profile = cleanProfile(m.profile);
        s.p = cleanPos(m.p) || s.p;
        this.save(ws, s);
        if (first) {
          const key = clean(`${displayName(s.profile)}|${profileInfo(s.profile)}`, 80);
          this.sql.exec(
            'INSERT INTO seen (player_key, name, info, role, first_ts, last_ts, visits) VALUES (?, ?, ?, ?, ?, ?, 1) ' +
            'ON CONFLICT(player_key) DO UPDATE SET last_ts = excluded.last_ts, visits = seen.visits + 1',
            key, displayName(s.profile), profileInfo(s.profile), s.profile.role, now, now,
          );
          this.sql.exec('INSERT INTO visits (day, conns) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET conns = visits.conns + 1', dayVN(now));
          const all = this.players(s.id);
          ws.send(JSON.stringify({
            t: 'welcome',
            id: s.id,
            players: all.filter(x => dist(x.p, s.p) <= VIEW_M).map(pub),
            online: this.onlineCount(),
            notes: this.recentNotes(40),
          }));
          this.broadcastNear({ t: 'join', ...pub(s), online: this.onlineCount() }, s.p, s.id);
          this.broadcast({ t: 'presence', online: this.onlineCount() }, s.id);
        } else {
          this.broadcast({ t: 'prof', id: s.id, profile: s.profile }, s.id);
        }
        break;
      }
      case 'mv': {
        if (!s.profile) return;
        if (now - s.win > 1000) { s.win = now; s.winN = 0; }
        if (++s.winN > MV_MAX_PER_S) return;
        const p = cleanPos(m.p);
        if (!p) return;
        s.p = p;
        if (now - s.savedAt > 3000) this.save(ws, s);
        this.broadcastNear({ t: 'mv', id: s.id, p }, p, s.id);
        if (now - (s.snapAt || 0) > SNAP_MS) {
          s.snapAt = now;
          const near = this.players(s.id).filter(x => dist(x.p, p) <= VIEW_M).map(pub);
          if (near.length) this.tell(ws, { t: 'snap', players: near });
        }
        break;
      }
      case 'chat': {
        if (!s.profile) return;
        const text = clean(m.text, 120);
        if (!text) return;
        const last = s.yardChatAt ?? s.chatAt ?? 0;
        if (now - last < CHAT_COOLDOWN_MS) {
          ws.send(JSON.stringify({ t: 'err', msg: 'Gửi nhanh quá, đợi một chút nhé.' }));
          return;
        }
        s.yardChatAt = now;
        const payload = JSON.stringify({ t: 'chat', id: s.id, text });
        // người trong 15 m (kể cả người gửi) — để cả hai thấy cập nhật
        for (const [ws2, o] of this.sockets()) {
          if (!o.profile) continue;
          if (o.id !== s.id && dist(o.p, s.p) > NEAR_CHAT_M) continue;
          try { ws2.send(payload); } catch { /* đóng */ }
        }
        break;
      }
      // ---- trò chuyện riêng 1-1: mời → người kia đồng ý → nhắn tin / gọi thoại ----
      case 'talkReq': {
        if (!s.profile || s.peer) return;
        const [tws, t] = this.byId(m.to);
        if (!t || !t.profile || t.id === s.id) return;
        if (t.peer) return this.tell(ws, { t: 'talkDecline', id: t.id, why: 'busy' });
        if (dist(t.p, s.p) > TALK_RANGE_M) return this.tell(ws, { t: 'err', msg: 'Đứng gần bạn ấy hơn rồi mời trò chuyện nhé.' });
        if (s.req && s.req.to === t.id && now - s.req.ts < 5_000) return;
        s.req = { to: t.id, ts: now };
        this.save(ws, s);
        this.tell(tws, { t: 'talkReq', from: s.id, name: displayName(s.profile), info: profileInfo(s.profile) });
        break;
      }
      case 'talkAns': {
        if (!s.profile || s.peer) return;
        const [rws, r] = this.byId(m.to);
        if (!r || !r.req || r.req.to !== s.id || now - r.req.ts > TALK_REQ_MS || r.peer) return;
        r.req = null;
        if (!m.ok) {
          this.save(rws, r);
          return this.tell(rws, { t: 'talkDecline', id: s.id, why: 'no' });
        }
        r.peer = s.id;
        s.peer = r.id;
        this.save(rws, r);
        this.save(ws, s);
        this.tell(rws, { t: 'talkStart', peer: s.id, name: displayName(s.profile), info: profileInfo(s.profile), caller: true });
        this.tell(ws, { t: 'talkStart', peer: r.id, name: displayName(r.profile), info: profileInfo(r.profile), caller: false });
        break;
      }
      case 'talkMsg': {
        if (!s.peer) return;
        const text = clean(m.text, 300);
        if (!text) return;
        const last = s.talkAt ?? s.chatAt ?? 0;
        if (now - last < 400) return;
        s.talkAt = now;
        const [pws] = this.byId(s.peer);
        const name = displayName(s.profile);
        if (pws) this.tell(pws, { t: 'talkMsg', from: s.id, name, text });
        break;
      }
      case 'rtc': {
        // tín hiệu WebRTC (offer/answer/ice) chỉ chuyển cho người đang trò chuyện cùng
        if (!s.peer || !m.d || typeof m.d !== 'object') return;
        const [pws] = this.byId(s.peer);
        if (pws) this.tell(pws, { t: 'rtc', from: s.id, d: m.d });
        break;
      }
      case 'talkEnd': {
        this.endTalk(ws, s);
        break;
      }
      case 'note': {
        if (!s.profile) return;
        const text = clean(m.text, 160);
        if (!text) return;
        if (now - s.noteAt < NOTE_COOLDOWN_MS) {
          ws.send(JSON.stringify({ t: 'err', msg: 'Bạn vừa viết lưu bút, đợi một chút rồi viết tiếp nhé.' }));
          return;
        }
        s.noteAt = now;
        this.save(ws, s);
        const name = displayName(s.profile);
        const info = profileInfo(s.profile);
        const row = this.sql.exec('INSERT INTO notes (name, info, text, ts) VALUES (?, ?, ?, ?) RETURNING id', name, info, text, now).one();
        this.broadcast({ t: 'note', note: { id: row.id, name, info, text, ts: now } });
        break;
      }
      case 'classCreate': {
        if (!s.profile) return;
        const code = classCode(m.className, m.year);
        if (!code) {
          ws.send(JSON.stringify({ t: 'classErr', msg: 'Tên lớp hoặc niên khóa chưa đúng (ví dụ lớp 12A1, năm nhập học 2011).' }));
          return;
        }
        this.ensureClassRow(code, displayName(s.profile), now);
        this.joinClass(ws, s, code);
        break;
      }
      case 'classJoin': {
        if (!s.profile) return;
        this.joinClass(ws, s, String(m.code ?? '').toUpperCase().slice(0, 16));
        break;
      }
      case 'classLeave': {
        const old = s.cls;
        s.cls = null;
        this.save(ws, s);
        if (old) this.sendToClass(old, { t: 'classMembers', code: old, members: this.classMembers(old) });
        break;
      }
      case 'classMsg': {
        if (!s.profile) return;
        if (!s.cls) {
          ws.send(JSON.stringify({ t: 'err', msg: 'Bạn chưa vào phòng lớp (mở Lớp học hoặc đợi game tự vào theo hồ sơ).' }));
          return;
        }
        const text = clean(m.text, 300);
        if (!text) return;
        const last = s.classChatAt ?? s.chatAt ?? 0;
        if (now - last < CHAT_COOLDOWN_MS) {
          ws.send(JSON.stringify({ t: 'err', msg: 'Gửi nhanh quá, đợi một chút nhé.' }));
          return;
        }
        s.classChatAt = now;
        const name = displayName(s.profile), info = profileInfo(s.profile);
        const row = this.sql.exec('INSERT INTO class_msgs (code, name, info, text, ts) VALUES (?, ?, ?, ?, ?) RETURNING id', s.cls, name, info, text, now).one();
        this.sql.exec('DELETE FROM class_msgs WHERE code = ? AND id <= ?', s.cls, row.id - CLASS_MSG_KEEP);
        this.sendToClass(s.cls, { t: 'classMsg', code: s.cls, msg: { id: row.id, from: s.id, name, info, text, ts: now } });
        break;
      }
      case 'act': {
        if (!s.profile || !['keng', 'drum'].includes(m.kind) || now - s.actAt < ACT_COOLDOWN_MS) return;
        s.actAt = now;
        this.broadcast({ t: 'act', id: s.id, kind: m.kind }, s.id);
        break;
      }
      case 'stats': {
        if (!s.profile) return;
        const pages = clamp(m.pages, 0, 20);
        const notesN = clamp(m.notes, 0, 999);
        const name = displayName(s.profile);
        const info = profileInfo(s.profile);
        const key = clean(`${name}|${info}`, 80);
        this.sql.exec(
          'INSERT INTO scores (player_key, name, info, pages, notes, ts) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(player_key) DO UPDATE SET pages = MAX(scores.pages, excluded.pages), ' +
          'notes = MAX(scores.notes, excluded.notes), ts = excluded.ts',
          key, name, info, pages, notesN, now,
        );
        break;
      }
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code, 'bye'); } catch { /* đã đóng */ }
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  sockets() {
    return this.ctx.getWebSockets().map(w => [w, this.get(w)]);
  }

  byId(id) {
    for (const [w, o] of this.sockets()) if (o.id === id) return [w, o];
    return [null, null];
  }

  tell(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket đang đóng */ }
  }

  endTalk(ws, s) {
    if (!s.peer) return;
    const [pws, p] = this.byId(s.peer);
    s.peer = null;
    if (ws) this.save(ws, s);
    if (p && p.peer === s.id) {
      p.peer = null;
      this.save(pws, p);
      this.tell(pws, { t: 'talkEnd', id: s.id });
    }
  }

  leave(ws) {
    const s = this.get(ws);
    if (s.left) return; // đã rời (quét ma rồi webSocketClose gọi lại)
    s.left = true;
    try { ws.serializeAttachment(s); } catch { /* socket đã đóng */ }
    this.endTalk(null, s);
    if (s.profile) {
      this.broadcast({ t: 'leave', id: s.id, online: this.onlineCount() }, s.id);
      this.broadcast({ t: 'presence', online: this.onlineCount() }, s.id);
    }
    if (s.cls) this.sendToClass(s.cls, { t: 'classMembers', code: s.cls, members: this.classMembers(s.cls, s.id) });
    this.state.delete(ws);
  }

}
