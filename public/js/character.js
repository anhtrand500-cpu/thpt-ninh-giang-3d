// Nhân vật học sinh dựng bằng khối hộp/cầu, có chuyển động tay chân khi đi.
import * as THREE from 'three';

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  return matCache.get(color);
}

function part(geo, color, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const G = {
  leg: new THREE.BoxGeometry(0.17, 0.8, 0.19).translate(0, -0.4, 0),
  wideLeg: new THREE.BoxGeometry(0.2, 0.82, 0.22).translate(0, -0.41, 0),
  shoe: new THREE.BoxGeometry(0.18, 0.1, 0.28).translate(0, -0.83, 0.04),
  torso: new THREE.BoxGeometry(0.46, 0.62, 0.26),
  slimTorso: new THREE.BoxGeometry(0.4, 0.62, 0.24),
  belt: new THREE.BoxGeometry(0.47, 0.06, 0.27),
  arm: new THREE.BoxGeometry(0.13, 0.6, 0.15).translate(0, -0.3, 0),
  hand: new THREE.SphereGeometry(0.075, 10, 8).translate(0, -0.64, 0),
  neck: new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10),
  head: new THREE.SphereGeometry(0.15, 20, 16),
  hair: new THREE.SphereGeometry(0.163, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  longHair: new THREE.BoxGeometry(0.28, 0.42, 0.07).translate(0, -0.21, 0),
  eye: new THREE.SphereGeometry(0.02, 8, 6),
  flap: new THREE.BoxGeometry(0.34, 0.74, 0.02).translate(0, -0.37, 0),
  bag: new THREE.BoxGeometry(0.34, 0.42, 0.16),
  badge: new THREE.BoxGeometry(0.06, 0.06, 0.01),
  jacket: new THREE.BoxGeometry(0.5, 0.68, 0.3),
  collar: new THREE.BoxGeometry(0.48, 0.1, 0.3),
  jkTop: new THREE.BoxGeometry(0.52, 0.36, 0.32),
  jkBot: new THREE.BoxGeometry(0.52, 0.36, 0.32),
  zip: new THREE.BoxGeometry(0.045, 0.7, 0.02),
  armU: new THREE.BoxGeometry(0.135, 0.26, 0.155).translate(0, -0.13, 0),
  armL: new THREE.BoxGeometry(0.135, 0.36, 0.155).translate(0, -0.47, 0),
  patch: new THREE.BoxGeometry(0.09, 0.06, 0.012),
  crest: new THREE.BoxGeometry(0.07, 0.08, 0.012),
  bun: new THREE.SphereGeometry(0.11, 12, 10),
};

/**
 * kind: 'boy' (áo sơ mi trắng, quần xanh) | 'aodai' (áo dài trắng) | 'girl' (áo trắng, váy/quần xanh)
 */
export function createCharacter(o = {}) {
  const given = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const look = {
    kind: 'boy', shirt: 0xfafafa, pants: 0x1b2744, skin: 0xe9bf98, hair: 0x15110e, shoes: 0x2a2a2a,
    bag: null, badge: true, aodaiPants: 0xffffff,
    jacket: null, jacketTrim: 0xffffff, jacketTop: 0xffffff, jacketLow: 0x1c2d5a, hairBun: false,
    ...given,
  };
  if (look.kind === 'girl' && look.hair === 0x15110e) look.hair = 0x2a1810;
  const aodai = look.kind === 'aodai';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hipY = 0.86;

  const legs = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(0.1 * s, hipY, 0);
    body.add(g);
    part(aodai ? G.wideLeg : G.leg, aodai ? look.aodaiPants : look.pants, 0, 0, 0, g);
    part(G.shoe, look.shoes, 0, 0, 0, g);
    return g;
  });

  part(aodai ? G.slimTorso : G.torso, look.shirt, 0, hipY + 0.32, 0, body);
  const splitJk = !aodai && look.jacket === 'split';
  if (splitJk) {
    part(G.jkTop, look.jacketTop, 0, hipY + 0.52, 0.03, body);
    part(G.jkBot, look.jacketLow, 0, hipY + 0.22, 0.03, body);
    part(G.collar, look.jacketTop, 0, hipY + 0.68, 0.05, body);
    part(G.zip, 0xf2f2f2, 0, hipY + 0.38, 0.18, body);
    part(G.patch, 0xc62828, -0.15, hipY + 0.58, 0.19, body);
    part(G.patch, 0xfafafa, -0.11, hipY + 0.58, 0.191, body);
  } else if (!aodai && look.jacket) {
    part(G.jacket, look.jacket, 0, hipY + 0.34, 0.02, body);
    part(G.collar, look.jacketTrim, 0, hipY + 0.66, 0.04, body);
  }
  if (!aodai && !splitJk) part(G.belt, 0x222222, 0, hipY + 0.03, 0, body);
  if (!aodai && look.badge && !splitJk) part(G.badge, 0xc62828, -0.13, hipY + 0.5, 0.135, body);

  const flaps = [];
  if (aodai) {
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(0, hipY + 0.06, 0.11 * s);
      body.add(g);
      part(G.flap, look.shirt, 0, 0, 0, g);
      flaps.push(g);
    }
  }

  const arms = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set((aodai ? 0.27 : 0.3) * s, hipY + 0.58, 0);
    g.rotation.z = 0.06 * s;
    body.add(g);
    if (splitJk) {
      part(G.armU, look.jacketTop, 0, 0, 0, g);
      part(G.armL, look.jacketLow, 0, 0, 0, g);
      if (s === -1) part(G.crest, 0x1a3a8f, -0.02, -0.22, 0.08, g);
    } else {
      part(G.arm, look.shirt, 0, 0, 0, g);
    }
    part(G.hand, look.skin, 0, 0, 0, g);
    return g;
  });

  part(G.neck, look.skin, 0, hipY + 0.68, 0, body);
  const headY = hipY + 0.86;
  part(G.head, look.skin, 0, headY, 0, body);
  const hair = part(G.hair, look.hair, 0, headY + 0.02, -0.012, body);
  hair.rotation.x = -0.25;
  if (look.hairBun) {
    part(G.bun, look.hair, 0.02, headY + 0.08, -0.14, body);
  } else if (aodai || look.kind === 'girl') {
    part(G.longHair, look.hair, 0, headY + 0.02, -0.12, body);
  }
  for (const s of [-1, 1]) part(G.eye, 0x1b1b1b, 0.055 * s, headY + 0.02, 0.138, body);
  if (look.bag) part(G.bag, look.bag, 0, hipY + 0.36, -0.21, body);
  // mũ kê-pi (bác bảo vệ)
  if (look.cap) {
    const capMat = new THREE.MeshStandardMaterial({ color: look.cap, roughness: 0.7 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.165, 0.11, 18), capMat);
    crown.position.set(0, headY + 0.12, -0.005);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.14), capMat);
    brim.position.set(0, headY + 0.08, 0.15);
    crown.castShadow = brim.castShadow = true;
    body.add(crown, brim);
  }
  // băng đỏ Sao Đỏ trên tay trái
  if (look.armband) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.13, 12), new THREE.MeshStandardMaterial({ map: armbandTexture(), roughness: 0.7 }));
    band.position.set(0, -0.17, 0);
    band.castShadow = true;
    arms[0].add(band);
  }

  root.scale.setScalar(aodai || look.kind === 'girl' ? 0.88 : 0.92);

  let phase = 0, swing = 0, danceT = 0, clapT = 0, singT = 0, bikePhase = 0;
  const lerp = (cur, tgt, rate, step) => cur + (tgt - cur) * Math.min(1, step * rate);

  function poseSit() {
    legs[0].rotation.x = -1.62;
    legs[1].rotation.x = -1.62;
    legs[0].rotation.z = -0.14;
    legs[1].rotation.z = 0.14;
    arms[0].rotation.x = -0.48;
    arms[1].rotation.x = -0.48;
    arms[0].rotation.z = 0.38;
    arms[1].rotation.z = -0.38;
    body.rotation.x = 0.06;
    body.rotation.y = 0;
    body.position.y = -0.5;
  }

  function poseLie() {
    body.rotation.x = -1.42;
    body.rotation.y = 0;
    body.position.y = -0.22;
    legs[0].rotation.x = 0.35;
    legs[1].rotation.x = 0.12;
    legs[0].rotation.z = 0.05;
    legs[1].rotation.z = -0.04;
    arms[0].rotation.x = 0.12;
    arms[1].rotation.x = 0.08;
    arms[0].rotation.z = 0.28;
    arms[1].rotation.z = -0.25;
  }

  function poseClap(step) {
    clapT += step * 11;
    const hit = Math.sin(clapT * 3.2);
    const gap = hit > 0.65 ? 0.18 : 0.42;
    arms[0].rotation.x = -0.35;
    arms[1].rotation.x = -0.35;
    arms[0].rotation.z = gap;
    arms[1].rotation.z = -gap;
    arms[0].position.z = 0.08;
    arms[1].position.z = 0.08;
    body.rotation.x = -0.04;
    legs[0].rotation.x = 0.05;
    legs[1].rotation.x = 0.05;
  }

  function poseSing(step, mov = 1) {
    const rate = Math.min(1.1, Math.max(0.18, mov * 0.42));
    singT += step * 4.2 * rate;
    const w = Math.sin(singT);
    const a = 0.55 + rate * 0.45;
    arms[0].rotation.x = -0.95 + w * 0.12 * a;
    arms[1].rotation.x = -0.95 - w * 0.12 * a;
    arms[0].rotation.z = 0.22;
    arms[1].rotation.z = -0.22;
    body.rotation.y = Math.sin(singT * 0.6) * 0.08;
    body.position.y = Math.abs(w) * 0.04;
    legs[0].rotation.x = 0.08;
    legs[1].rotation.x = 0.08;
  }

  function poseBike(step, mov = 1) {
    const rate = Math.min(1.15, Math.max(0.15, mov * 0.22));
    bikePhase += step * 10 * rate;
    const ped = Math.sin(bikePhase);
    const ped2 = Math.sin(bikePhase + Math.PI);
    body.position.y = -0.4;
    body.rotation.x = 0.16;
    body.rotation.y = 0;
    legs[0].rotation.x = -1.12 + ped * 0.48;
    legs[1].rotation.x = -1.12 + ped2 * 0.48;
    legs[0].rotation.z = -0.26;
    legs[1].rotation.z = 0.26;
    arms[0].rotation.x = -0.88;
    arms[1].rotation.x = -0.88;
    arms[0].rotation.z = 0.48;
    arms[1].rotation.z = -0.48;
    arms[0].position.z = 0.14;
    arms[1].position.z = 0.14;
  }

  function poseDance(step, mov = 1) {
    const rate = Math.min(1.05, Math.max(0.16, mov * 0.36));
    danceT += step * 8.5 * rate;
    const w = Math.sin(danceT);
    const w2 = Math.sin(danceT * 1.15 + 0.6);
    const a = 0.5 + rate * 0.45;
    legs[0].rotation.x = w * 0.55 * a;
    legs[1].rotation.x = -w * 0.55 * a;
    legs[0].rotation.z = w2 * 0.12 * a;
    legs[1].rotation.z = -w2 * 0.12 * a;
    arms[0].rotation.x = (-1.15 + w2 * 0.45) * a;
    arms[1].rotation.x = (-1.15 + w * 0.45) * a;
    arms[0].rotation.z = (0.55 + w * 0.2) * a;
    arms[1].rotation.z = (-0.55 - w * 0.2) * a;
    body.rotation.x = -0.05 * a;
    body.position.y = Math.abs(Math.sin(danceT * 1.35)) * 0.09 * a;
    body.rotation.y = Math.sin(danceT * 0.45) * 0.1 * a;
  }

  function update(dt, speed, airborne, vy = 0, pose = null) {
    if (pose === 'sit') { poseSit(); return; }
    if (pose === 'lie') { poseLie(); return; }
    if (pose === 'clap') { poseClap(dt); return; }
    if (pose === 'bike') { poseBike(dt, speed); return; }
    if (pose === 'sing') { poseSing(dt, speed); return; }
    if (pose === 'dance') { poseDance(dt, speed); return; }
    if (Math.abs(body.rotation.x) > 0.002 || Math.abs(body.position.y) > 0.002 || Math.abs(body.rotation.y) > 0.002) {
      body.rotation.x = lerp(body.rotation.x, 0, 14, dt);
      body.rotation.y = lerp(body.rotation.y, 0, 14, dt);
      body.position.y = lerp(body.position.y, 0, 14, dt);
    }
    legs[0].rotation.z = lerp(legs[0].rotation.z, 0, 14, dt);
    legs[1].rotation.z = lerp(legs[1].rotation.z, 0, 14, dt);
    arms[0].rotation.z = lerp(arms[0].rotation.z, -0.06, 14, dt);
    arms[1].rotation.z = lerp(arms[1].rotation.z, 0.06, 14, dt);
    const moving = speed > 0.1;
    if (moving && !airborne) phase += dt * (3.5 + speed * 1.7);
    const amp = Math.min(speed / 3.2, 1.25) * 0.6;
    if (airborne) {
      const tuck = vy > 0 ? 0.35 : 0.65;
      swing += (tuck - swing) * Math.min(1, dt * 16);
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing * 0.85;
      arms[0].rotation.x = -0.55;
      arms[1].rotation.x = -0.55;
      body.position.y = Math.min(vy * 0.012, 0.08);
    } else {
      const target = moving ? Math.sin(phase) * amp : 0;
      swing += (target - swing) * Math.min(1, dt * 12);
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.9;
      arms[1].rotation.x = swing * 0.9;
      body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.045 * Math.min(speed / 3, 1.3) : 0;
    }
    flaps[0] && (flaps[0].rotation.x = airborne ? 0.2 : Math.abs(swing) * 0.35);
    flaps[1] && (flaps[1].rotation.x = airborne ? -0.2 : -Math.abs(swing) * 0.35);
  }

  return { root, update };
}

