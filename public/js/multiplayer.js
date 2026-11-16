// Kết nối nhiều người chơi qua WebSocket (/api/ws) — Durable Object trên Cloudflare Workers.
import * as THREE from 'three';
import { createCharacter, lookFromProfile, nameTag, speechBubble } from './character.js';
import { tagLines, profileClassCode } from './profile.js';

const SEND_MS = 130;
const SEND_IDLE_MS = 2800;
const PING_MS = 20_000;
const RECONNECT_MS = 6_000;
const VIEW_M = 72;
const VIEW_SHOW_M = 78;
const MOVE_EPS = 0.045;

const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function wsURL() {
  const p = new URLSearchParams(location.search);
  if (p.has('nosync')) return null;
  if (p.get('ws')) return p.get('ws');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/ws`;
}

const POSE_TO_CODE = { sit: 1, lie: 2, dance: 3 };
const POSE_FROM_CODE = [null, 'sit', 'lie', 'dance'];
const POSE_VISUAL_DROP = { sit: 0.54, lie: 0.2 };

function packPos(pl) {
  const pose = pl.pose ? POSE_TO_CODE[pl.pose] || 0 : 0;
  return [pl.pos.x, pl.feetY, pl.pos.z, pl.facing, Math.hypot(pl.vel.x, pl.vel.z), pose];
}

export function createMultiplayer({ scene, col, getProfile, getPlayer, callbacks = {} }) {
  let ws = null;
  let connected = false;
  let lastSend = 0;
  let lastPack = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let noteSent = false;
  let myId = null;
  const remotes = new Map();
  const notes = [];
  // lớp đang tham gia: lấy từ link mời ?lop=MÃ, nếu không thì lớp đã vào lần trước
  const CLASS_KEY = 'ninhgiang-class';
  let classCode = (new URLSearchParams(location.search).get('lop') || localStorage.getItem(CLASS_KEY) || '').toUpperCase() || null;
  let classInfo = null;
  let classJoinAuto = false;

  const setStatus = s => callbacks.onStatus?.(s);

  function ensureRemote(id, profile) {
    let r = remotes.get(id);
    const profKey = JSON.stringify(profile);
    if (r) {
      if (profile && profKey !== r.profKey) {
        scene.remove(r.char.root);
        r.char = createCharacter(lookFromProfile(profile));
        r.char.root.add(nameTag(tagLines(profile)));
        scene.add(r.char.root);
        r.profile = profile;
        r.profKey = profKey;
      }
      return r;
    }
    const char = createCharacter(lookFromProfile(profile));
    char.root.add(nameTag(tagLines(profile)));
    scene.add(char.root);
    r = {
      id,
      profile,
      profKey: profKey,
      char,
      pos: new THREE.Vector3(),
      to: new THREE.Vector3(),
      facing: 0,
      tfacing: 0,
      feetY: 0,
      speed: 0,
      seeded: false,
      chat: null,
    };
    remotes.set(id, r);
    return r;
  }

  function removeRemote(id) {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.char.root);
    remotes.delete(id);
  }

  function nearPos(p, pl) {
    if (!Array.isArray(p) || !pl?.pos) return true;
    return Math.hypot(p[0] - pl.pos.x, p[2] - pl.pos.z) <= VIEW_M + 6;
  }

  function packMoved(a, b) {
    if (!b) return true;
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) > MOVE_EPS) return true;
    if (Math.abs(a[3] - b[3]) > 0.09) return true;
    if (Math.abs(a[4] - b[4]) > 0.18) return true;
    if ((a[5] ?? 0) !== (b[5] ?? 0)) return true;
    return false;
  }

  function applyPos(r, p) {
    if (!Array.isArray(p)) return;
    r.to.set(p[0], p[1] ?? 0, p[2]);
    r.tfacing = p[3] ?? 0;
    r.speed = p[4] ?? 0;
    r.pose = POSE_FROM_CODE[p[5] ?? 0] || null;
    if (!r.seeded) {
      r.pos.copy(r.to);
      r.facing = r.tfacing;
      r.seeded = true;
    }
  }

  function handleMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        connected = true;
        myId = m.id;
        setStatus('online');
        notes.length = 0;
        for (const n of m.notes || []) notes.push(n);
        callbacks.onNotes?.(notes.slice());
        for (const pl of m.players || []) {
          const r = ensureRemote(pl.id, pl.profile);
          applyPos(r, pl.p);
        }
        callbacks.onOnline?.(m.online ?? 1 + (m.players?.length || 0));
        sendProfileNote();
        syncClassFromProfile();
        break;
      case 'snap':
        for (const pl of m.players || []) {
          const r = ensureRemote(pl.id, pl.profile);
          applyPos(r, pl.p);
          r.lastMv = performance.now();
        }
        break;
      case 'classJoined':
        classInfo = m.cls;
        classCode = m.cls.code;
        localStorage.setItem(CLASS_KEY, classCode);
        callbacks.onClassJoined?.(m.cls, m.history || [], m.members || [], { auto: classJoinAuto });
        classJoinAuto = false;
        break;
      case 'classMembers':
        if (m.code === classCode) callbacks.onClassMembers?.(m.members || []);
        break;
      case 'classMsg': {
        const myClass = classInfo?.code || classCode;
        if (m.code === myClass) {
          const r = remotes.get(m.msg.from);
          if (r) r.chat = { text: m.msg.text, until: performance.now() + 6_000 };
          callbacks.onClassMsg?.(m.msg);
        }
        break;
      }
      case 'classErr':
        if (!classInfo) {
          classCode = null;
          localStorage.removeItem(CLASS_KEY);
        }
        callbacks.onClassErr?.(m.msg);
        break;
      case 'join': {
        const r = ensureRemote(m.id, m.profile);
        applyPos(r, m.p);
        r.lastMv = performance.now();
        if (m.online != null) callbacks.onOnline?.(m.online);
        callbacks.onJoin?.(m);
        break;
      }
      case 'presence':
        if (m.online != null) callbacks.onOnline?.(m.online);
        break;
      case 'leave':
        removeRemote(m.id);
        if (m.online != null) callbacks.onOnline?.(m.online);
        break;
      case 'mv': {
        const r = remotes.get(m.id);
        if (r) {
          applyPos(r, m.p);
          r.lastMv = performance.now();
        }
        break;
      }
      case 'prof':
        ensureRemote(m.id, m.profile);
        break;
      case 'chat': {
        const r = remotes.get(m.id);
        if (r) r.chat = { text: m.text, until: performance.now() + 7_000 };
        callbacks.onChat?.(m);
        break;
      }
      case 'note':
        if (m.note) {
          notes.unshift(m.note);
          if (notes.length > 80) notes.length = 80;
          callbacks.onNotes?.(notes.slice());
        }
        break;
      case 'act':
        callbacks.onAct?.(m);
        break;
      case 'talkReq':
        callbacks.onTalkReq?.(m);
        break;
      case 'talkStart':
        callbacks.onTalkStart?.(m);
        break;
      case 'talkDecline':
        callbacks.onTalkDecline?.(m);
        break;
      case 'talkMsg':
        callbacks.onTalkMsg?.(m);
        break;
      case 'talkEnd':
        callbacks.onTalkEnd?.(m);
        break;
      case 'rtc':
        callbacks.onRtc?.(m.d);
        break;
      case 'err':
        callbacks.onError?.(m.msg);
        break;
      default:
        break;
    }
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function sendHello() {
    send({ t: 'hello', profile: getProfile(), p: packPos(getPlayer()) });
  }

  function sendProfileNote() {
    if (noteSent) return;
    const text = (getProfile().note || '').trim();
    if (!text) return;
    if (send({ t: 'note', text })) noteSent = true;
  }

  /** Vào phòng lớp theo ?lop=, hoặc tự tạo + vào theo lớp & niên khóa trong hồ sơ học sinh. */
  function syncClassFromProfile(opts = {}) {
    if (!connected) return false;
    const invited = new URLSearchParams(location.search).get('lop');
    if (invited) {
      classJoinAuto = !!opts.auto;
      return send({ t: 'classJoin', code: invited.trim().toUpperCase() });
    }
    const fromProf = profileClassCode(getProfile());
    if (fromProf) {
      if (classInfo?.code === fromProf) return true;
      classJoinAuto = opts.auto !== false;
      classCode = fromProf;
      const [cn, y] = fromProf.split('-');
      return send({ t: 'classCreate', className: cn, year: y });
    }
    if (classCode) {
      classJoinAuto = !!opts.auto;
      return send({ t: 'classJoin', code: classCode });
    }
    return false;
  }

  function connect() {
    const url = wsURL();
    if (!url) {
      setStatus('solo');
      return;
    }
    clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    setStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectAttempts = 0;
      noteSent = false;
      sendHello();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try {
          ws?.send('ping');
        } catch {
          /* ignore */
        }
      }, PING_MS);
    };
    ws.onmessage = e => handleMessage(e.data);
    ws.onclose = () => {
      connected = false;
      clearInterval(pingTimer);
      setStatus('offline');
      reconnectAttempts += 1;
      if (reconnectAttempts === 2) {
        callbacks.onError?.('Chưa vào được sân chung (máy chủ Cloudflare có thể hết hạn mức hôm nay). Vẫn chơi solo; thử lại sau hoặc npm run dev ở máy bạn.');
      }
      if (reconnectAttempts > 15) return;
      const delay = Math.min(45_000, RECONNECT_MS * Math.pow(1.4, Math.min(reconnectAttempts, 6)));
      reconnectTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !connected || ws?.readyState !== WebSocket.OPEN) return;
      try {
        ws.send('ping');
        send({ t: 'mv', p: packPos(getPlayer()) });
      } catch { /* ignore */ }
    });
  }

  function tick(dt) {
    const me = getPlayer();
    const mx = me?.pos?.x ?? 0;
    const mz = me?.pos?.z ?? 0;
    const crowd = remotes.size > 48;
    for (const r of remotes.values()) {
      const d = Math.hypot(r.pos.x - mx, r.pos.z - mz);
      const show = d < VIEW_SHOW_M;
      r.char.root.visible = show;
      if (!show) continue;
      const k = Math.min(1, dt * (crowd ? 10 : 14));
      r.pos.lerp(r.to, k);
      r.facing = angLerp(r.facing, r.tfacing, k);
      r.feetY += (r.to.y - r.feetY) * k;
      const gY = col.groundAt(r.pos.x, r.pos.z, r.feetY);
      const drop = r.pose && POSE_VISUAL_DROP[r.pose] ? POSE_VISUAL_DROP[r.pose] : 0;
      const visY = drop ? Math.max(gY, r.feetY - drop) : r.feetY;
      r.char.root.position.set(r.pos.x, visY, r.pos.z);
      r.char.root.rotation.y = r.facing;
      if (r.clapT > 0) r.clapT = Math.max(0, r.clapT - dt);
      const rPose = r.clapT > 0 ? 'clap' : r.pose;
      const animSpeed = rPose === 'dance' ? 2.2 : rPose === 'clap' ? 1.1 : r.speed;
      const airborne = !rPose && r.feetY - gY > 0.12;
      r.char.update(dt, animSpeed, airborne, 0, rPose);
      // bong bóng lời nói trên đầu người chơi khác (đặt cao hơn bảng tên)
      const now = performance.now();
      if (r.chat && r.chat.text !== r.bubbleText) {
        if (r.bubble) r.char.root.remove(r.bubble);
        r.bubble = speechBubble(r.chat.text);
        r.bubble.position.y += 0.45;
        r.char.root.add(r.bubble);
        r.bubbleText = r.chat.text;
      }
      if (r.bubble && (!r.chat || now > r.chat.until)) {
        r.char.root.remove(r.bubble);
        r.bubble = null;
        r.bubbleText = null;
        r.chat = null;
      }
    }
    const now = performance.now();
    if (connected && ws?.readyState === WebSocket.OPEN) {
      const pack = packPos(getPlayer());
      const moved = packMoved(pack, lastPack);
      const interval = moved ? SEND_MS : SEND_IDLE_MS;
      if (now - lastSend > interval && (moved || now - lastSend > SEND_IDLE_MS)) {
        lastSend = now;
        lastPack = pack;
        send({ t: 'mv', p: pack });
      }
    }
  }

  return {
    connect,
    disconnect() {
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    hello: sendHello,
    chat(text) {
      return send({ t: 'chat', text });
    },
    note(text) {
      return send({ t: 'note', text });
    },
    act(kind) {
      return send({ t: 'act', kind });
    },
    reportStats(pages, notes) {
      return send({ t: 'stats', pages: Math.max(0, pages | 0), notes: Math.max(0, notes | 0) });
    },
    syncClassFromProfile,
    classCreate(className, year) {
      classJoinAuto = false;
      return send({ t: 'classCreate', className, year });
    },
    classJoin(code) {
      return send({ t: 'classJoin', code: String(code).trim().toUpperCase() });
    },
    classLeave() {
      classInfo = null;
      classCode = null;
      localStorage.removeItem(CLASS_KEY);
      return send({ t: 'classLeave' });
    },
    talkRequest(id) {
      return send({ t: 'talkReq', to: id });
    },
    talkAnswer(id, ok) {
      return send({ t: 'talkAns', to: id, ok });
    },
    talkMsg(text) {
      return send({ t: 'talkMsg', text });
    },
    talkEnd() {
      return send({ t: 'talkEnd' });
    },
    rtc(d) {
      return send({ t: 'rtc', d });
    },
    classMsg(text) {
      return send({ t: 'classMsg', text });
    },
    get classInfo() {
      return classInfo;
    },
    get myId() {
      return myId;
    },
    tick,
    remotes,
    get notes() {
      return notes;
    },
  };
}
