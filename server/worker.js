// Máy chủ nhiều người chơi chạy trên Cloudflare Workers (gói Free).
// - Worker: phục vụ file tĩnh trong public/, chuyển /api/* vào Durable Object.
// - SchoolRoom (Durable Object, SQLite): một "sân trường" chung — WebSocket realtime + sổ lưu bút.
//   Dùng WebSocket Hibernation API để không tốn thời gian chạy khi mọi người đứng yên.
import { DurableObject } from 'cloudflare:workers';
import { INTEGRAL_QUESTIONS, MATH_GAME_MAX_PLAYERS, MATH_QUESTION_MS, MATH_REVEAL_MS } from '../public/js/mathGameData.js';

const MAX_PLAYERS = 150// Workers Paid — giới hạn phòng san-truong (giảm tải)
const STALE_MS = 45 * 60_000; // đứng yên / tab nền — không quét đá khỏi phòng (chấp nhận lag hơn là disconnect)
const GHOST_MS = 8 * 60_000;  // socket chưa hello xong quá lâu → dọn
const SWEEP_MS = 5 * 60_000;  // quét nhẹ, tránh giật khi đông người
const CHAT_COOLDOWN_MS = 1_200;
const ACT_COOLDOWN_MS = 5_000;
const CLASS_MSG_KEEP = 300; // số tin nhắn lưu lại mỗi lớp
const NEAR_CHAT_M = 15;      // chat sân chỉ tới người trong bán kính này
const TALK_RANGE_M = 6;      // phải đứng gần mới mời trò chuyện được
const TALK_REQ_MS = 30_000;  // lời mời hết hạn sau 30 giây
const VIEW_M = 72;           // đồng bộ vị trí gần — đủ rộng cho sân + hành lang nhà chính
const SNAP_MS = 2400;
const MV_MAX_PER_S = 12;
const CARO_INVITE_MS = 30_000;

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

// [x, y, z, hướng, tốc độ, tư thế, người lái, màu xe].
function cleanPos(p) {
  if (!Array.isArray(p)) return null;
  const r = v => Math.round(v * 100) / 100;
  const out = [r(clamp(p[0], -100, 100)), r(clamp(p[1], 0, 20)), r(clamp(p[2], -40, 60)), r(clamp(p[3], -10, 10)), r(clamp(p[4], 0, 10))];
  if (p.length > 5 && p[5] != null) out[5] = clamp(Math.round(p[5]), 0, 6);
  if (Number.isSafeInteger(p[6]) && p[6] >= 0) out[6] = p[6];
  else if (typeof p[6] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p[6])) out[6] = p[6];
  if (p[7] != null && Number.isFinite(+p[7])) out[7] = Math.round(clamp(p[7], 0, 0xffffff));
  return out;
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs((a[1] || 0) - (b[1] || 0));
}