// Ngoại hình theo hồ sơ — đồng phục HS theo ảnh lễ ngoài trời THPT Ninh Giang (~2026): mùa hè áo trắng + quần xanh đậm.
export function lookFromProfile(p) {
  const female = p.gender === 'female';
  const winter = p.season === 'winter';
  const white = 0xfafafa;
  const pants = 0x1b2744;
  if (p.role === 'teacher') {
    if (female) return { kind: 'aodai', shirt: winter ? 0x7b1f3a : 0xc62828, aodaiPants: 0xf4efe6, badge: false };
    return { kind: 'boy', shirt: winter ? 0x3b4a5e : 0x9fc3e6, pants: 0x3a3a3a, badge: false, bag: 0x5a3b22 };
  }
  const kind = female ? 'girl' : 'boy';
  const bag = female ? 0xad1457 : 0x1565c0;
  if (winter) {
  // Áo khoác gió hai tầng trắng / xanh navy (ảnh đồng phục mùa đông THPT Ninh Giang).
    return {
      kind,
      shirt: white,
      pants,
      jacket: 'split',
      jacketTop: 0xffffff,
      jacketLow: 0x1c2d5a,
      badge: false,
      bag,
      hairBun: female,
    };
  }
  return { kind, shirt: white, pants, badge: true, bag };
}

let armbandTex = null;
function armbandTexture() {
  if (armbandTex) return armbandTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const x = c.getContext('2d');
  x.fillStyle = '#d32f2f';
  x.fillRect(0, 0, 256, 48);
  x.fillStyle = '#ffd54a';
  x.font = 'bold 28px "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const cx of [64, 192]) x.fillText('SAO ĐỎ', cx, 26);
  armbandTex = new THREE.CanvasTexture(c);
  armbandTex.colorSpace = THREE.SRGBColorSpace;
  return armbandTex;
}

// Bong bóng lời nói trên đầu nhân vật (tự xuống dòng).
export function speechBubble(text) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = '600 30px "Helvetica Neue", Arial, sans-serif';
  x.font = font;
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > 420 && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  const w = Math.ceil(Math.max(...lines.map(l => x.measureText(l).width)) + 48), h = lines.length * 40 + 44;
  c.width = w;
  c.height = h;
  x.fillStyle = 'rgba(255,255,255,0.96)';
  x.strokeStyle = '#8e2a22';
  x.lineWidth = 4;
  x.beginPath();
  x.roundRect(2, 2, w - 4, h - 22, 18);
  x.moveTo(w / 2 - 14, h - 21);
  x.lineTo(w / 2, h - 2);
  x.lineTo(w / 2 + 14, h - 21);
  x.fill();
  x.stroke();
  x.fillStyle = '#1f1f1f';
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  lines.forEach((l, i) => x.fillText(l, w / 2, 30 + i * 40));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  const sh = 0.0042 * h;
  sp.scale.set((sh * w) / h, sh, 1);
  sp.position.y = 2.15 + sh / 2;
  sp.renderOrder = 11;
  return sp;
}

// Biển tên nổi trên đầu nhân vật.
export function nameTag(lines) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = '"Helvetica Neue", Arial, sans-serif';
  x.font = `bold 40px ${font}`;
  const w1 = x.measureText(lines[0]).width;
  x.font = `28px ${font}`;
  const w2 = lines[1] ? x.measureText(lines[1]).width : 0;
  c.width = Math.ceil(Math.max(w1, w2) + 40);
  c.height = lines[1] ? 96 : 60;
  x.fillStyle = 'rgba(142,42,34,0.86)';
  x.beginPath();
  x.roundRect(0, 0, c.width, c.height, 18);
  x.fill();
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#ffe7a3';
  x.font = `bold 40px ${font}`;
  x.fillText(lines[0], c.width / 2, 32);
  if (lines[1]) {
    x.fillStyle = '#ffffff';
    x.font = `28px ${font}`;
    x.fillText(lines[1], c.width / 2, 72);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  const h = lines[1] ? 0.42 : 0.26;
  sp.scale.set((h * c.width) / c.height, h, 1);
  sp.position.y = 2.25;
  sp.renderOrder = 10;
  return sp;
}