function caroHasFive(cells, index, mark) {
  const row = Math.floor(index / 15), col = index % 15;
  return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && cells[r * 15 + c] === mark) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    return count >= 5;
  });
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
    this.mathGame = null;
    this.caroGames = {};
    this.caroInvites = {};
    this.caroQueue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      this.mathGame = await ctx.storage.get('mathGame') || null;
      this.caroGames = await ctx.storage.get('caroGames') || {};
      this.caroInvites = await ctx.storage.get('caroInvites') || {};
      if ((await ctx.storage.getAlarm()) === null && (ctx.getWebSockets().length || this.mathGameHasDeadline())) {
        await this.scheduleNextAlarm();
      }
    });
  }

  // Quét định kỳ: đóng các socket không còn hoạt động (client tắt đột ngột, không gửi close).
  async alarm() {
    const now = Date.now();
    await this.sweep(now);
    await this.advanceMathGame(now);
    await this.scheduleNextAlarm(now);
  }

  mathGameHasDeadline() {
    return this.mathGame?.status === 'question' || this.mathGame?.status === 'reveal';
  }

  async scheduleNextAlarm(now = Date.now()) {
    const deadline = this.mathGame?.status === 'question'
      ? this.mathGame.deadline
      : this.mathGame?.status === 'reveal' ? this.mathGame.revealUntil : 0;
    if (this.ctx.getWebSockets().length || deadline) {
      await this.ctx.storage.setAlarm(deadline ? Math.min(now + SWEEP_MS, deadline) : now + SWEEP_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  lastSeen(ws, s) {
    const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
    return Math.max(s.openedAt || 0, s.savedAt || 0, s.seenAt || 0, auto ? auto.getTime() : 0);
  }

  async sweep(now = Date.now()) {
    let closed = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const s = this.get(ws);
      const idle = now - this.lastSeen(ws, s);
      if (s.left) {
        await this.leave(ws);
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
        await this.leave(ws);
        try { ws.close(1001, 'stale'); } catch { /* đã đóng */ }
        closed++;
      }
    }
    return closed;
  }

  async fetch(request) {
    const url = new URL(request.url);
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
      const swept = await this.sweep();
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
      await this.sweep();
      if (this.onlineCount() >= MAX_PLAYERS) return new Response('Sân trường đang quá đông', { status: 503 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const s = { id: Math.floor(Math.random() * 2 ** 31), profile: null, p: [0, 0, 48, Math.PI, 0], savedAt: 0, openedAt: Date.now(), yardChatAt: 0, classChatAt: 0, talkAt: 0, actAt: 0, win: 0, winN: 0 };
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

  caroBusy(id) {
    return Object.values(this.caroGames).some(game => game.xId === id || game.oId === id)
      || Object.values(this.caroInvites).some(invite => invite.expiresAt > Date.now() && (invite.from === id || invite.to === id));
  }

  async saveCaroState() {
    await Promise.all([
      this.ctx.storage.put('caroGames', this.caroGames),
      this.ctx.storage.put('caroInvites', this.caroInvites),
    ]);
  }

  runCaro(action) {
    const result = this.caroQueue.then(action);
    this.caroQueue = result.catch(error => {
      console.error('Caro operation failed:', error);
    });
    return result;
  }

  sendCaroRoster(ws) {
    const players = this.sockets()
      .filter(([, player]) => player.profile && !player.left)
      .map(([, player]) => ({
        id: player.id,
        name: displayName(player.profile),
        info: profileInfo(player.profile),
        busy: player.id !== this.get(ws).id && this.caroBusy(player.id),
      }));
    this.tell(ws, { t: 'caroPlayers', players });
  }

  async listCaroPlayers(ws, s) {
    await this.expireCaroInvites();
    this.sendCaroRoster(ws);
    const game = Object.values(this.caroGames).find(item => item.status === 'active' && (item.xId === s.id || item.oId === s.id));
    this.tell(ws, { t: 'caroCurrent', game: game ? { ...game, yourMark: game.xId === s.id ? 'X' : 'O' } : null });
  }

  async expireCaroInvites() {
    let changed = false;
    for (const [inviteId, invite] of Object.entries(this.caroInvites)) {
      if (invite.expiresAt > Date.now()) continue;
      delete this.caroInvites[inviteId];
      changed = true;
      const [fromWs] = this.byId(invite.from);
      if (fromWs) this.tell(fromWs, { t: 'caroEnd', inviteId, reason: 'expired' });
      const [toWs] = this.byId(invite.to);
      if (toWs) this.tell(toWs, { t: 'caroEnd', inviteId, reason: 'expired' });
    }
    if (changed) await this.saveCaroState();
  }

  sendCaroState(game) {
    for (const [id, mark] of [[game.xId, 'X'], [game.oId, 'O']]) {
      const [ws] = this.byId(id);
      if (ws) this.tell(ws, { t: 'caroState', game: { ...game, yourMark: mark } });
    }
  }

  async handleCaroInvite(ws, s, toId) {
    if (!s.profile || !Number.isSafeInteger(toId) || toId === s.id) return;
    await this.expireCaroInvites();
    const [targetWs, target] = this.byId(toId);
    if (!targetWs || !target?.profile || target.left) {
      this.tell(ws, { t: 'caroError', msg: 'Người chơi này hiện không còn online.' });
      return;
    }
    if (this.caroBusy(s.id) || this.caroBusy(target.id)) {
      this.tell(ws, { t: 'caroError', msg: 'Bạn hoặc người chơi này đang có lời mời hay ván Caro chưa kết thúc.' });
      return;
    }
    const inviteId = crypto.randomUUID();
    this.caroInvites[inviteId] = { from: s.id, to: target.id, expiresAt: Date.now() + CARO_INVITE_MS };
    await this.saveCaroState();
    this.tell(targetWs, {
      t: 'caroInvite',
      inviteId,
      from: s.id,
      name: displayName(s.profile),
      info: profileInfo(s.profile),
    });
    this.tell(ws, { t: 'caroInviteSent', inviteId, id: target.id });
  }

  async handleCaroAnswer(ws, s, inviteId, accepted) {
    if (!s.profile || typeof inviteId !== 'string') return;
    const invite = this.caroInvites[inviteId];
    if (!invite || invite.to !== s.id || invite.expiresAt <= Date.now()) {
      delete this.caroInvites[inviteId];
      await this.saveCaroState();
      this.tell(ws, { t: 'caroError', msg: 'Lời mời này đã hết hạn.' });
      return;
    }
    const [fromWs, from] = this.byId(invite.from);
    delete this.caroInvites[inviteId];
    if (!fromWs || !from?.profile || from.left) {
      await this.saveCaroState();
      this.tell(ws, { t: 'caroError', msg: 'Người mời đã rời sân.' });
      return;
    }
    if (!accepted) {
      await this.saveCaroState();
      this.tell(fromWs, { t: 'caroDeclined', id: s.id });
      return;
    }
    if (this.caroBusy(s.id) || this.caroBusy(from.id)) {
      await this.saveCaroState();
      this.tell(ws, { t: 'caroError', msg: 'Một trong hai người đang có ván đấu khác.' });
      this.tell(fromWs, { t: 'caroError', msg: 'Không thể bắt đầu ván Caro lúc này.' });
      return;
    }
    const game = {
      id: crypto.randomUUID(),
      xId: invite.from,
      oId: s.id,
      xName: displayName(from.profile),
      oName: displayName(s.profile),
      cells: Array(225).fill(''),
      turn: 'X',
      status: 'active',
      winner: null,
    };
    this.caroGames[game.id] = game;
    await this.saveCaroState();
    this.sendCaroState(game);
  }

  async handleCaroMove(ws, s, gameId, index) {
    if (!s.profile || typeof gameId !== 'string' || !Number.isSafeInteger(index) || index < 0 || index >= 225) return;
    const game = this.caroGames[gameId];
    if (!game || game.status !== 'active') return;
    const mark = game.xId === s.id ? 'X' : game.oId === s.id ? 'O' : null;
    if (!mark || game.turn !== mark || game.cells[index]) return;
    game.cells[index] = mark;
    if (caroHasFive(game.cells, index, mark)) {
      game.status = 'finished';
      game.winner = mark;
    } else if (game.cells.every(Boolean)) {
      game.status = 'finished';
      game.winner = 'draw';
    } else {
      game.turn = mark === 'X' ? 'O' : 'X';
    }
    await this.saveCaroState();
    this.sendCaroState(game);
  }

  async endCaroGame(gameId, playerId, reason = 'left') {
    const game = this.caroGames[gameId];
    if (!game || (game.xId !== playerId && game.oId !== playerId)) return;
    delete this.caroGames[gameId];
    await this.saveCaroState();
    const otherId = game.xId === playerId ? game.oId : game.xId;
    const [otherWs] = this.byId(otherId);
    if (otherWs) this.tell(otherWs, { t: 'caroEnd', gameId, reason });
  }

  async cleanupCaroPlayer(playerId) {
    let changed = false;
    for (const [inviteId, invite] of Object.entries(this.caroInvites)) {
      if (invite.from !== playerId && invite.to !== playerId) continue;
      delete this.caroInvites[inviteId];
      changed = true;
      const otherId = invite.from === playerId ? invite.to : invite.from;
      const [otherWs] = this.byId(otherId);
      if (otherWs) this.tell(otherWs, { t: 'caroEnd', inviteId, reason: 'offline' });
    }
    for (const gameId of Object.keys(this.caroGames)) {
      const game = this.caroGames[gameId];
      if (game.xId !== playerId && game.oId !== playerId) continue;
      delete this.caroGames[gameId];
      changed = true;
      const otherId = game.xId === playerId ? game.oId : game.xId;
      const [otherWs] = this.byId(otherId);
      if (otherWs) this.tell(otherWs, { t: 'caroEnd', gameId, reason: 'offline' });
    }
    if (changed) await this.saveCaroState();
  }

  newMathGame() {
    return { status: 'lobby', questionIndex: -1, deadline: 0, revealUntil: 0, players: {} };
  }

  mathConnectedPlayers() {
    if (!this.mathGame) return [];
    return this.sockets().filter(([ws, s]) => ws.readyState === WebSocket.OPEN && !s.left && this.mathGame.players[s.id]);
  }

  mathStateFor(myId) {
    const game = this.mathGame;
    const status = game?.status || 'lobby';
    const players = Object.values(game?.players || {}).map(p => {
      const [ws, connection] = this.byId(p.id);
      const isConnected = !!ws && ws.readyState === WebSocket.OPEN && !connection.left;
      const reveal = status === 'reveal' || status === 'finished';
      return {
        id: p.id,
        name: p.name,
        score: p.score,
        connected: isConnected,
        answered: p.choice != null,
        choice: reveal || p.id === myId ? p.choice : null,
        correct: reveal ? p.correct : null,
      };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const self = game?.players?.[myId];
    return {
      status,
      myId,
      isParticipant: !!self,
      questionIndex: game?.questionIndex ?? -1,
      questionCount: INTEGRAL_QUESTIONS.length,
      serverNow: Date.now(),
      deadline: game?.deadline || 0,
      revealUntil: game?.revealUntil || 0,
      answerCount: Object.values(game?.players || {}).filter(p => p.choice != null).length,
      playerCount: this.mathConnectedPlayers().length,
      capacity: MATH_GAME_MAX_PLAYERS,
      correctIndex: status === 'reveal' || status === 'finished'
        ? INTEGRAL_QUESTIONS[game?.questionIndex]?.correctIndex ?? null
        : null,
      myChoice: self?.choice ?? null,
      players,
    };
  }

  async saveMathGame() {
    if (this.mathGame) await this.ctx.storage.put('mathGame', this.mathGame);
    else await this.ctx.storage.delete('mathGame');
  }

  sendMathState(ws, myId) {
    this.tell(ws, { t: 'mathState', state: this.mathStateFor(myId) });
  }

  broadcastMathGame() {
    if (!this.mathGame) return;
    for (const [ws, s] of this.sockets()) {
      if (!s.left && this.mathGame.players[s.id]) this.sendMathState(ws, s.id);
    }
  }

  broadcastMathProgress() {
    if (!this.mathGame) return;
    const progress = {
      t: 'mathProgress',
      answerCount: Object.values(this.mathGame.players).filter(p => p.choice != null).length,
      playerCount: this.mathConnectedPlayers().length,
    };
    for (const [ws, s] of this.sockets()) {
      if (!s.left && this.mathGame.players[s.id]) this.tell(ws, progress);
    }
  }

  async joinMathGame(ws, s, now) {
    if (!s.profile) return;
    if (!this.mathGame || (this.mathGame.status === 'finished' && this.mathConnectedPlayers().length === 0)) {
      this.mathGame = this.newMathGame();
    }
    let player = this.mathGame.players[s.id];
    if (!player) {
      if (this.mathConnectedPlayers().length >= MATH_GAME_MAX_PLAYERS) {
        this.tell(ws, { t: 'mathError', msg: `Phòng Math Game đã đủ ${MATH_GAME_MAX_PLAYERS} người chơi.` });
        return;
      }
      player = this.mathGame.players[s.id] = {
        id: s.id,
        name: displayName(s.profile),
        score: 0,
        choice: null,
        correct: null,
        joinedAt: now,
      };
    }
    await this.saveMathGame();
    await this.scheduleNextAlarm(now);
    if (this.mathGame.players[s.id]) this.broadcastMathGame();
    else this.sendMathState(ws, s.id);
  }

  async startMathGame(s, now) {
    const game = this.mathGame;
    if (!game || game.status !== 'lobby' || !game.players[s.id]) return;
    game.status = 'question';
    game.questionIndex = 0;
    game.deadline = now + MATH_QUESTION_MS;
    game.revealUntil = 0;
    for (const player of Object.values(game.players)) {
      player.score = 0;
      player.choice = null;
      player.correct = null;
    }
    await this.saveMathGame();
    await this.scheduleNextAlarm(now);
    this.broadcastMathGame();
  }

  async answerMathQuestion(s, choice, now) {
    const game = this.mathGame;
    const player = game?.players?.[s.id];
    if (!player || game.status !== 'question' || now >= game.deadline || player.choice != null) return;
    const question = INTEGRAL_QUESTIONS[game.questionIndex];
    if (!question || !Number.isSafeInteger(choice) || choice < 0 || choice >= question.choices.length) return;
    player.choice = choice;
    player.correct = choice === question.correctIndex;
    if (player.correct) {
      const remaining = Math.max(0, Math.min(1, (game.deadline - now) / MATH_QUESTION_MS));
      player.score += 500 + Math.round(500 * remaining);
    }
    await this.saveMathGame();
    this.tell(this.byId(s.id)[0], { t: 'mathAnswerAck', choice });
    this.broadcastMathProgress();
  }

  async rematchMathGame(s, now) {
    const game = this.mathGame;
    if (!game || game.status !== 'finished' || !game.players[s.id]) return;
    game.status = 'lobby';
    game.questionIndex = -1;
    game.deadline = 0;
    game.revealUntil = 0;
    for (const player of Object.values(game.players)) {
      player.score = 0;
      player.choice = null;
      player.correct = null;
    }
    await this.saveMathGame();
    await this.scheduleNextAlarm(now);
    this.broadcastMathGame();
  }

  async advanceMathGame(now) {
    const game = this.mathGame;
    if (game?.status === 'question' && now >= game.deadline) {
      game.status = 'reveal';
      game.revealUntil = now + MATH_REVEAL_MS;
    } else if (game?.status === 'reveal' && now >= game.revealUntil) {
      if (game.questionIndex + 1 >= INTEGRAL_QUESTIONS.length) {
        game.status = 'finished';
        game.deadline = 0;
        game.revealUntil = 0;
      } else {
        game.status = 'question';
        game.questionIndex++;
        game.deadline = now + MATH_QUESTION_MS;
        game.revealUntil = 0;
        for (const player of Object.values(game.players)) {
          player.choice = null;
          player.correct = null;
        }
      }
    } else {
      return;
    }
    await this.saveMathGame();
    this.broadcastMathGame();
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
        if (s.p?.[5] === 6) {
          s.p[5] = 0;
          delete s.p[6];
          delete s.p[7];
        }
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
        let seatReleased = false;
        if (p[5] === 6) {
          if (s.passengerOf == null || p[6] !== s.passengerOf) return;
          const [, driver] = this.byId(s.passengerOf);
          if (!driver || driver.bikePassenger !== s.id || driver.p?.[5] !== 5) {
            this.releaseBikeSeats(ws, s);
            return;
          }
          const facing = driver.p[3] || 0;
          p[0] = Math.round((driver.p[0] + Math.sin(facing) * 0.72) * 100) / 100;
          p[1] = driver.p[1];
          p[2] = Math.round((driver.p[2] + Math.cos(facing) * 0.72) * 100) / 100;
          p[3] = facing;
          p[4] = driver.p[4];
          p[6] = driver.id;
          p[7] = driver.p[7] || 0x2d6cb5;
        } else if (s.passengerOf != null) {
          this.releaseBikeSeats(ws, s);
          seatReleased = true;
        }
        if (s.bikePassenger != null && p[5] !== 5) {
          this.releaseBikeSeats(ws, s);
          seatReleased = true;
        }
        s.p = p;
        if (seatReleased || now - s.savedAt > 3000) this.save(ws, s);
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
      case 'mathJoin': {
        await this.joinMathGame(ws, s, now);
        break;
      }
      case 'caroList': {
        await this.runCaro(() => this.listCaroPlayers(ws, s));
        break;
      }
      case 'caroInvite': {
        await this.runCaro(() => this.handleCaroInvite(ws, s, m.to));
        break;
      }
      case 'caroAnswer': {
        await this.runCaro(() => this.handleCaroAnswer(ws, s, m.inviteId, m.accepted === true));
        break;
      }
      case 'caroMove': {
        await this.runCaro(() => this.handleCaroMove(ws, s, m.gameId, m.index));
        break;
      }
      case 'caroEnd': {
        await this.runCaro(() => this.endCaroGame(m.gameId, s.id));
        break;
      }
      case 'mathStart': {
        await this.startMathGame(s, now);
        break;
      }
      case 'mathAnswer': {
        await this.answerMathQuestion(s, m.choice, now);
        break;
      }
      case 'mathRematch': {
        await this.rematchMathGame(s, now);
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
        if (!s.profile || !['keng', 'drum', 'fireworks', 'heart'].includes(m.kind)) return;
        const cooldownField = m.kind === 'fireworks' ? 'fireworksAt' : 'actAt';
        if (now - (s[cooldownField] || 0) < ACT_COOLDOWN_MS) return;
        s[cooldownField] = now;
        this.broadcast({ t: 'act', id: s.id, kind: m.kind }, s.id);
        break;
      }
      case 'bikeSeatReq': {
        const [driverWs, driver] = this.byId(m.driverId);
        if (!s.profile || !driverWs || !driver?.profile || driver.id === s.id
          || !s.p || !driver.p || driver.p[5] !== 5
          || driver.bikePassenger != null || driver.passengerOf != null
          || s.passengerOf != null || s.bikePassenger != null || s.p[5] === 5 || s.p[5] === 6
          || dist(s.p, driver.p) > 4) {
          this.tell(ws, { t: 'bikeSeatErr', msg: 'Ghế sau chưa thể sử dụng — hãy đứng sát người đang đạp xe.' });
          return;
        }
        driver.bikePassenger = s.id;
        s.passengerOf = driver.id;
        const facing = driver.p[3] || 0;
        s.p = [
          Math.round((driver.p[0] + Math.sin(facing) * 0.72) * 100) / 100,
          driver.p[1],
          Math.round((driver.p[2] + Math.cos(facing) * 0.72) * 100) / 100,
          facing,
          driver.p[4],
          6,
          driver.id,
          driver.p[7] || 0x2d6cb5,
        ];
        this.save(driverWs, driver);
        this.save(ws, s);
        this.broadcast({ t: 'bikeSeat', driverId: driver.id, passengerId: s.id, seated: true });
        break;
      }
      case 'bikeSeatLeave': {
        this.releaseBikeSeats(ws, s);
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
    await this.leave(ws);
    try { ws.close(code, 'bye'); } catch { /* đã đóng */ }
  }

  async webSocketError(ws) {
    await this.leave(ws);
  }

  sockets() {
    return this.ctx.getWebSockets().map(w => [w, this.get(w)]);
  }

  byId(id) {
    for (const [w, o] of this.sockets()) if (o.id === id) return [w, o];
    return [null, null];
  }

  releaseBikeSeats(ws, s) {
    const releases = [];
    if (s.passengerOf != null) {
      const driverId = s.passengerOf;
      const [driverWs, driver] = this.byId(driverId);
      if (driver && driver.bikePassenger === s.id) {
        driver.bikePassenger = null;
        this.save(driverWs, driver);
      }
      s.passengerOf = null;
      if (s.p?.[5] === 6) {
        s.p[5] = 0;
        s.p[4] = 0;
        delete s.p[6];
        delete s.p[7];
      }
      releases.push({ driverId, passengerId: s.id });
    }
    if (s.bikePassenger != null) {
      const passengerId = s.bikePassenger;
      const [passengerWs, passenger] = this.byId(passengerId);
      if (passenger && passenger.passengerOf === s.id) {
        passenger.passengerOf = null;
        if (passenger.p?.[5] === 6) {
          passenger.p[5] = 0;
          passenger.p[4] = 0;
          delete passenger.p[6];
          delete passenger.p[7];
        }
        this.save(passengerWs, passenger);
      }
      s.bikePassenger = null;
      releases.push({ driverId: s.id, passengerId });
    }
    if (releases.length) {
      this.save(ws, s);
      for (const release of releases) this.broadcast({ t: 'bikeSeat', ...release, seated: false });
    }
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

  async leave(ws) {
    const s = this.get(ws);
    if (s.left) return; // đã rời (quét ma rồi webSocketClose gọi lại)
    await this.runCaro(() => this.cleanupCaroPlayer(s.id));
    this.releaseBikeSeats(ws, s);
    s.left = true;
    try { ws.serializeAttachment(s); } catch { /* socket đã đóng */ }
    this.endTalk(null, s);
    if (s.profile) {
      this.broadcast({ t: 'leave', id: s.id, online: this.onlineCount() }, s.id);
      this.broadcast({ t: 'presence', online: this.onlineCount() }, s.id);
    }
    if (s.cls) this.sendToClass(s.cls, { t: 'classMembers', code: s.cls, members: this.classMembers(s.cls, s.id) });
    if (this.mathGame?.players?.[s.id]) {
      if (this.mathGame.status === 'lobby') {
        delete this.mathGame.players[s.id];
      } else {
        this.mathGame.players[s.id].connected = false;
        this.mathGame.players[s.id].leftAt = Date.now();
      }
      await this.saveMathGame();
      this.broadcastMathGame();
    }
    this.state.delete(ws);
    await this.scheduleNextAlarm();
  }

}
