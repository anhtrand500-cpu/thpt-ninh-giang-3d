// Dựng toàn bộ khuôn viên bằng code (không dùng file mô hình). /* build 20251113s */
// Toạ độ: +z hướng ra đường Nguyễn Bỉnh Khiêm (cổng trường), đơn vị mét.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import {
  installClassroomSystem,
  isClassRoomCode,
  ensureClassroomShell,
  furnishClassroom,
  installClassroomDoor,
  registerClassroomMeta,
} from './classroom.js';
import { installYardPlay } from './yardPlay.js';

const FH = 3.6; // chiều cao một tầng

const matCache = new Map();
function M(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}

function texMat(map, opts = {}) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...opts });
}

function xform(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// Gom các khối cùng vật liệu thành một mesh để giảm draw call.
class Batch {
  constructor() {
    this.groups = new Map();
  }
  add(mat, geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
  }
  flush(parent) {
    for (const [mat, list] of this.groups) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = !mat.userData.noShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      list.forEach(g => g.dispose());
    }
    this.groups.clear();
  }
}

// Hệ toạ độ cục bộ của một công trình (xoay quanh trục Y).
class Frame {
  constructor(x, z, ry = 0) {
    this.m = xform(x, 0, z, ry);
  }
  at(x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.m.clone().multiply(xform(x, y, z, ry, rx, rz));
  }
  rect(minX, maxX, minZ, maxZ) {
    const pts = [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(this.m));
    return {
      minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
      minZ: Math.min(...pts.map(p => p.z)), maxZ: Math.max(...pts.map(p => p.z)),
    };
  }
}

const WORLD = new Frame(0, 0, 0);
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cbox: new THREE.BoxGeometry(1, 1, 1),
  ico: new THREE.IcosahedronGeometry(1, 1),
  pyramid: new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  wheel: new THREE.TorusGeometry(0.32, 0.03, 6, 18),
};

export function buildWorld(scene) {
  const W = {
    colliders: [],
    interact: [],
    collectibles: [],
    rects: [],
    updaters: [],
    lamps: [],
    classroomDoors: [],
    classroomRooms: [],
    ladders: [],
  };
  const batch = new Batch();
  const root = new THREE.Group();
  scene.add(root);

  const tex = {
    yard: T.terrazzoTexture(),
    granite: T.graniteTexture(),
    sidewalk: T.tileTexture('#a8584a', '#6f6a63', 6, 3),
    floor: T.tileTexture('#d8cfbf', '#a59d90', 4, 9),
    grass: T.grassTexture(),
    asphalt: T.asphaltTexture(),
    facade: T.facadeTexture(true),
    facadeBack: T.facadeTexture(false),
    balustrade: T.balustradeTexture(),
    fence: T.fencePanelTexture(),
    house: T.houseFacadeTexture(),
    breezeStair: T.breezeBlockStairTexture(),
  };

  const mats = {
    wall: M(0xf2d98c),
    trim: M(0xa8452f),
    yellowTrim: M(0xe2b955),
    column: M(0xfbf4df),
    gateYellow: M(0xf3cf55),
    darkRed: M(0x8e2a22),
    tileRoof: M(0xb5462e),
    fenceIron: M(0x252927, { metalness: 0.55, roughness: 0.48 }),
    fenceStone: M(0xb8b8b1, { roughness: 0.92 }),
    white: M(0xf6f3ea),
    grey: M(0x9b9b96),
    dark: M(0x2b2b2b),
    wood: M(0x7a4a2a),
    trunk: M(0x7d6048),
    palmTrunk: M(0xb7b0a2),
    leaf: M(0x3f7d2c, { flatShading: true }),
    leafDark: M(0x2f6a25, { flatShading: true }),
    palmLeaf: M(0x4f8f2f, { flatShading: true }),
    flower: M(0xe23d22, { flatShading: true }),
    flower2: M(0xf0662a, { flatShading: true }),
    bush: M(0x3d8a35, { flatShading: true }),
    soil: M(0x6b4a33),
    shedRoof: M(0x4b7eb3, { side: THREE.DoubleSide }),
    pole: M(0xdedede, { metalness: 0.6, roughness: 0.35 }),
    floorTile: texMat(tex.floor),
    yard: texMat(tex.yard),
    sidewalk: texMat(tex.sidewalk),
    asphalt: texMat(tex.asphalt, { roughness: 0.95 }),
    facade: texMat(tex.facade),
    facadeBack: texMat(tex.facadeBack),
    balustrade: texMat(tex.balustrade, { alphaTest: 0.5, side: THREE.DoubleSide }),
    fence: texMat(tex.fence, { alphaTest: 0.35, side: THREE.DoubleSide }),
    house: texMat(tex.house, { alphaTest: 0.5 }),
    breezeStair: texMat(tex.breezeStair, { transparent: true, alphaTest: 0.42, side: THREE.DoubleSide }),
    stairWall: M(0xecd178, { roughness: 0.9 }),
    stairParapet: M(0xd8cfbf, { roughness: 0.88 }),
    stairRiser: M(0xd8cfbf),
  };

  // ---------- helpers ----------
  function addCollider(F, minX, maxX, minZ, maxZ, top, bottom = 0, noCam = false) {
    W.colliders.push({ ...F.rect(minX, maxX, minZ, maxZ), top, bottom, noCam });
  }
  // Hộp có đáy tại y (không phải tâm). collide=true → thêm vật cản.
  function box(mat, F, w, h, d, x, y, z, { ry = 0, collide = false } = {}) {
    batch.add(mat, GEO.box, F.at(x, y, z, ry).multiply(new THREE.Matrix4().makeScale(w, h, d)));
    if (collide) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      addCollider(F, x - hw, x + hw, z - hd, z + hd, y + h, y);
    }
  }
  function cyl(mat, F, r, h, x, y, z, rTopScale = 1) {
    const g = new THREE.CylinderGeometry(r * rTopScale, r, h, 10).translate(0, h / 2, 0);
    batch.add(mat, g, F.at(x, y, z));
  }
  function blob(mat, F, x, y, z, sx, sy, sz) {
    batch.add(mat, GEO.ico, F.at(x, y, z).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)));
  }
  function plane(mat, F, w, h, x, y, z, ry = 0, su = 1, sv = 1) {
    const g = uvScale(new THREE.PlaneGeometry(w, h), su, sv);
    batch.add(mat, g, F.at(x, y, z, ry));
  }
  function campusLamp(x, z) {
    const metal = M(0x42484a, { metalness: 0.62, roughness: 0.4 });
    const housing = M(0x353b3d, { metalness: 0.48, roughness: 0.42 });
    const bulb = M(0xf4deb0, { emissive: 0xffc56b, emissiveIntensity: 0.02, roughness: 0.3 });
    cyl(metal, WORLD, 0.1, 5.4, x, 0, z, 0.58);
    cyl(metal, WORLD, 0.19, 0.2, x, 0, z, 0.72);
    box(metal, WORLD, 0.95, 0.07, 0.07, x, 5.15, z);
    box(housing, WORLD, 0.58, 0.15, 0.34, x + 0.18, 4.98, z);
    box(bulb, WORLD, 0.48, 0.025, 0.25, x + 0.18, 4.955, z);
    const light = new THREE.PointLight(0xffd18a, 0, 32, 2);
    light.position.set(x + 0.18, 4.9, z);
    scene.add(light);
    W.lamps.push({ light, bulb, maxIntensity: 24 });
    W.colliders.push({ minX: x - 0.22, maxX: x + 0.22, minZ: z - 0.22, maxZ: z + 0.22, top: 5.4 });
  }
  // Mặt phẳng riêng (không gộp) — dùng cho biển chữ có texture riêng.
  function sign(texture, w, h, x, y, z, ry = 0, doubleSided = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texMat(texture, { side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    root.add(m);
    return m;
  }
  function ground(mat, x, z, w, d, y, tileSize) {
    const g = uvScale(new THREE.PlaneGeometry(w, d), w / tileSize, d / tileSize);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  }
  function archPanel(mat, F, w, h, x, y, z) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-w / 2, h);
    s.lineTo(w / 2, h);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2 - 0.12, 0);
    s.absellipse(0, 0, w / 2 - 0.12, h - 0.18, 0, Math.PI, false);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false, curveSegments: 14 });
    batch.add(mat, g, F.at(x, y, z));
  }

  // ---------- mặt đất, sân, đường ----------
  ground(texMat(tex.grass, { roughness: 1 }), 0, 30, 520, 380, -0.06, 4);
  // toàn bộ sân trong tường rào lát gạch terrazzo hồng
  ground(mats.yard, 0, -4, 124, 80, 0.015, 0.8);
  ground(mats.sidewalk, 0, 38.15, 300, 3.7, 0.03, 0.9);
  ground(mats.asphalt, 0, 44, 300, 8, 0.02, 6);
  ground(texMat(T.tileTexture('#bdb9b0', '#9d988f', 4, 5)), 0, 50.5, 300, 5, 0.03, 0.7);

  // ---------- dãy nhà học ----------
  function roomPlate(F, name, lx, ly, lz, bw) {
    if (!name) return;
    const code = String(name).toUpperCase().replace(/\s/g, '');
    const isClass = isClassRoomCode(code);
    const label = isClass ? `LỚP ${code}` : String(name).toUpperCase();
    const tex = T.signTexture(label, {
      w: 800, h: 200, bg: isClass ? '#1f4fa0' : '#2e6b3a', fg: '#ffffff', border: '#ffffff', size: isClass ? 88 : 50,
    });
    const pw = Math.min(1.65, bw * 0.42);
    const ph = pw * (200 / 800);
    const mat = texMat(tex, { side: THREE.DoubleSide });
    mat.depthWrite = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
    mesh.applyMatrix4(F.at(lx, ly, lz));
    mesh.renderOrder = 4;
    mesh.receiveShadow = false;
    root.add(mesh);
  }
  function buildBlock(o) {
    const F = new Frame(o.x, o.z, o.ry);
    const { L, D, floors } = o;
    const H = floors * FH, C = 2.4;
    const bays = Math.max(2, Math.round(L / 4)), bw = L / bays;
    const front = D / 2, roomFront = D / 2 - C;
    const stairPink = mats.yard;
    const stairTrim = mats.floorTile;
    const trim = o.trim || mats.trim, colMat = o.columns || mats.column, solid = o.parapet === 'solid';
    const wallMat = o.wall || mats.wall;
    const facadeMat = o.facade || mats.facade;
    const facadeBack = o.facadeBack || mats.facadeBack;
    const passage = o.passage && o.passage.width > 0 ? o.passage : null;
    const passageLeft = passage ? passage.center - passage.width / 2 : 0;
    const passageRight = passage ? passage.center + passage.width / 2 : 0;
    const drawFacade = (mat, upperMat, x0, x1, z, ry, su, sv) => {
      if (!passage || x1 <= passageLeft || x0 >= passageRight) {
        plane(mat, F, x1 - x0, H, (x0 + x1) / 2, H / 2, z, ry, su, sv);
        return;
      }
      const upperH = H - FH;
      if (upperH > 0) plane(upperMat, F, x1 - x0, upperH, (x0 + x1) / 2, FH + upperH / 2, z, ry, su, sv - 1);
      const leftEnd = Math.min(x1, passageLeft);
      if (leftEnd > x0) plane(mat, F, leftEnd - x0, FH, (x0 + leftEnd) / 2, FH / 2, z, ry, (leftEnd - x0) / bw, 1);
      const rightStart = Math.max(x0, passageRight);
      if (x1 > rightStart) plane(mat, F, x1 - rightStart, FH, (rightStart + x1) / 2, FH / 2, z, ry, (x1 - rightStart) / bw, 1);
    };

    // khối phòng học, chừa các gian sảnh cầu thang (o.halls: toạ độ x mép trái của gian)
    const halls = o.halls || [], roomSlots = [];
    const roomSpan = Math.max(1, Math.floor(o.roomSpan || 1));
    const roomStep = Math.max(roomSpan, Math.floor(o.roomStep || 2));
    const roomSections = o.roomSections ? new Set(o.roomSections) : null;
    let segStart = -L / 2;
    let sectionIndex = 0;
    for (const edge of [...halls.slice().sort((a, b) => a - b), L / 2]) {
      const a = segStart, b = edge;
      if (b - a > 0.01) {
        const nBays = Math.round((b - a) / bw);
        const sectionSlots = [];
        drawFacade(facadeMat, facadeBack, a, b, roomFront + 0.01, 0, (b - a) / bw, floors);
        if (!roomSections || roomSections.has(sectionIndex)) {
          for (let k = 0; k + roomSpan <= nBays; k += roomStep) {
            const slot = { left: a + k * bw, width: roomSpan * bw, bayStart: k, index: roomSlots.length };
            roomSlots.push(slot);
            sectionSlots.push(slot);
          }
        }
        for (let bi = 0; bi < nBays; bi++) {
          const xc = a + (bi + 0.5) * bw;
          const bayLeft = xc - bw / 2, bayRight = xc + bw / 2;
          const isClassBay = sectionSlots.some(slot =>
            bi >= slot.bayStart && bi < slot.bayStart + roomSpan &&
            (o.rooms || []).some(names => isClassRoomCode(names?.[slot.index])));
          if (!isClassBay) {
            if (!passage || bayRight <= passageLeft || bayLeft >= passageRight) {
              box(wallMat, F, bw, H, D - C, xc, 0, -C / 2, { collide: true });
            } else {
              const upperH = H - FH;
              if (upperH > 0) box(wallMat, F, bw, upperH, D - C, xc, FH, -C / 2, { collide: true });
              const leftW = Math.max(0, Math.min(bayRight, passageLeft) - bayLeft);
              if (leftW > 0) box(wallMat, F, leftW, FH, D - C, bayLeft + leftW / 2, 0, -C / 2, { collide: true });
              const rightW = Math.max(0, bayRight - Math.max(bayLeft, passageRight));
              if (rightW > 0) box(wallMat, F, rightW, FH, D - C, bayRight - rightW / 2, 0, -C / 2, { collide: true });
            }
          }
        }
      }
      segStart = edge + bw;
      sectionIndex++;
    }
    drawFacade(facadeBack, facadeBack, -L / 2, L / 2, -D / 2 - 0.01, Math.PI, bays, floors);
    if (passage) box(mats.floorTile, F, passage.width, 0.04, D, passage.center, 0.015, 0, { collide: true });
    // nền hành lang tầng 1
    box(mats.floorTile, F, L + 0.4, 0.3, C + 0.2, 0, 0, front - C / 2 + 0.1, { collide: true });
    // sàn các tầng + mái
    for (let f = 1; f < floors; f++) box(trim, F, L + 0.3, 0.32, C + 0.15, 0, f * FH - 0.32, front - C / 2 + 0.075);
    box(trim, F, L + 0.6, 0.35, D + 0.5, 0, H, 0);
    const hatches = []; // lỗ mái phía trên thang sắt (toạ độ cục bộ)
    box(wallMat, F, L + 0.6, 0.9, 0.2, 0, H + 0.35, D / 2 + 0.15);
    box(wallMat, F, L + 0.6, 0.9, 0.2, 0, H + 0.35, -D / 2 - 0.15);
    for (const s of [-1, 1]) box(wallMat, F, 0.2, 0.9, D + 0.5, s * (L / 2 + 0.2), H + 0.35, 0);
    box(trim, F, L + 0.75, 0.12, 0.34, 0, H + 1.25, D / 2 + 0.15);
    // cột hành lang
    for (let i = 0; i <= bays; i++) {
      const x = -L / 2 + i * bw;
      if (passage && x > passageLeft && x < passageRight) continue;
      box(colMat, F, 0.42, H, 0.42, x, 0, front - 0.21, { collide: true });
    }
    for (let i = 0; i < bays; i++) {
      const xc = -L / 2 + (i + 0.5) * bw, w = bw - 0.42;
      for (let f = 1; f < floors; f++) {
        if (solid) {
          // lan can xây đặc + tay vịn sắt mảnh
          box(wallMat, F, w, 0.8, 0.14, xc, f * FH, front - 0.18);
          box(mats.grey, F, w, 0.04, 0.05, xc, f * FH + 1.05, front - 0.18);
          for (let k = 1; k < 4; k++) box(mats.grey, F, 0.03, 0.25, 0.03, xc - w / 2 + (k * w) / 4, f * FH + 0.8, front - 0.18);
        } else {
          plane(mats.balustrade, F, w, 0.95, xc, f * FH + 0.475, front - 0.18, 0, w / 0.9, 1);
          box(mats.column, F, bw, 0.08, 0.22, xc, f * FH + 0.95, front - 0.18);
        }
      }
      if (o.arches !== false) archPanel(wallMat, F, w, 1.3, xc, H - 1.3, front - 0.24);
    }
    // sàn hành lang các tầng trên + lan can: đi lại được trên tầng (va chạm có đáy)
    for (let f = 1; f < floors; f++) {
      addCollider(F, -L / 2 - 0.15, L / 2 + 0.15, roomFront - 0.05, front + 0.15, f * FH, f * FH - 0.32);
      addCollider(F, -L / 2, L / 2, front - 0.3, front - 0.05, f * FH + 1.05, f * FH, true);
    }
    // cầu thang ở một đầu nhà: hai đợt, chiếu nghỉ giữa tầng phía sau, chiếu tới phía hành lang
    const se = o.stairEnd || 1, endStair = o.stairs !== false;
    for (const s of [-1, 1]) {
      if (endStair && s === se) continue;
      box(wallMat, F, 0.25, H - 0.3, C - 0.4, s * (L / 2 - 0.1), 0.3, front - C / 2 - 0.2, { collide: true });
    }
    if (endStair) {
      const sw = 3, x0 = se * (L / 2 + 0.15), xc = x0 + se * sw / 2;
      const lane = [x0 + se * 0.75, x0 + se * 2.25];
      const zLand = front - C, zBack = -D / 2 + 1.2, n = 9, tread = (zLand - zBack) / n;
      const level = k => (k === 0 ? 0.3 : k * FH);
      // tường bao ba mặt (mặt giáp hành lang để trống), sàn tầng 1, mái
      box(wallMat, F, 0.2, H + 0.9, D, x0 + se * (sw + 0.1), 0, 0, { collide: true });
      box(wallMat, F, sw + 0.2, H + 0.9, 0.2, xc, 0, -D / 2 - 0.1, { collide: true });
      box(wallMat, F, sw + 0.2, H + 0.9, 0.2, xc, 0, front + 0.1, { collide: true });
      plane(facadeBack, F, sw, H, xc, H / 2, front + 0.21, 0, 1, floors);
      plane(facadeBack, F, D, H, x0 + se * (sw + 0.21), H / 2, 0, se * Math.PI / 2, 2, floors);
      box(trim, F, sw + 0.5, 0.35, D + 0.5, xc, H, 0);
      box(mats.floorTile, F, sw, 0.3, D, xc, 0, 0, { collide: true });
      // vách giữa hai đợt thang
      box(wallMat, F, 0.12, H, zLand - zBack, x0 + se * 1.5, 0, (zLand + zBack) / 2);
      const step = (lx, zc, top) => {
        box(stairPink, F, 1.5, 0.21, tread + 0.05, lx, top - 0.21, zc);
        box(stairTrim, F, 1.58, 0.05, 0.09, lx, top - 0.03, zc + tread / 2 - 0.05);
        addCollider(F, lx - 0.75, lx + 0.75, zc - tread / 2, zc + tread / 2, top, top - 0.3, true);
      };
      const slab = (z0, z1, top) => {
        box(stairPink, F, sw, 0.28, z1 - z0, xc, top - 0.28, (z0 + z1) / 2);
        box(stairTrim, F, sw + 0.08, 0.05, 0.14, xc, top - 0.03, z1 - 0.07);
        addCollider(F, Math.min(x0, x0 + se * sw), Math.max(x0, x0 + se * sw), z0, z1, top, top - 0.3, true);
      };
      for (let f = 0; f < floors - 1; f++) {
        const yA = level(f), yB = level(f + 1), mid = (yA + yB) / 2;
        for (let i = 1; i <= n; i++) step(lane[0], zLand - (i - 0.5) * tread, yA + (i * (mid - yA)) / n);
        slab(-D / 2, zBack, mid);
        for (let i = 1; i <= n; i++) step(lane[1], zBack + (i - 0.5) * tread, mid + (i * (yB - mid)) / n);
        slab(zLand, front, yB);
      }
      W.rects.push({ ...F.rect(Math.min(x0, x0 + se * sw), Math.max(x0, x0 + se * sw), -D / 2, D / 2), kind: 'building' });
      W.stairs = W.stairs || [];
      const entry = new THREE.Vector3(lane[0], 0, front - C / 2).applyMatrix4(F.m);
      W.stairs.push({ x: entry.x, z: entry.z });
    }
    // biển tên lớp/phòng — căn giữa ô lớp (cùng trục cửa), texture riêng từng biển (tránh lỗi UV atlas)
    (o.rooms || []).forEach((names, f) => names.forEach((name, i) => {
      if (!name || i >= roomSlots.length) return;
      const roomSlot = roomSlots[i];
      const roomLeft = roomSlot.left;
      const roomWidth = roomSlot.width;
      if (passage && f === 0 && roomLeft < passageRight && roomLeft + roomWidth > passageLeft) return;
      const xc = roomLeft + roomWidth * 0.5;
      // Biển trên vách cửa lớp (mặt hướng hành lang), mọi tầng — không đặt trước lan can.
      const plateY = f === 0 ? 2.9 : f * FH + 2.58;
      const plateZ = roomFront + 0.09;
      roomPlate(F, name, xc, plateY, plateZ, roomWidth);
      const code = String(name).toUpperCase().replace(/\s/g, '');
      if (isClassRoomCode(code)) {
        const shell = { xc, bw: roomWidth, D, roomFront, floorIndex: f };
        ensureClassroomShell(F, W, mats, batch, wallMat, shell);
        furnishClassroom(root, F, W, { ...shell, className: code });
        installClassroomDoor(root, F, W, { xc, roomFront, floorIndex: f, className: code });
        registerClassroomMeta(W, F, { ...shell, className: code });
        const zRoom = (-D / 2 + 0.35 + roomFront - 0.25) / 2;
        const cen = new THREE.Vector3(xc, f * FH + 1.2, zRoom).applyMatrix4(F.m);
        W.interact.push({
          x: cen.x,
          z: cen.z,
          r: 2.8,
          label: `Lớp ${code} (tầng ${f + 1})`,
          title: `Phòng ${code}`,
          text: `Phòng học lớp ${code}, tầng ${f + 1}. Đứng trước cửa hành lang, nhấn E để mở cửa rồi bước vào. Bàn ghế, bảng xanh, TV theo phòng học THPT Ninh Giang.`,
        });
      }
    }));
    // Sảnh cầu thang hai đợt (terrazzo hồng, viền beige, vách gạch bông — tham khảo 12 Trần Phú).
    for (const hx of halls) {
      const x0 = hx + 0.21, x1 = hx + bw - 0.21, hw = x1 - x0, xc = (x0 + x1) / 2;
      const lw = hw / 2 - 0.14;
      const zBack = -D / 2 + 1.05;
      const zHall = roomFront + 0.05;
      const zWallFace = zBack + 0.17;                      // mặt vách gạch bông (collider mỏng, không chặn chiếu nghỉ)
      const zLandBack = zBack + 0.38;                       // chiếu nghỉ trước vách — đủ chỗ tới chân thang sắt
      const zMid = zLandBack + 1.18;                        // mép trước chiếu nghỉ = nối hai đợt thang
      const n = 11;
      const tread = (zHall - zMid) / n;
      const level = k => (k === 0 ? 0.32 : k * FH);
      const lane = [x0 + lw / 2 + 0.06, x1 - lw / 2 - 0.06];
      const stairStep = (lx, lw_, zc, treadLen, top, nosingZ, riserZ, outerX) => {
        box(stairPink, F, lw_, 0.22, treadLen + 0.02, lx, top - 0.22, zc);
        box(stairTrim, F, 0.12, 0.055, treadLen + 0.06, outerX, top - 0.025, zc);
        box(stairTrim, F, lw_, 0.055, 0.09, lx, top - 0.025, nosingZ);
        box(mats.stairRiser, F, lw_ + 0.02, 0.2, 0.022, lx, top - 0.1, riserZ);
        addCollider(F, lx - lw_ / 2, lx + lw_ / 2, zc - treadLen / 2 - 0.02, zc + treadLen / 2 + 0.02, top, top - 0.28, true);
      };
      const landing = (z0, z1, top, rails = true) => {
        const depth = z1 - z0, zc = (z0 + z1) / 2;
        box(stairPink, F, hw, 0.3, depth, xc, top - 0.3, zc);
        const bd = 0.16;
        box(stairTrim, F, hw, 0.055, bd, xc, top - 0.02, z0 + bd / 2);
        box(stairTrim, F, hw, 0.055, bd, xc, top - 0.02, z1 - bd / 2);
        box(stairTrim, F, bd, 0.055, depth, x0 + bd / 2, top - 0.02, zc);
        box(stairTrim, F, bd, 0.055, depth, x1 - bd / 2, top - 0.02, zc);
        if (rails) box(mats.stairParapet, F, hw, 0.06, 0.1, xc, top + 0.68, z0 + 0.08);
        addCollider(F, x0, x1, z0, z1, top, top - 0.34, true);
      };
      // khối sảnh: tường vàng nhạt, đáy vách gạch bông, thang sắt sát vách
      box(stairPink, F, hw, 0.34, D - C + 0.2, xc, 0, (-D / 2 + roomFront) / 2, { collide: true });
      box(stairTrim, F, hw + 0.08, 0.07, 0.18, xc, 0.02, zHall + 0.06);
      box(mats.stairWall, F, hw, H, 0.18, xc, 0, -D / 2 + 0.12, { collide: true });
      plane(mats.breezeStair, F, hw - 0.12, H, xc, H / 2, zBack + 0.19, 0, (hw - 0.12) / 2.05, H / 2.05);
      addCollider(F, x0, x1, zWallFace - 0.05, zWallFace + 0.05, H, 0, true); // chỉ mặt phẳng vách, không nuốt chiếu nghỉ
      box(mats.stairWall, F, 0.16, H, roomFront - zBack + 0.5, x0 + 0.08, 0, (roomFront + zBack) / 2);
      box(mats.stairWall, F, 0.16, H, roomFront - zBack + 0.5, x1 - 0.08, 0, (roomFront + zBack) / 2);
      // Lan can giữa hai đợt: tường lửng xây chạy dốc theo bậc + tay vịn (có va chạm từng bậc).
      const railH = 0.9;
      const flightRail = (rx, zS, yS, zE, yE) => {
        const dz = zE - zS, dy = yE - yS, len = Math.hypot(dz, dy);
        const sgn = dz < 0 ? -1 : 1, ang = -Math.atan2(dy * sgn, dz * sgn);
        const zc = (zS + zE) / 2, yc = (yS + yE) / 2;
        batch.add(mats.stairParapet, GEO.cbox, F.at(rx, yc + railH / 2, zc, 0, ang).multiply(new THREE.Matrix4().makeScale(0.12, railH, len)));
        batch.add(stairTrim, GEO.cbox, F.at(rx, yc + railH + 0.03, zc, 0, ang).multiply(new THREE.Matrix4().makeScale(0.2, 0.07, len + 0.06)));
      };
      const ladderX = xc, ladderZ = zBack + 0.3;          // thang sắt giữa vách gạch bông
      const ladderF = Math.max(0, floors - 2);              // đợt thang tầng 2 → 3 (tầng trên cùng)
      const midA = (level(ladderF) + level(ladderF + 1)) / 2; // chân thang = chiếu nghỉ của đợt đó
      const roofTop = H + 0.35, railTop = roofTop + 1.0;
      for (const side of [-1, 1]) box(mats.pole, F, 0.05, railTop - midA, 0.05, ladderX + side * 0.22, midA, ladderZ);
      for (let y = midA + 0.35; y < railTop - 0.1; y += 0.35) box(mats.pole, F, 0.44, 0.03, 0.04, ladderX, y, ladderZ);
      // lỗ chui lên mái + viền
      const hz0 = ladderZ - 0.2, hz1 = ladderZ + 0.78, hx0 = ladderX - 0.45, hx1 = ladderX + 0.45;
      hatches.push({ x0: hx0, x1: hx1, z0: hz0, z1: hz1 });
      box(M(0x222222), F, hx1 - hx0, 0.02, hz1 - hz0, ladderX, roofTop + 0.005, (hz0 + hz1) / 2);
      box(mats.grey, F, hx1 - hx0 + 0.16, 0.12, 0.08, ladderX, roofTop, hz1 + 0.04);
      const hang = new THREE.Vector3(ladderX, 0, ladderZ + 0.38).applyMatrix4(F.m);
      const topOut = new THREE.Vector3(ladderX, 0, hz1 + 0.55).applyMatrix4(F.m);
      const botOut = new THREE.Vector3(ladderX, 0, ladderZ + 0.75).applyMatrix4(F.m);
      const face = Math.atan2(-(hang.x - new THREE.Vector3(ladderX, 0, ladderZ).applyMatrix4(F.m).x), -(hang.z - new THREE.Vector3(ladderX, 0, ladderZ).applyMatrix4(F.m).z));
      W.ladders.push({ x: hang.x, z: hang.z, y0: midA, y1: roofTop, top: { x: topOut.x, z: topOut.z }, bottom: { x: botOut.x, z: botOut.z }, face });
      landing(zHall - 0.18, zHall + 0.22, level(0), false);
      for (let f = 0; f < floors - 1; f++) {
        const yA = level(f), yB = level(f + 1), mid = (yA + yB) / 2;
        const outer0 = lane[0] - lw / 2 - 0.05;
        const outer1 = lane[1] + lw / 2 + 0.05;
        for (let i = 1; i <= n; i++) {
          const zc = zHall - (i - 0.5) * tread;
          const top = yA + (i * (mid - yA)) / n;
          const nosing = zc - tread / 2 + 0.04;
          stairStep(lane[0], lw, zc, tread, top, nosing, zc - tread / 2 - 0.02, outer0);
        }
        landing(zLandBack - 0.04, zMid + tread * 0.45, mid, false);
        for (let i = 1; i <= n; i++) {
          const zc = zMid + (i - 0.5) * tread;
          const top = mid + (i * (yB - mid)) / n;
          const nosing = zc + tread / 2 - 0.04;
          stairStep(lane[1], lw, zc, tread, top, nosing, zc + tread / 2 + 0.02, outer1);
        }
        landing(zHall - 0.22, zHall + 0.2, yB, false);
        box(mats.trim, F, hw + 0.04, 0.08, 0.22, xc, yB - 0.04, zHall + 0.14);
        // lan can giữa: mỗi đợt một bức lửng dốc theo mũi bậc
        flightRail(xc - 0.07, zHall, yA, zMid, mid);
        flightRail(xc + 0.07, zMid, mid, zHall, yB);
        for (let i = 1; i <= n; i++) {
          const z0 = zHall - i * tread, z1 = z0 + tread;
          if (z1 <= zMid + 0.08 && z0 >= zLandBack - 0.08) continue; // chiếu nghỉ giữa: đi ngang sang đợt kia
          if (f > 0 && z1 <= zHall + 0.22 && z0 >= zHall - 0.28) continue; // chiếu nghỉ hành lang tầng trên
          const h0 = yA + (i * (mid - yA)) / n;
          const h1 = mid + ((n + 1 - i) * (yB - mid)) / n;
          addCollider(F, xc - 0.13, xc, z0, z1, h0 + railH, h0 - 0.3, true);
          addCollider(F, xc, xc + 0.13, z0, z1, h1 + railH, h1 - 0.3, true);
        }
      }
      W.stairHalls = W.stairHalls || [];
      const wp = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(F.m); return [+v.x.toFixed(2), +v.z.toFixed(2)]; };
      W.stairHalls.push({ lane0: wp(lane[0], zHall + 0.6), lane0Mid: wp(lane[0], zMid), lane1Mid: wp(lane[1], zMid), lane1Hall: wp(lane[1], zHall + 0.6), floors, FH });
      W.stairs = W.stairs || [];
      const entryX = hx < 0 ? lane[1] : lane[0];
      const entry = new THREE.Vector3(entryX, 0, zHall + 0.12).applyMatrix4(F.m);
      W.stairs.push({ x: entry.x, z: entry.z });
      W.interact.push({
        x: entry.x, z: entry.z, r: 3.2,
        label: 'Cầu thang lên tầng trên',
        title: 'Sảnh cầu thang',
        text: '① Từ hành lang vào sảnh, đi thẳng vào trong (theo hướng nhìn) xuống đợt 1. ② Chiếu nghỉ sát vách gạch bông — đi ngang sang đợt 2. ③ Lên tầng trên, lặp lại. Thang sắt lên mái chỉ ở chiếu nghỉ tầng 2→3 (sau khi lên tầng 3 một đoạn rồi quay lại chiếu nghỉ sâu trong): đứng sát thang, giữ W leo, S xuống, Space buông tay.',
      });
    }
    // sàn mái đi được (chừa lỗ thang sắt) + lan can mái có va chạm
    {
      const rx0 = -L / 2 - 0.2, rx1 = L / 2 + 0.2, rz0 = -D / 2 - 0.1, rz1 = D / 2 + 0.1, top = H + 0.35, bot = H + 0.04;
      let cx = rx0;
      for (const h of hatches.slice().sort((a, b) => a.x0 - b.x0)) {
        if (h.x0 > cx) addCollider(F, cx, h.x0, rz0, rz1, top, bot, true);
        addCollider(F, h.x0, h.x1, rz0, h.z0, top, bot, true);
        addCollider(F, h.x0, h.x1, h.z1, rz1, top, bot, true);
        cx = h.x1;
      }
      addCollider(F, cx, rx1, rz0, rz1, top, bot, true);
      addCollider(F, -L / 2 - 0.3, L / 2 + 0.3, D / 2 + 0.05, D / 2 + 0.25, top + 0.9, top - 0.05, true);
      addCollider(F, -L / 2 - 0.3, L / 2 + 0.3, -D / 2 - 0.25, -D / 2 - 0.05, top + 0.9, top - 0.05, true);
      for (const sx of [-1, 1]) addCollider(F, sx * (L / 2 + 0.1) - 0.1, sx * (L / 2 + 0.1) + 0.1, -D / 2 - 0.25, D / 2 + 0.25, top + 0.9, top - 0.05, true);
    }
    W.rects.push({ ...F.rect(-L / 2, L / 2, -D / 2, D / 2), kind: 'building' });
    return { F, H, front, bays, bw };
  }

  // Nhà học chính (theo ảnh trên website trường): 3 tầng, sảnh giữa, biển tên trên nóc.
  const FRONT_ROW_OLD_Z = 11.5;
  const FRONT_ROW_Z = -36;
  const FRONT_ROW_SHIFT = FRONT_ROW_Z - FRONT_ROW_OLD_Z;
  const AZ = FRONT_ROW_OLD_Z - 8;
  // hai sảnh cầu thang ngay hai bên sân khấu (ảnh khai giảng 2023: bên trái; ảnh bế giảng 2022: bên phải)
  const seq = (pre, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${pre}${a + i}`);
  // Khối 12 = A, khối 11 = B, khối 10 = C (theo biển lớp trong ảnh 2026); thứ tự phòng là giả định.
  const A = buildBlock({ x: 0, z: AZ, ry: 0, L: 88, D: 10, floors: 3, stairs: false, halls: [-16, 12], passage: { center: 2, width: 8 },
    facade: mats.facadeBack,
    roomSpan: 2, roomSections: [0, 2],
    rooms: [seq('12A', 1, 6), seq('11B', 1, 6), seq('10C', 1, 6)] });
  {
    const { F, H, front } = A;
    const pd = 3.2, pz = front + pd / 2;
    for (const s of [-1, 1]) box(mats.wall, F, 1.0, H + 1.6, pd, s * 4.5, 0, pz, { collide: true });
    for (const s of [-1, 1]) {
      cyl(mats.column, F, 0.3, H, s * 1.9, 0, front + pd - 0.4);
      addCollider(F, s * 1.9 - 0.3, s * 1.9 + 0.3, front + pd - 0.7, front + pd - 0.1, H);
    }
    for (let f = 1; f <= 3; f++) box(mats.trim, F, 10, 0.34, pd + 0.1, 0, f * FH - (f === 3 ? 0 : 0.34), pz);
    box(mats.floorTile, F, 10, 0.3, pd, 0, 0, pz, { collide: true });
    box(mats.floorTile, F, 8, 0.2, 0.5, 0, 0, front + pd + 0.25);
    box(mats.floorTile, F, 8, 0.1, 0.5, 0, 0, front + pd + 0.75);
    for (let f = 1; f < 3; f++) plane(mats.balustrade, F, 7.4, 0.95, 0, f * FH + 0.475, front + pd - 0.12, 0, 7.4 / 0.9, 1);
    box(mats.wall, F, 10, 1.7, 0.4, 0, H + 0.1, front + pd - 0.2);
    box(mats.trim, F, 10.4, 0.2, pd + 0.4, 0, H + 1.8, pz);
    sign(T.signTexture('TRƯỜNG TRUNG HỌC PHỔ THÔNG NINH GIANG', { w: 2048, h: 240, bg: '#f7efd9', fg: '#c62828', border: null, size: 150 }),
      9.4, 1.1, 0, H + 0.95, AZ + front + pd + 0.02);
    // cột cờ trên nóc sảnh
    cyl(mats.pole, F, 0.05, 4.2, 0, H + 2.0, pz);
    W.roofFlag = { x: 0, y: H + 5.9, z: AZ + pz };
    // băng rôn dọc hai bên sảnh
    const banners = [['DẠY', 'TỐT'], ['HỌC', 'TỐT']];
    [-1, 1].forEach((s, i) => sign(T.verticalBannerTexture(banners[i]), 1.2, 6.2, s * 7, FH + 3.35, AZ + front + 0.12));
    // băng rôn xanh lời Bác ở lan can tầng 3 (theo ảnh lễ bế giảng 2022)
    sign(T.signTexture([
      { text: '“Non sông Việt Nam có trở nên tươi đẹp hay không, dân tộc Việt Nam có bước tới đài vinh quang để sánh vai', size: 44, weight: 'normal' },
      { text: 'với các cường quốc năm châu được hay không, chính là nhờ một phần lớn ở công học tập của các em.” — HỒ CHÍ MINH', size: 44, weight: 'normal' },
    ], { w: 2400, h: 150, bg: '#1f3f9a', fg: '#ffffff', border: null }), 15, 0.9, -22, 2 * FH + 0.5, AZ + front + 0.02);
    W.interact.push({
      x: 0, z: AZ + front - 1.2, r: 4,
      label: 'Hành lang các lớp',
      title: 'Phòng học',
      text: 'Mỗi tầng có 6 phòng học rộng, bàn ghế xếp thành các hàng ngang. Các lớp nằm dọc hành lang; lối đi giữa nối sân trước với sân sau. Đứng trước cửa, nhấn E để mở rồi bước vào. Lên tầng 2, 3 bằng cầu thang hai bên sảnh.',
    });
    W.interact.push({
      x: 0, z: AZ, r: 14, minY: 9.6,
      label: 'Mái nhà học chính',
      title: 'Trên nóc trường',
      text: 'Nhìn xuống sân trong, sảnh và cây xanh. Leo xuống bằng thang sắt trong sảnh cầu thang hai bên sân khấu. Cẩn thận lan can mé mái!',
    });
  }
  // Đài phun nước nhiều tầng trước sảnh Nhà học chính.
  {
    const x = 0, z = 18.5;
    const stone = M(0xd8d1c1, { roughness: 0.72 });
    const trim = M(0xf1ead9, { roughness: 0.62 });
    const water = M(0x64b5c3, { transparent: true, opacity: 0.78, metalness: 0.08, roughness: 0.24, side: THREE.DoubleSide });
    water.userData.noShadow = true;
    const cylinder = (mat, top, bottom, h, y) => {
      batch.add(mat, new THREE.CylinderGeometry(top, bottom, h, 40).translate(0, h / 2, 0), xform(x, y, z));
    };
    const ring = (mat, radius, thickness, y) => {
      batch.add(mat, new THREE.TorusGeometry(radius, thickness, 8, 48).rotateX(Math.PI / 2), xform(x, y, z));
    };
    const waterDisk = (radius, y) => {
      batch.add(water, new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), xform(x, y, z));
    };
    const bowl = (radius, bottom, y, h, waterLevel, waterRadius) => {
      const profile = [
        new THREE.Vector2(bottom, y),
        new THREE.Vector2(radius * 0.72, y + h * 0.12),
        new THREE.Vector2(radius * 0.96, y + h * 0.8),
        new THREE.Vector2(radius, y + h),
        new THREE.Vector2(radius - 0.2, y + h),
        new THREE.Vector2(radius * 0.78, y + h * 0.58),
        new THREE.Vector2(waterRadius, y + h * 0.18),
      ];
      batch.add(stone, new THREE.LatheGeometry(profile, 40), xform(x, 0, z));
      waterDisk(waterRadius, waterLevel);
      ring(trim, radius - 0.08, 0.12, y + h - 0.02);
    };

    cylinder(stone, 4.35, 4.5, 0.28, 0.02);
    ring(trim, 4.12, 0.13, 0.3);
    bowl(4.05, 1.15, 0.24, 0.92, 0.72, 3.05);
    cylinder(trim, 1.02, 1.35, 0.42, 0.58);
    cylinder(stone, 0.58, 0.82, 0.72, 0.94);
    ring(trim, 0.83, 0.12, 1.55);
    bowl(2.15, 0.6, 1.38, 0.66, 1.86, 1.53);
    cylinder(stone, 0.44, 0.68, 0.82, 1.95);
    cylinder(trim, 0.76, 0.9, 0.22, 2.67);
    bowl(1.42, 0.38, 2.78, 0.5, 3.13, 0.94);
    cylinder(stone, 0.22, 0.42, 0.62, 3.2);
    cylinder(water, 0.055, 0.09, 0.7, 3.76);
    batch.add(trim, new THREE.SphereGeometry(0.16, 12, 10), xform(x, 4.45, z));
    W.colliders.push({ minX: x - 4.5, maxX: x + 4.5, minZ: z - 4.5, maxZ: z + 4.5, top: 1.2 });
  }
  // Nhà vệ sinh học sinh — bên phải dãy nhà học chính, quay cửa ra sân trong
  {
    const x0 = 45.5, x1 = 53.5, z0 = -38.8, z1 = -33.2, h = 3.15, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const wcWall = M(0xe6eef2, { roughness: 0.9 });
    box(wcWall, WORLD, w, h, d, xc, 0, zc, { collide: true });
    box(mats.floorTile, WORLD, w + 0.1, 0.22, d + 0.1, xc, 0, zc);
    box(mats.trim, WORLD, w + 0.25, 0.18, d + 0.25, xc, h, zc);
    batch.add(mats.tileRoof, GEO.pyramid, xform(xc, h + 0.12, zc).multiply(new THREE.Matrix4().makeScale(w + 0.35, 0.75, d + 0.25)));
    box(wcWall, WORLD, 0.14, h - 0.4, d - 0.6, xc, 0.35, zc);
    for (const [dx, label, bg] of [[-1.85, 'NAM', '#1565c0'], [1.85, 'NỮ', '#ad1457']]) {
      const dx_ = dx;
      box(mats.wood, WORLD, 0.95, 2.05, 0.08, xc + dx_, 0.35, z1 + 0.02);
      box(M(0xf5f5f5), WORLD, 0.88, 0.45, 0.06, xc + dx_, 1.55, z1 + 0.03);
      sign(T.signTexture(label, { w: 220, h: 100, bg, fg: '#ffffff', border: '#ffffff' }), 0.5, 0.32, xc + dx_, 2.5, z1 + 0.05);
    }
    sign(T.signTexture('NHÀ VỆ SINH', { w: 640, h: 110, bg: '#546e7a', fg: '#ffffff', border: '#cfd8dc' }), 2.0, 0.36, xc, h + 0.08, z1 + 0.04);
    box(mats.grey, WORLD, 0.12, 2.2, 0.12, x0 + 0.25, 0, z0 + 0.35, { collide: true });
    box(mats.grey, WORLD, 0.12, 2.2, 0.12, x1 - 0.25, 0, z0 + 0.35, { collide: true });
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'building' });
    W.interact.push({
      x: xc, z: z1 + 1.8, r: 3.2,
      label: 'Nhà vệ sinh',
      title: 'Nhà vệ sinh học sinh',
      text: 'Khối nhà một tầng sát dãy nhà học chính, cửa quay ra sân trong. Hai khoang Nam / Nữ quen thuộc với học sinh giữa các tiết, sau giờ ra chơi và giữa kỳ thi.\n\nBạn có thể bước quanh để nhớ lại hàng chờ trước cửa, tiếng nước và những cuộc trò chuyện ngắn giữa sân trường.',
    });
  }
  // Hai dãy nhà hai bên sân rộng: trái 3 tầng, phải 2 tầng (bố cục phỏng đoán, giữ sân thoáng).
  buildBlock({ x: -55, z: -8, ry: Math.PI / 2, L: 48, D: 9, floors: 3, rooms: [
    [...seq('12A', 10, 12), 'Phòng Tin học 1', 'Phòng Tin học 2', 'Thư viện'],
    [...seq('11B', 10, 12), 'Phòng TN Vật lí', 'Phòng TN Hóa học', 'Phòng TN Sinh học'],
    [...seq('10C', 10, 12), 'Phòng Ngoại ngữ', 'Phòng Đa năng', 'Phòng Đoàn TN'],
  ] });
  buildBlock({ x: 55, z: -8, ry: -Math.PI / 2, L: 48, D: 9, floors: 3, rooms: [
    ['Phòng Hiệu trưởng', 'Phòng Phó HT', 'Văn phòng', 'Phòng Hội đồng', 'Phòng Kế toán', 'Phòng Y tế'],
    ['Tổ Toán', 'Tổ Ngữ văn', 'Tổ Ngoại ngữ', 'Tổ Lý – Tin', 'Tổ Hóa – Sinh', 'Tổ Sử – Địa'],
    ['Phòng Bộ môn 7', 'Phòng Bộ môn 8', 'Phòng Công nghệ', 'Phòng Tin học', 'Phòng Thiết kế', 'Phòng Tổ chức'],
  ] });
  // Hai dãy nhà 2 tầng được chuyển về vị trí cũ của Nhà học chính.
  const frontRooms = { [-1]: [['Phòng Truyền thống', 'Phòng Công đoàn', 'Phòng Thiết bị'], ['Phòng Bộ môn 1', 'Phòng Bộ môn 2', 'Phòng Bộ môn 3']],
    1: [['Phòng Đọc', 'Phòng Tư vấn HS', 'Phòng Giám thị'], ['Phòng Bộ môn 4', 'Phòng Bộ môn 5', 'Phòng Bộ môn 6']] };
  for (const s of [-1, 1]) buildBlock({ x: s * 17.5, z: FRONT_ROW_Z, ry: 0, L: 25, D: 9, floors: 2, stairEnd: s, parapet: 'solid', arches: false, trim: mats.yellowTrim, columns: mats.wall, rooms: frontRooms[s] });
  {
    const green = M(0x3f9a4a, { metalness: 0.4, roughness: 0.5 });
    const canopyZ = 16.6 + FRONT_ROW_SHIFT;
    for (const s of [-1, 1]) box(green, WORLD, 0.25, 6.0, 0.25, s * 4.6, 0, canopyZ, { collide: true });
    box(green, WORLD, 9.5, 0.22, 0.22, 0, 5.9, canopyZ);
    box(green, WORLD, 9.5, 0.12, 0.12, 0, 5.15, canopyZ);
    for (let i = 0; i < 8; i++) batch.add(green, GEO.cbox, xform(-4.1 + i * 1.17, 5.6, canopyZ, 0, 0, i % 2 ? 0.75 : -0.75).multiply(new THREE.Matrix4().makeScale(0.07, 0.95, 0.07)));
    sign(T.signTexture('NHIỆT LIỆT CHÀO MỪNG CÁC THẦY CÔ GIÁO, CỰU HỌC SINH VỀ THĂM TRƯỜNG', { w: 2200, h: 200, bg: '#f2b8c6', fg: '#b3261e', border: '#ffffff' }),
      9.0, 0.85, 0, 4.55, canopyZ + 0.16, 0, true);
    // mái che lối đi giữa hai dãy nhà
    const canopyMidZ = 11.8 + FRONT_ROW_SHIFT;
    box(M(0xcfd6da, { metalness: 0.3 }), WORLD, 9.4, 0.06, 9.6, 0, 3.4, canopyMidZ);
    for (const s of [-1, 1]) for (const z of [7.4 + FRONT_ROW_SHIFT, canopyMidZ]) box(mats.grey, WORLD, 0.1, 3.4, 0.1, s * 4.5, 0, z, { collide: true });
    W.interact.push({
      x: 0, z: 18.2 + FRONT_ROW_SHIFT, r: 3.6, label: 'Xem cổng chào',
      title: 'Lối vào sân trong',
      text: 'Giữa hai dãy nhà 2 tầng là lối đi có mái che dẫn vào sân trong rộng, lát gạch hồng. Cổng chào khung thép xanh treo băng rôn “Nhiệt liệt chào mừng các thầy cô giáo, cựu học sinh về thăm trường”.\n\nNhìn qua lối đi là nhà học chính 3 tầng; sân khấu nằm sâu hơn trong sân. Cờ treo trên nóc sảnh, không có cột cờ giữa sân.',
    });
    // chậu cây cảnh trước hai dãy nhà
    const pot = M(0xa2532f);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
      const x = s * (7 + i * 5.2), z = 16.9 + FRONT_ROW_SHIFT;
      batch.add(pot, new THREE.CylinderGeometry(0.42, 0.3, 0.55, 12).translate(0, 0.275, 0), xform(x, 0, z));
      blob(i % 2 ? mats.bush : mats.leafDark, WORLD, x, 0.95, z, 0.5, 0.45, 0.5);
      W.colliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, top: 1.2 });
    }
  }

  // ---------- tường rào & cổng (theo ảnh cổng trường) ----------
  function fenceRun(a, b, z, alongZ = false) {
    const len = Math.abs(b - a), n = Math.max(1, Math.round(len / 3.2)), step = len / n;
    const ry = alongZ ? Math.PI / 2 : 0;
    const pos = t => (alongZ ? [z, a + Math.sign(b - a) * t] : [a + Math.sign(b - a) * t, z]);
    for (let i = 0; i < n; i++) {
      const [x, zz] = pos((i + 0.5) * step);
      box(mats.fenceStone, WORLD, step, 0.42, 0.34, x, 0, zz, { ry });
      box(mats.fence, WORLD, step - 0.45, 1.34, 0.14, x, 0.42, zz, { ry });
      box(mats.fenceIron, WORLD, step, 0.07, 0.2, x, 0.42, zz, { ry });
      box(mats.fenceIron, WORLD, step, 0.07, 0.2, x, 1.69, zz, { ry });
    }
    for (let i = 0; i <= n; i++) {
      const [x, zz] = pos(i * step);
      box(mats.fenceStone, WORLD, 0.46, 1.92, 0.46, x, 0, zz);
      box(mats.fenceStone, WORLD, 0.58, 0.14, 0.58, x, 1.92, zz);
      batch.add(mats.fenceIron, GEO.pyramid, xform(x, 2.06, zz).multiply(new THREE.Matrix4().makeScale(0.24, 0.26, 0.24)));
    }
    const [x0, z0] = pos(0), [x1, z1] = pos(len);
    W.colliders.push({ minX: Math.min(x0, x1) - 0.3, maxX: Math.max(x0, x1) + 0.3, minZ: Math.min(z0, z1) - 0.3, maxZ: Math.max(z0, z1) + 0.3, top: 2.4 });
  }
  fenceRun(-62, -6.6, 36);
  fenceRun(6.6, 62, 36);
  fenceRun(36, -44, 62, true);
  fenceRun(-62, 62, -44);

  // Mặt cổng vẽ bằng Canvas 2D; phần giữa để trong suốt để nhìn xuyên vào sân.
  const gz = 36;
  const gateFace = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 8.2),
    texMat(T.schoolGateTexture(), { alphaTest: 0.45, side: THREE.DoubleSide }),
  );
  gateFace.position.set(0, 4.1, gz + 0.42);
  gateFace.receiveShadow = true;
  root.add(gateFace);
  W.colliders.push(
    { minX: -9.3, maxX: -5.25, minZ: gz - 0.2, maxZ: gz + 0.5, top: 3.1 },
    { minX: 5.25, maxX: 9.3, minZ: gz - 0.2, maxZ: gz + 0.5, top: 3.1 },
  );

  const gateIron = M(0x252a29, { metalness: 0.55, roughness: 0.48 });
  // Hai cánh song sắt đen mở vuông góc vào trong sân.
  for (const s of [-1, 1]) {
    const x = s * 5.2, len = 3.0, zMid = gz - len / 2;
    for (const y of [0.08, 1.18, 2.45]) box(gateIron, WORLD, 0.08, 0.08, len, x, y, zMid);
    for (let i = 0; i <= 14; i++) {
      const z = gz - i * (len / 14);
      box(gateIron, WORLD, 0.045, 2.42, 0.045, x, 0.08, z);
      if (i % 2 === 0) blob(gateIron, WORLD, x, 2.62, z, 0.055, 0.09, 0.055);
    }
    W.colliders.push({ minX: x - 0.07, maxX: x + 0.07, minZ: gz - len, maxZ: gz, top: 2.7 });
  }
  const gateFloodMetal = M(0x454a4d, { metalness: 0.6, roughness: 0.4 });
  const gateFloodHousing = M(0x33393c, { metalness: 0.45, roughness: 0.42 });
  const gateFloodBulb = M(0xffe5ad, { emissive: 0xffc66b, emissiveIntensity: 0.02, roughness: 0.28 });
  for (const s of [-1, 1]) {
    const x = s * 11.8, z = 33.4, headX = x - s * 0.35;
    cyl(gateFloodMetal, WORLD, 0.11, 8.8, x, 0, z, 0.55);
    cyl(gateFloodMetal, WORLD, 0.22, 0.28, x, 0, z, 0.72);
    box(gateFloodMetal, WORLD, 1.1, 0.08, 0.08, headX, 8.55, z);
    box(gateFloodHousing, WORLD, 0.78, 0.34, 0.5, headX, 8.21, z);
    box(gateFloodBulb, WORLD, 0.65, 0.025, 0.38, headX, 8.185, z);
    const light = new THREE.SpotLight(0xffe6bc, 0, 70, Math.PI / 3, 0.45, 2);
    light.position.set(headX, 8.16, z);
    light.target.position.set(s * 5, 0.5, 8);
    scene.add(light, light.target);
    W.lamps.push({ light, bulb: gateFloodBulb, maxIntensity: 160 });

    const facadeY = 7.45;
    box(gateFloodMetal, WORLD, 1.1, 0.08, 0.08, headX, facadeY + 0.34, z);
    box(gateFloodHousing, WORLD, 0.78, 0.34, 0.5, headX, facadeY, z);
    box(gateFloodBulb, WORLD, 0.65, 0.025, 0.38, headX, facadeY - 0.025, z);
    const facadeLight = new THREE.SpotLight(0xfff1d8, 0, 55, Math.PI / 4.5, 0.4, 2);
    facadeLight.position.set(headX, facadeY - 0.05, z);
    facadeLight.target.position.set(s * 9.5, 2.4, gz + 0.45);
    scene.add(facadeLight, facadeLight.target);
    W.lamps.push({ light: facadeLight, bulb: gateFloodBulb, maxIntensity: 850 });
    W.colliders.push({ minX: x - 0.24, maxX: x + 0.24, minZ: z - 0.24, maxZ: z + 0.24, top: 8.8 });
  }
  // Đèn rọi biển tên từ phía đường để bảng sáng rõ vào ban đêm.
  const signLightMetal = M(0x454a4d, { metalness: 0.6, roughness: 0.4 });
  const signLightBulb = M(0xffe5ad, { emissive: 0xffc66b, emissiveIntensity: 0.02, roughness: 0.28 });
  for (const s of [-1, 1]) {
    const x = s * 3.2;
    box(signLightMetal, WORLD, 0.5, 0.14, 0.32, x, 5.8, 37.9);
    box(signLightBulb, WORLD, 0.38, 0.025, 0.22, x, 5.78, 37.72);
    const light = new THREE.SpotLight(0xffe6bc, 0, 12, Math.PI / 3, 0.45, 2);
    light.position.set(x, 5.75, 37.72);
    light.target.position.set(x, 4.52, 36.42);
    scene.add(light, light.target);
    W.lamps.push({ light, bulb: signLightBulb, maxIntensity: 150 });
  }
  // phòng bảo vệ nhỏ ngay phía trong cổng, bên trái lối vào (chỗ thầy Dương đứng trực)
  {
    const x0 = -9.2, x1 = -5.2, z0 = 30.9, z1 = 34.7, h = 2.9, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    const glass = M(0x3d5560, { roughness: 0.25, metalness: 0.2 });
    box(mats.gateYellow, WORLD, x1 - x0, h, z1 - z0, xc, 0, zc, { collide: true });
    box(mats.grey, WORLD, x1 - x0 + 0.1, 0.3, z1 - z0 + 0.1, xc, 0, zc);
    box(mats.trim, WORLD, x1 - x0 + 0.6, 0.18, z1 - z0 + 0.6, xc, h, zc);
    batch.add(mats.tileRoof, GEO.pyramid, xform(xc, h + 0.18, zc).multiply(new THREE.Matrix4().makeScale(3.2, 1.1, 3.0)));
    // cửa ra vào quay về lối đi, cửa sổ nhìn ra cổng và ra sân
    box(mats.wood, WORLD, 0.06, 2.1, 0.95, x1 + 0.02, 0.3, zc - 0.9);
    box(M(0xfbf6e6), WORLD, 0.05, 1.0, 1.5, x1 + 0.02, 1.1, zc + 0.75);
    box(glass, WORLD, 0.07, 0.85, 1.35, x1 + 0.03, 1.18, zc + 0.75);
    box(M(0xfbf6e6), WORLD, 1.8, 1.0, 0.05, xc, 1.1, z1 + 0.02);
    box(glass, WORLD, 1.65, 0.85, 0.07, xc, 1.18, z1 + 0.03);
    box(M(0xfbf6e6), WORLD, 1.8, 1.0, 0.05, xc, 1.1, z0 - 0.02);
    box(glass, WORLD, 1.65, 0.85, 0.07, xc, 1.18, z0 - 0.03);
    sign(T.signTexture('PHÒNG BẢO VỆ', { w: 512, h: 110, bg: '#1f4fa0', fg: '#ffffff', border: '#ffffff' }), 1.5, 0.32, x1 + 0.04, 2.55, zc + 0.2, Math.PI / 2);
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'building' });
  }

  // Tiểu cảnh non bộ bên phải lối vào.
  {
    const x = 13, z = 29;
    const soil = M(0x66573f, { roughness: 0.96 });
    const stone = M(0x77776f, { flatShading: true, roughness: 0.94 });
    const stoneLight = M(0x98958a, { flatShading: true, roughness: 0.9 });
    const water = M(0x4c9eac, { transparent: true, opacity: 0.82, roughness: 0.22, metalness: 0.12, side: THREE.DoubleSide });
    water.userData.noShadow = true;
    const transform = (px, py, pz, sx, sy, sz) => xform(px, py, pz).multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
    batch.add(soil, new THREE.SphereGeometry(1, 24, 12), transform(x, 0.18, z, 4.4, 0.16, 3.2));
    batch.add(mats.fenceStone, new THREE.TorusGeometry(1, 0.1, 8, 40).rotateX(Math.PI / 2), transform(x, 0.22, z, 4.35, 1, 3.15));
    batch.add(water, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), transform(x + 0.8, 0.36, z + 0.45, 2.05, 1, 1.3));
    batch.add(stoneLight, new THREE.TorusGeometry(1, 0.08, 8, 36).rotateX(Math.PI / 2), transform(x + 0.8, 0.38, z + 0.45, 2.05, 1, 1.3));

    blob(stone, WORLD, x - 1.65, 0.68, z - 1.4, 1.0, 0.9, 0.85);
    blob(stoneLight, WORLD, x - 0.55, 1.0, z - 1.65, 0.95, 1.4, 0.9);
    blob(stone, WORLD, x + 0.55, 0.78, z - 1.55, 1.05, 1.0, 0.9);
    blob(stoneLight, WORLD, x + 1.55, 0.56, z - 1.05, 0.82, 0.68, 0.75);
    const cascade = new THREE.PlaneGeometry(0.52, 1.3);
    batch.add(water, cascade, xform(x + 0.18, 0.92, z - 0.7));

    for (const [dx, dz, h] of [[-3.1, 0.8, 1.5], [2.8, 1.15, 1.2], [2.6, -1.7, 1.4]]) {
      cyl(mats.trunk, WORLD, 0.055, h, x + dx, 0.25, z + dz, 0.7);
      for (let level = 0; level < 3; level++) {
        blob(level % 2 ? mats.leaf : mats.bush, WORLD, x + dx + (level - 1) * 0.18, 0.7 + level * 0.35, z + dz, 0.48, 0.3, 0.42);
      }
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      blob(i % 2 ? mats.bush : mats.leafDark, WORLD, x + Math.cos(a) * 3.45, 0.48, z + Math.sin(a) * 2.4, 0.55, 0.4, 0.5);
    }
    W.colliders.push({ minX: x - 4.4, maxX: x + 4.4, minZ: z - 3.2, maxZ: z + 3.2, top: 2.2 });
    W.interact.push({
      x, z: z - 3.5, r: 3.5,
      label: 'Xem khuôn viên non bộ',
      title: 'Khuôn viên non bộ',
      text: 'Tiểu cảnh đá, hồ nước và cây xanh nằm ngay bên phải lối vào trường.',
    });
  }

  {
    const x = 13, z = 22.2;
    const F = new Frame(x, z, Math.PI);
    const plinth = M(0x77746b, { roughness: 0.82 });
    const bronze = M(0x76563a, { metalness: 0.62, roughness: 0.46 });
    const bronzeLight = M(0x92734e, { metalness: 0.58, roughness: 0.48 });
    const ellipsoid = (mat, px, py, pz, sx, sy, sz) => {
      batch.add(mat, new THREE.SphereGeometry(1, 16, 12), F.at(px, py, pz).multiply(new THREE.Matrix4().makeScale(sx, sy, sz)));
    };
    const cylinder = (mat, top, bottom, h, px, py, pz, ry = 0, rx = 0, rz = 0) => {
      batch.add(mat, new THREE.CylinderGeometry(top, bottom, h, 14), F.at(px, py, pz, ry, rx, rz));
    };

    box(plinth, F, 2.2, 0.25, 1.8, 0, 0, 0);
    box(plinth, F, 1.55, 0.95, 1.35, 0, 0.25, 0);
    box(plinth, F, 1.9, 0.18, 1.55, 0, 1.2, 0);
    box(bronzeLight, F, 1.1, 0.12, 0.92, 0, 1.38, -0.08);
    sign(T.signTexture('CHU VĂN AN', { w: 600, h: 150, bg: '#4d3b2a', fg: '#f1d59a', border: '#c4aa78', size: 78 }),
      1.1, 0.28, x, 0.74, z - 0.69, Math.PI);

    box(bronze, F, 1.05, 0.12, 0.9, 0, 1.48, -0.12);
    box(bronze, F, 1.0, 0.72, 0.16, 0, 1.78, -0.47);
    ellipsoid(bronze, -0.28, 1.72, 0.24, 0.43, 0.25, 0.36);
    ellipsoid(bronze, 0.28, 1.72, 0.24, 0.43, 0.25, 0.36);
    ellipsoid(bronzeLight, 0, 1.77, 0.52, 0.52, 0.2, 0.24);
    cylinder(bronze, 0.35, 0.48, 0.84, 0, 2.17, -0.08);
    ellipsoid(bronzeLight, 0, 2.78, -0.06, 0.25, 0.16, 0.22);
    ellipsoid(bronze, 0, 2.98, -0.06, 0.26, 0.34, 0.25);
    ellipsoid(bronzeLight, 0, 2.88, 0.18, 0.07, 0.09, 0.11);
    ellipsoid(bronze, -0.27, 2.98, -0.06, 0.07, 0.11, 0.08);
    ellipsoid(bronze, 0.27, 2.98, -0.06, 0.07, 0.11, 0.08);
    cylinder(bronze, 0.2, 0.18, 0.22, 0, 3.28, -0.06);
    cylinder(bronzeLight, 0.3, 0.3, 0.08, 0, 3.16, -0.06);
    batch.add(bronze, new THREE.ConeGeometry(0.17, 0.48, 10).rotateX(Math.PI), F.at(0, 2.55, 0.16));
    cylinder(bronze, 0.11, 0.14, 0.5, -0.43, 2.22, 0.02, 0, 0, -0.22);
    cylinder(bronze, 0.1, 0.12, 0.42, 0.43, 2.22, 0.02, 0, 0, 0.22);
    cylinder(bronzeLight, 0.1, 0.12, 0.42, -0.27, 1.95, 0.36, 0, 0.55, 0);
    cylinder(bronzeLight, 0.1, 0.12, 0.42, 0.27, 1.95, 0.36, 0, 0.55, 0);
    box(bronzeLight, F, 0.52, 0.1, 0.38, 0, 1.92, 0.48);
    W.colliders.push(
      { minX: x - 1.1, maxX: x + 1.1, minZ: z - 0.9, maxZ: z + 0.9, top: 1.38 },
      { minX: x - 0.72, maxX: x + 0.72, minZ: z - 0.55, maxZ: z + 0.55, bottom: 1.38, top: 3.45 },
    );
    W.interact.push({
      x, z: z - 1.6, r: 2.8,
      label: 'Xem tượng Chu Văn An',
      title: 'Tượng Chu Văn An',
      text: 'Nhà giáo Chu Văn An ngồi trên bệ, hướng về Nhà học chính.',
    });
  }

  // Đèn sân trường dọc lối đi và các cạnh sân.
  for (const [x, z] of [
    [-47, 28], [47, 28], [-47, 2], [47, 2],
    [-47, -24], [47, -24], [-24, 18], [24, 18],
  ]) campusLamp(x, z);

  // biển khẩu hiệu bên phải cổng
  for (const x of [11.2, 18.8]) box(mats.grey, WORLD, 0.14, 3.7, 0.14, x, 0, 35.6, { collide: true });
  sign(T.signTexture('KỶ CƯƠNG – TÌNH THƯƠNG – TRÁCH NHIỆM', { w: 1600, h: 220 }), 7.8, 1.05, 15, 3.15, 35.72, 0, true);
  W.interact.push({
    x: 0, z: 36.5, r: 4.5, label: 'Xem cổng trường',
    title: 'Cổng trường THPT Ninh Giang',
    text: '193 Nguyễn Lương Bằng, thị trấn Ninh Giang, Hải Dương.\n\nCổng trường mái ngói đỏ, trụ và viền màu kem, hai mảng tường gạch có ô cửa tròn, bảng tuyển sinh ở giữa và cánh cổng sắt đen mở vào sân.',
  });
  W.interact.push({
    x: 15, z: 37.6, r: 3, label: 'Đọc khẩu hiệu',
    title: 'Kỷ cương – Tình thương – Trách nhiệm',
    text: 'Khẩu hiệu quen thuộc treo trên tường rào trước cổng trường.\n\n“Nhà trường luôn xây dựng một môi trường sư phạm trong lành, có kỷ cương nghiêm, nền nếp tốt; có đội ngũ giáo viên tâm huyết, hết lòng thương yêu, chăm sóc học sinh.” — trích trang giới thiệu của trường.',
  });

  // Quầy ăn vặt trên vỉa hè gạch (z ≈ 38.15) — người bán đứng phía cổng, xe quay ra đường
  {
    const cartZ = 38.72;
    const stripe = texMat(T.tileTexture('#ff7043', '#ffffff', 6, 11), { roughness: 0.85 });
    function snackCart(x, signText, bg) {
      const metal = M(0x757575, { metalness: 0.45, roughness: 0.55 });
      const wood = M(0x8d6e3a);
      box(metal, WORLD, 0.08, 0.62, 1.35, x - 0.55, 0.31, cartZ);
      box(metal, WORLD, 0.08, 0.62, 1.35, x + 0.55, 0.31, cartZ);
      for (const s of [-1, 1]) {
        batch.add(metal, new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12).rotateX(Math.PI / 2), xform(x + s * 0.62, 0.18, cartZ + 0.42));
        batch.add(metal, new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12).rotateX(Math.PI / 2), xform(x + s * 0.62, 0.18, cartZ - 0.42));
      }
      box(wood, WORLD, 1.65, 0.06, 1.25, x, 0.62, cartZ);
      box(M(0xf5f5f5), WORLD, 1.62, 0.42, 0.55, x, 0.98, cartZ - 0.32);
      box(M(0xffcc80), WORLD, 1.5, 0.08, 0.45, x, 1.22, cartZ - 0.05);
      sign(T.signTexture(signText, { w: 720, h: 160, bg: bg, fg: '#ffffff', border: '#ffeb3b', size: 72 }), 1.38, 0.42, x, 1.52, cartZ - 0.78);
      cyl(M(0xb0bec5), WORLD, 0.045, 2.35, x - 0.55, 0, cartZ);
      cyl(M(0xb0bec5), WORLD, 0.045, 2.35, x + 0.55, 0, cartZ);
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.05), stripe);
      awning.position.set(x, 2.45, cartZ - 0.2);
      awning.rotation.set(0.12, 0, 0);
      awning.receiveShadow = true;
      root.add(awning);
      blob(M(0xff5722), WORLD, x, 1.08, cartZ - 0.18, 0.35, 0.28, 0.22);
      W.colliders.push({ minX: x - 1.05, maxX: x + 1.05, minZ: cartZ - 0.75, maxZ: cartZ + 0.55, top: 2.5 });
    }
    snackCart(-15, 'BÁNH RÁN · TRÀ TẮC', '#c62828');
    // snackCart(-8.5, 'TRÀ SỮA VỈA HÈ', '#ad1457');
    snackCart(11, 'ĂN VẶT BÀ NĂM', '#ef6c00');
    box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, -15, 0.04, 38.15);
    // box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, -8.5, 0.04, 38.15);
    box(mats.sidewalk, WORLD, 5.5, 0.04, 2.2, 11, 0.04, 38.15);
  }

  // ---------- sân khấu trước nhà học chính (ảnh lễ khai giảng ~2022) ----------
  {
    const z0 = -25.9, z1 = -19.4, top = 1.1, sw = 18;
    box(M(0xb3261e), WORLD, sw, top - 0.06, z1 - z0, 0, 0, (z0 + z1) / 2, { collide: true });
    box(mats.floorTile, WORLD, sw + 0.1, 0.06, z1 - z0 + 0.1, 0, top - 0.06, (z0 + z1) / 2, { collide: true });
    for (const s of [-1, 1]) {
      box(mats.floorTile, WORLD, 3, 0.74, 0.6, s * 6.5, 0, z1 + 0.3, { collide: true });
      box(mats.floorTile, WORLD, 3, 0.37, 0.6, s * 6.5, 0, z1 + 0.9, { collide: true });
    }
    box(mats.gateYellow, WORLD, 15.6, 4.9, 0.4, 0, top, z0 + 0.2, { collide: true });
    for (const s of [-1, 1]) box(mats.gateYellow, WORLD, 0.6, 4.9, 0.7, s * 7.9, top, z0 + 0.35, { collide: true });
    sign(T.ceremonyBackdropTexture(), 15.0, 4.4, 0, top + 2.35, z0 + 0.41);
    box(mats.trim, WORLD, 16.8, 0.2, 2.2, 0, top + 4.9, z0 + 0.6);
    batch.add(mats.tileRoof, GEO.pyramid, xform(0, top + 5.1, z0 + 0.6).multiply(new THREE.Matrix4().makeScale(12.2, 1.1, 1.6)));
    for (let i = 0; i < 28; i++) blob(i % 2 ? mats.flower : M(0xffffff), WORLD, -8.1 + i * 0.6, top + 4.82, z0 + 1.68, 0.3, 0.18, 0.05);
    // tượng Bác trên bệ, bên trái phông
    box(mats.white, WORLD, 0.7, 1.2, 0.7, -5.6, top, z0 + 1.1, { collide: true });
    const bronze = M(0x9b7a45, { metalness: 0.55, roughness: 0.45 });
    box(bronze, WORLD, 0.7, 0.42, 0.36, -5.6, top + 1.2, z0 + 1.1);
    blob(bronze, WORLD, -5.6, top + 1.86, z0 + 1.1, 0.19, 0.24, 0.2);
    blob(bronze, WORLD, -5.6, top + 1.66, z0 + 1.2, 0.1, 0.14, 0.08);
    // lẵng hoa chân phông
    for (let x = -7; x <= 7; x += 0.7) {
      if (Math.abs(x + 5.6) < 0.6) continue;
      box(mats.wood, WORLD, 0.35, 0.5, 0.35, x, top, z0 + 0.75);
      blob([mats.flower, mats.flower2, M(0xf6d34a), M(0xf48fb1)][Math.round(x * 10) % 4 & 3], WORLD, x, top + 0.75, z0 + 0.75, 0.38, 0.3, 0.3);
    }
    // bục phát biểu
    box(mats.wood, WORLD, 0.9, 1.15, 0.7, 4.2, top, -22.6, { collide: true });
    box(M(0x6a3b1f), WORLD, 1.0, 0.08, 0.8, 4.2, top + 1.15, -22.6);
    blob(mats.flower, WORLD, 4.2, top + 0.65, -22.22, 0.3, 0.25, 0.08);
    // trống trường trên sân khấu
    const drumF = new Frame(-6.8, -21.6, 0);
    for (const s of [-1, 1]) box(mats.wood, drumF, 0.12, 1.1, 0.12, s * 0.62, top, 0);
    box(mats.wood, drumF, 1.4, 0.1, 0.5, 0, top + 0.45, 0);
    batch.add(M(0xb3261e), new THREE.CylinderGeometry(0.55, 0.55, 0.85, 22).rotateX(Math.PI / 2), drumF.at(0, top + 1.1, 0));
    for (const s of [-1, 1]) batch.add(M(0xe8d6b0), new THREE.CylinderGeometry(0.52, 0.52, 0.02, 22).rotateX(Math.PI / 2), drumF.at(0, top + 1.1, s * 0.43));
    addCollider(drumF, -0.7, 0.7, -0.5, 0.5, top + 1.7);
    W.interact.push({ x: -6.8, z: -20.3, r: 2.4, label: 'Đánh trống vào lớp', action: 'drum' });
    // cây cảnh tròn hai bên sân khấu
    for (const s of [-1, 1]) {
      const x = s * 10.6, z = -23.5;
      box(mats.white, WORLD, 1.6, 0.4, 1.6, x, 0, z);
      cyl(mats.trunk, WORLD, 0.14, 1.2, x, 0.4, z, 0.8);
      blob(mats.leafDark, WORLD, x, 1.9, z, 1.25, 0.95, 1.25);
      blob(mats.leaf, WORLD, x, 2.9, z, 0.85, 0.7, 0.85);
      blob(mats.leafDark, WORLD, x, 3.55, z, 0.45, 0.4, 0.45);
      W.colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.8, maxZ: z + 0.8, top: 3 });
    }
    const floodMetal = M(0x454a4d, { metalness: 0.6, roughness: 0.4 });
    const floodHousing = M(0x33393c, { metalness: 0.45, roughness: 0.42 });
    const floodBulb = M(0xffe5ad, { emissive: 0xffc66b, emissiveIntensity: 0.02, roughness: 0.28 });
    for (const s of [-1, 1]) {
      const x = s * 12.6, z = -18.8, headX = x - s * 0.35;
      cyl(floodMetal, WORLD, 0.11, 10.5, x, 0, z, 0.55);
      cyl(floodMetal, WORLD, 0.22, 0.28, x, 0, z, 0.72);
      box(floodMetal, WORLD, 1.1, 0.08, 0.08, headX, 10.25, z);
      box(floodHousing, WORLD, 0.78, 0.34, 0.5, headX, 9.91, z);
      box(floodBulb, WORLD, 0.65, 0.025, 0.38, headX, 9.885, z);
      const light = new THREE.SpotLight(0xffe6bc, 0, 42, Math.PI / 2, 0.45, 2);
      light.position.set(headX, 9.86, z);
      light.target.position.set(s * 4.5, 1.2, -22.2);
      scene.add(light, light.target);
      W.lamps.push({ light, bulb: floodBulb, maxIntensity: 130 });

      const yardY = 9.25;
      box(floodMetal, WORLD, 1.1, 0.08, 0.08, headX, yardY + 0.34, z);
      box(floodHousing, WORLD, 0.78, 0.34, 0.5, headX, yardY, z);
      box(floodBulb, WORLD, 0.65, 0.025, 0.38, headX, yardY - 0.025, z);
      const yardLight = new THREE.SpotLight(0xfff0d8, 0, 58, Math.PI / 2, 0.5, 2);
      yardLight.position.set(headX, yardY - 0.05, z);
      yardLight.target.position.set(s * 3, 0.1, -8);
      scene.add(yardLight, yardLight.target);
      W.lamps.push({ light: yardLight, bulb: floodBulb, maxIntensity: 230 });
      W.colliders.push({ minX: x - 0.24, maxX: x + 0.24, minZ: z - 0.24, maxZ: z + 0.24, top: 10.5 });
    }
    const chairRed = M(0xc62828, { roughness: 0.72 });
    const chairLeg = M(0x42484a, { metalness: 0.48, roughness: 0.55 });
    for (let row = 0; row < 10; row++) {
      const z = -17.15 + row * 0.95;
      for (let column = 0; column < 10; column++) {
        const x = (column - 4.5) * 0.9;
        box(chairRed, WORLD, 0.56, 0.08, 0.46, x, 0.42, z);
        box(chairRed, WORLD, 0.56, 0.52, 0.07, x, 0.48, z + 0.195);
        for (const dx of [-0.22, 0.22]) {
          for (const dz of [-0.17, 0.17]) box(chairLeg, WORLD, 0.05, 0.42, 0.05, x + dx, 0, z + dz);
        }
        W.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.27, maxZ: z + 0.27, top: 1.0 });
      }
    }
    const fireX = 9.2, fireZ = -12;
    const firePit = M(0x302a25, { roughness: 0.98 });
    const fireStone = M(0x625e55, { roughness: 0.94, flatShading: true });
    const firewood = M(0x38271e, { roughness: 0.96 });
    cyl(firePit, WORLD, 2.04, 0.24, fireX, 0, fireZ, 0.9);
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      blob(fireStone, WORLD, fireX + Math.cos(angle) * 2.26, 0.34, fireZ + Math.sin(angle) * 2.26, 0.62, 0.4, 0.54);
    }
    box(firewood, WORLD, 3.5, 0.4, 0.44, fireX, 0.24, fireZ, { ry: Math.PI / 4 });
    box(firewood, WORLD, 3.5, 0.4, 0.44, fireX, 0.24, fireZ, { ry: -Math.PI / 4 });
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      box(firewood, WORLD, 2.8, 0.36, 0.4,
        fireX + Math.cos(angle) * 2.24, 0.24, fireZ + Math.sin(angle) * 2.24,
        { ry: -angle });
    }
    W.colliders.push({ minX: fireX - 3.7, maxX: fireX + 3.7, minZ: fireZ - 3.7, maxZ: fireZ + 3.7, top: 1.0 });

    const campfire = new THREE.Group();
    campfire.position.set(fireX, 0, fireZ);
    campfire.scale.setScalar(2);
    campfire.visible = false;
    const flameOuter = new THREE.MeshBasicMaterial({
      color: 0xff5a12, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false,
    });
    const flameInner = new THREE.MeshBasicMaterial({
      color: 0xffd34d, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false,
    });
    const flameShapes = [];
    for (const [radius, height, x, z, phase, inner] of [
      [0.48, 1.9, -0.28, 0, 0.2, false],
      [0.45, 2.1, 0.28, -0.17, 1.4, false],
      [0.42, 1.8, 0.08, 0.28, 2.8, false],
      [0.38, 1.65, -0.4, 0.22, 4.1, false],
      [0.37, 1.72, 0.38, 0.28, 5.2, false],
      [0.3, 1.25, -0.1, -0.08, 0.9, true],
      [0.28, 1.1, 0.22, 0.14, 3.3, true],
    ]) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 8),
        inner ? flameInner : flameOuter,
      );
      mesh.position.set(x, height / 2 + 0.22, z);
      campfire.add(mesh);
      flameShapes.push({ mesh, phase });
    }

    const emberCount = 28;
    const emberPositions = new Float32Array(emberCount * 3);
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({
      color: 0xffa32b, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    campfire.add(embers);
    const fireLight = new THREE.PointLight(0xff7626, 0, 28, 2);
    fireLight.position.y = 1.2;
    campfire.add(fireLight);
    root.add(campfire);

    W.updaters.push((elapsed, localHour) => {
      const burning = localHour >= 19 || localHour < 6;
      campfire.visible = burning;
      if (!burning) return;

      for (const { mesh, phase } of flameShapes) {
        const flicker = 0.84 + Math.sin(elapsed * 9 + phase) * 0.12 + Math.sin(elapsed * 17 + phase * 1.7) * 0.06;
        mesh.scale.set(0.88 + Math.sin(elapsed * 7 + phase) * 0.12, flicker, 0.88 + Math.cos(elapsed * 8 + phase) * 0.12);
        mesh.rotation.z = Math.sin(elapsed * 4 + phase) * 0.12;
      }
      for (let i = 0; i < emberCount; i++) {
        const progress = (elapsed * 0.42 + i / emberCount) % 1;
        const angle = i * 2.399 + elapsed * 0.3;
        const radius = 0.12 + progress * 0.42;
        const p = i * 3;
        emberPositions[p] = Math.cos(angle) * radius;
        emberPositions[p + 1] = 0.45 + progress * 2.6;
        emberPositions[p + 2] = Math.sin(angle) * radius;
      }
      emberGeometry.attributes.position.needsUpdate = true;
      fireLight.intensity = 84 * (0.82 + Math.sin(elapsed * 11) * 0.1 + Math.sin(elapsed * 17) * 0.08);
    });
    W.interact.push({
      x: fireX, z: fireZ + 1.6, r: 2.5,
      label: 'Ngồi bên lửa trại',
      action: 'campfire-sit',
    });

    // Khu thả đèn trời đối diện lửa trại, nằm bên trái cụm ghế.
    const lanternX = fireX - 20;
    const lanternZ = fireZ - 0.8;
    box(M(0x6f4931), WORLD, 3.2, 0.18, 1.7, lanternX, 0.18, lanternZ, { ry: 0.08 });
    box(M(0x9e6a3c), WORLD, 3.0, 0.12, 1.5, lanternX, 0.36, lanternZ, { ry: 0.08 });
    for (const s of [-1, 1]) {
      cyl(M(0x34403e), WORLD, 0.11, 3.1, lanternX + s * 4.7, 0, lanternZ - 2.2);
      box(M(0x34403e), WORLD, 9.5, 0.12, 0.12, lanternX, 3.05, lanternZ - 2.2);
    }
    for (let i = 0; i < 6; i++) {
      const lx = lanternX - 4.1 + i * 1.64;
      const lz = lanternZ - 2.2;
      box(M(0x3b3a32), WORLD, 0.025, 1.05, 0.025, lx, 2.5, lz);
      const lantern = new THREE.Group();
      lantern.position.set(lx, 1.95 + (i % 2) * 0.12, lz);
      const lanternBody = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshStandardMaterial({
          color: i % 3 === 0 ? 0xffb52b : 0xf04a32,
          emissive: i % 3 === 0 ? 0xff8a18 : 0xb82b18,
          emissiveIntensity: 0.72,
          roughness: 0.45,
          side: THREE.FrontSide,
        }),
      );
      lanternBody.scale.set(0.72, 1.12, 0.72);
      lantern.add(lanternBody);
      for (const y of [0.42, 0.12, -0.18, -0.42]) lantern.add(new THREE.Mesh(
        new THREE.TorusGeometry(y === 0.42 || y === -0.42 ? 0.28 : 0.36, 0.025, 5, 12),
        new THREE.MeshStandardMaterial({ color: 0x5a3424, roughness: 0.7 }),
      ).translateY(y));
      lantern.add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10),
        M(0x6a4028),
      ).translateY(0.58));
      lantern.add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.12, 10),
        M(0x6a4028),
      ).translateY(-0.58));
      const glow = new THREE.PointLight(0xffa13a, 12, 5.5, 2);
      glow.position.y = 0.05;
      lantern.add(glow);
      root.add(lantern);
    }

    const releasedLanterns = [];
    W.launchLantern = (wish) => {
      const lantern = new THREE.Group();
      lantern.position.set(lanternX + (releasedLanterns.length % 3 - 1) * 0.55, 1.15, lanternZ);
      lantern.userData.wish = String(wish).slice(0, 120);
      lantern.userData.age = 0;
      lantern.userData.drift = releasedLanterns.length * 0.73;
      lantern.userData.vy = 0.28;
      const paper = new THREE.Mesh(
        new THREE.SphereGeometry(0.66, 12, 10),
        new THREE.MeshStandardMaterial({
          color: 0xff4b32,
          emissive: 0xff8a18,
          emissiveIntensity: 1.35,
          roughness: 0.45,
          side: THREE.FrontSide,
        }),
      );
      paper.scale.set(0.78, 1.18, 0.78);
      lantern.add(paper);
      for (const y of [0.52, 0.18, -0.18, -0.52]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(y === 0.52 || y === -0.52 ? 0.38 : 0.51, 0.032, 5, 12),
          M(0x65402d),
        );
        ring.position.y = y;
        lantern.add(ring);
      }
      for (const y of [0.72, -0.72]) lantern.add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.29, 0.29, 0.12, 10),
        M(0x6a4028),
      ).translateY(y));
      const candle = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.18, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
      );
      candle.position.y = -0.18;
      lantern.add(candle);
      lantern.add(new THREE.PointLight(0xff7b24, 16, 8, 2));
      root.add(lantern);
      releasedLanterns.push(lantern);
    };
    W.updaters.push((elapsed) => {
      for (let i = releasedLanterns.length - 1; i >= 0; i--) {
        const lantern = releasedLanterns[i];
        lantern.userData.age += 1 / 60;
        lantern.userData.vy += 0.0028;
        lantern.position.y += lantern.userData.vy * 0.055;
        lantern.position.x += Math.sin(elapsed * 0.7 + lantern.userData.drift) * 0.006;
        lantern.position.z += Math.cos(elapsed * 0.48 + lantern.userData.drift) * 0.004;
        lantern.rotation.z = Math.sin(elapsed * 0.9 + lantern.userData.drift) * 0.08;
        if (lantern.position.y > 62 || lantern.userData.age > 55) {
          root.remove(lantern);
          lantern.traverse(child => {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material?.dispose();
          });
          releasedLanterns.splice(i, 1);
        }
      }
    });
    W.interact.push({
      x: lanternX, z: lanternZ + 2.2, r: 3.2,
      label: 'Nhận & thả đèn trời',
      action: 'lantern-wish',
    });
    W.rects.push({ minX: -9, maxX: 9, minZ: z0, maxZ: z1 + 1.2, kind: 'stage' });
    W.interact.push({
      x: 0, z: -17.6, r: 4.5, label: 'Xem sân khấu',
      title: 'Sân khấu trường',
      text: 'Sân khấu xây ngay trước nhà học chính, phông nền màu vàng đỏ như lễ khai giảng, bên trái là tượng Bác Hồ, trống trường ở góc sân khấu. Sân trường rộng phía trước — không có cột cờ giữa sân.',
    });
  }
  // băng rôn trên dãy nhà bên phải (theo ảnh buổi ngoại khoá)
  sign(T.signTexture('HIỀN TÀI LÀ NGUYÊN KHÍ QUỐC GIA', { w: 2000, h: 150, bg: '#c62828', fg: '#ffffff', border: '#ffd54a' }), 16, 1.2, 50.25, 4.35, -8, -Math.PI / 2);
  // ---------- bảng Qizz Game ----------
  for (const x of [-21.4, -18.6]) box(mats.grey, WORLD, 0.15, 3.8, 0.15, x, 0, -28.6, { collide: true });
  box(mats.trim, WORLD, 2.6, 3.2, 0.15, -20, 0.5, -28.5, { collide: true });
  sign(T.honorBoardTexture('QIZZ GAME', [
    'Math · History · English',
    'Chọn một game để chơi',
  ]), 2.3, 2.85, -20, 2.1, -28.4);
  W.interact.push({
    x: -20, z: -27, r: 2.8, label: 'Chơi Qizz Game',
    action: 'qizz-game',
  });

  W.interact.push({
    x: 18, z: AZ + 7.8, r: 3, label: 'Xem nhà học chính',
    title: 'Nhà học chính',
    text: 'Dãy nhà 3 tầng sơn vàng kem, viền đỏ nâu, hành lang lan can con tiện, tầng trên cùng có các ô vòm. Biển tên “Trường Trung học phổ thông Ninh Giang” đặt trên nóc sảnh giữa — cờ treo ở đây, không dựng cột cờ giữa sân.\n\nSân khấu lễ nằm sâu hơn trong sân; lan can tầng 3 treo băng rôn xanh lời Bác.',
  });

  // ---------- nhà xe ----------
  {
    const x0 = 30, x1 = 52, z0 = 24, z1 = 33;
    for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [z0, z1]) {
      box(mats.grey, WORLD, 0.14, 2.8, 0.14, x, 0, z, { collide: true });
    }
    batch.add(mats.shedRoof, new THREE.PlaneGeometry(x1 - x0 + 1, z1 - z0 + 1.2), xform((x0 + x1) / 2, 2.95, (z0 + z1) / 2, 0, -Math.PI / 2 + 0.08));
    box(mats.floorTile, WORLD, x1 - x0, 0.06, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2);
    const colors = [0x2d6cb5, 0xc23b3b, 0x2f8f5b, 0x333333, 0xe0a030, 0x8a4fb0, 0xd0d0d0];
    let k = 0;
    for (const zr of [25.9, 31.1]) {
      for (let x = x0 + 1.2; x < x1 - 0.6; x += 0.85) {
        const F = new Frame(x, zr, (k % 3) * 0.04);
        const col = M(colors[k++ % colors.length]);
        for (const s of [-1, 1]) batch.add(mats.dark, GEO.wheel, F.at(0, 0.35, s * 0.52, Math.PI / 2));
        box(col, F, 0.05, 0.05, 0.85, 0, 0.72, 0);
        batch.add(col, new THREE.BoxGeometry(0.05, 0.05, 0.75), F.at(0, 0.52, 0.12, 0, 0.55));
        box(col, F, 0.05, 0.55, 0.05, 0, 0.35, -0.3);
        box(col, F, 0.05, 0.6, 0.05, 0, 0.4, 0.45);
        box(mats.dark, F, 0.14, 0.05, 0.26, 0, 0.92, -0.3);
        box(mats.dark, F, 0.5, 0.04, 0.04, 0, 1.0, 0.45);
        if (k % 2) box(M(0xe8e8e8), F, 0.32, 0.22, 0.26, 0, 0.82, 0.65);
      }
      W.colliders.push({ minX: x0 + 0.6, maxX: x1 - 0.6, minZ: zr - 0.95, maxZ: zr + 0.95, top: 1.0 });
    }
    W.rects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, kind: 'shed' });
    W.interact.push({
      x: 34, z: 28.5, r: 3, label: 'Xem nhà xe',
      title: 'Nhà xe',
      text: 'Những hàng xe đạp, xe đạp điện xếp kín mỗi sáng. Học sinh Ninh Giang đạp xe từ khắp các xã trong huyện tới trường, dọc theo đường 10 và những con đường làng.',
    });
    W.interact.push({
      x: 41, z: 28.5, r: 5.5, label: 'Lấy xe đạp',
      action: 'bikeToggle',
      title: 'Lấy xe đạp',
      text: 'Chọn một chiếc trong dãy xe, bấm E để lấy. Đạp bằng WASD — nhanh hơn đi bộ. Bấm B hoặc quay lại nhà xe + E để trả xe. Nhớ: trong sân trường nên xuống xe dắt bộ qua cổng!',
    });
  }

  // ---------- cây xanh ----------
  const mainSchoolBounds = { minX: -44, maxX: 44, minZ: AZ - 5, maxZ: AZ + 9 };
  function treeOverlapsMainSchool(x, z, canopyRadius = 4.5) {
    return x + canopyRadius > mainSchoolBounds.minX && x - canopyRadius < mainSchoolBounds.maxX &&
      z + canopyRadius > mainSchoolBounds.minZ && z - canopyRadius < mainSchoolBounds.maxZ;
  }
  function palm(x, z, h = 9) {
    if (treeOverlapsMainSchool(x, z)) return;
    cyl(mats.palmTrunk, WORLD, 0.3, h, x, 0, z, 0.7);
    cyl(M(0x6f9a3a), WORLD, 0.24, 1.3, x, h, z, 0.8);
    const top = new THREE.Vector3(x, h + 1.25, z);
    for (let k = 0; k < 11; k++) {
      const yaw = (k / 11) * Math.PI * 2 + (k % 3) * 0.15;
      const p = top.clone();
      [[0.15, 1.5, 0.75], [0.6, 1.4, 0.6], [1.05, 1.2, 0.4]].forEach(([pitch, len, wd]) => {
        const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        const c = p.clone().addScaledVector(dir, len / 2);
        batch.add(mats.palmLeaf, GEO.cbox, xform(c.x, c.y, c.z, yaw, pitch).multiply(new THREE.Matrix4().makeScale(wd, 0.03, len)));
        p.addScaledVector(dir, len);
      });
    }
    W.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: h });
  }
  function flameTree(x, z, s = 1) {
    if (treeOverlapsMainSchool(x, z)) return;
    cyl(mats.trunk, WORLD, 0.32 * s, 3.0 * s, x, 0, z, 0.75);
    // tán phượng xoè rộng, lá xanh lẫn chùm hoa đỏ cam
    for (let k = 0; k < 16; k++) {
      const a = k * 2.399 + x, r = (0.6 + ((k * 7) % 5) * 0.55) * s;
      const m = k % 4 === 0 ? mats.leafDark : k % 4 === 1 ? mats.leaf : k % 4 === 2 ? mats.flower : mats.flower2;
      const sz = (1.0 + (k % 3) * 0.25) * s;
      blob(m, WORLD, x + Math.cos(a) * r, (3.5 + ((k * 5) % 4) * 0.25 - r * 0.12) * s, z + Math.sin(a) * r, sz * 1.15, sz * 0.55, sz * 1.15);
    }
    blob(mats.flower, WORLD, x, 4.25 * s, z, 1.6 * s, 0.7 * s, 1.6 * s);
    W.colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4, top: 4 });
  }
  function roundTree(x, z, s = 1) {
    if (treeOverlapsMainSchool(x, z)) return;
    cyl(mats.trunk, WORLD, 0.25 * s, 2.6 * s, x, 0, z, 0.7);
    blob(mats.leafDark, WORLD, x, 3.6 * s, z, 1.9 * s, 1.6 * s, 1.9 * s);
    blob(mats.leaf, WORLD, x + 0.8 * s, 4.3 * s, z + 0.3 * s, 1.3 * s, 1.1 * s, 1.3 * s);
    blob(mats.leaf, WORLD, x - 0.7 * s, 4.1 * s, z - 0.5 * s, 1.2 * s, 1.0 * s, 1.2 * s);
    W.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: 4 });
  }
  function treeBed(x, z, r = 1.3) {
    box(mats.white, WORLD, r * 2, 0.3, r * 2, x, 0, z);
    box(mats.soil, WORLD, r * 2 - 0.2, 0.31, r * 2 - 0.2, x, 0, z);
  }
  function placeYardTree(x, z, type = 'flame', s = 1) {
    if (treeOverlapsMainSchool(x, z)) return;
    const bed = type === 'palm' ? 0.85 : 1.0 + (s - 1) * 0.3;
    treeBed(x, z, bed);
    if (type === 'palm') palm(x, z, 7.2 + (Math.abs(x * 3 + z) % 4) * 0.6);
    else if (type === 'round') roundTree(x, z, s);
    else flameTree(x, z, s);
  }

  for (const x of [-34, -26, -18, -11]) palm(x, 38.2, 9 + (x % 2));
  for (const x of [10.5, 22, 30]) flameTree(x, 38.4, 1.0);
  for (const z of [30, 23]) for (const x of [-6, 6]) { treeBed(x, z, 0.8); palm(x, z, 8.5 + (z % 3)); }
  for (const [x, z, s] of [[-30, 28, 1.1], [-20, 20, 0.95], [20, 20, 1.0], [-22, -12, 1.0], [24, -12, 1.0], [34, 6, 0.95], [-14, 6, 0.9]]) {
    if (treeOverlapsMainSchool(x, z)) continue;
    treeBed(x, z);
    flameTree(x, z, s);
  }
  // Vài cây bồn giữa sân (ảnh lễ 2026 — rải thưa, sân vẫn rộng trống)
  // Bỏ các cây chồng lên khối nhà học chính; giữ không gian trước sảnh và hành lang rộng hơn.
  for (const [x, z] of [[-68, -10], [-68, 10], [-68, 26], [68, -12], [68, 8], [68, 24], [-30, -50], [-10, -51], [12, -50], [32, -51]]) roundTree(x, z, 1.1);
  // Vườn cây bên trái sân trong: cây cổ thụ (dưới gốc treo kẻng), bồn cây viền gạch, ghế đá, cau (theo ảnh 2022).
  {
    const x = -52, z = 4;
    treeBed(x, z, 1.8);
    cyl(mats.trunk, WORLD, 0.75, 3.2, x, 0, z, 0.75);
    // ba cành lớn vươn chếch lên
    [[0.6, 0.0], [0.55, 2.2], [0.5, 4.2]].forEach(([tilt, yaw]) => {
      batch.add(mats.trunk, new THREE.CylinderGeometry(0.28, 0.45, 4.2, 8).translate(0, 2.1, 0), xform(x, 2.8, z, yaw, tilt));
    });
    // tán rộng, không đều
    for (let k = 0; k < 14; k++) {
      const a = k * 2.399, r = 1.5 + (k % 4) * 1.1;
      blob(k % 3 ? mats.leaf : mats.leafDark, WORLD, x + Math.cos(a) * r, 6.2 + (k % 3) * 0.6 - r * 0.15, z + Math.sin(a) * r, 2.0, 1.1, 2.0);
    }
    // cành ngang thấp treo kẻng
    batch.add(mats.trunk, new THREE.CylinderGeometry(0.12, 0.2, 2.8, 8).rotateZ(Math.PI / 2 - 0.12), xform(x + 1.6, 2.9, z));
    const kx = x + 2.5;
    cyl(M(0x333333), WORLD, 0.012, 0.85, kx, 2.15, z);
    const iron = M(0x4a3f37, { metalness: 0.6, roughness: 0.55 });
    box(iron, WORLD, 0.16, 0.8, 0.05, kx, 1.35, z);
    box(iron, WORLD, 0.05, 0.8, 0.14, kx, 1.35, z);
    box(iron, WORLD, 0.1, 0.8, 0.1, kx, 1.35, z + 0.06);
    batch.add(iron, new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6).rotateZ(0.3), xform(x + 0.9, 0.75, z + 0.5));
    W.colliders.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.8, maxZ: z + 0.8, top: 4 });
    W.colliders.push({ minX: kx - 0.12, maxX: kx + 0.12, minZ: z - 0.12, maxZ: z + 0.12, top: 2.9 });
    W.interact.push({ x: kx + 0.5, z, r: 2.2, label: 'Đánh kẻng ra chơi', action: 'keng' });
    // bồn cây viền gạch đỏ + cau (ảnh 2022 — vườn bên trái)
    const brick = M(0xa8452f);
    for (const [bx, bz] of [[-50, -5], [-50, 13]]) {
      box(brick, WORLD, 4, 0.45, 3, bx, 0, bz, { collide: true });
      box(mats.soil, WORLD, 3.7, 0.46, 2.7, bx, 0, bz);
      for (let i = -1; i <= 1; i++) blob(mats.bush, WORLD, bx + i * 1.1, 0.75, bz + 0.8, 0.6, 0.4, 0.5);
      palm(bx, bz - 0.4, 6.5);
    }
    // ghế đá
    for (const bz of [-2, 10]) {
      box(mats.grey, WORLD, 0.5, 0.42, 1.8, -29.6, 0, bz);
      box(M(0xb7b4ad), WORLD, 0.6, 0.08, 2.0, -29.6, 0.42, bz, { collide: true });
    }
  }

  // bồn hoa trước nhà học chính
  for (const x of [-32, -26, 26, 32]) {
    box(mats.white, WORLD, 5, 0.35, 1.2, x, 0, -29.6);
    for (let i = -2; i <= 2; i++) blob(i % 2 ? mats.bush : mats.flower2, WORLD, x + i * 0.95, 0.5, -29.6, 0.5, 0.35, 0.5);
    W.colliders.push({ minX: x - 2.5, maxX: x + 2.5, minZ: -30.2, maxZ: -29.0, top: 0.6 });
  }
  // Phượng góc sân phải (ảnh — một vài cây phượng rìa sân, không dày đặc)
  placeYardTree(28, 12, 'flame', 1.0);
  placeYardTree(32, -18, 'flame', 0.95);

  // ---------- đường Nguyễn Bỉnh Khiêm & sân bóng cỏ nhân tạo sau dãy nhà bên trái ----------
  // Bên trường: vỉa hè gạch đỏ, cau vua gần cổng, cây bồn tròn viền đỏ, cột điện.
  // Đường nhựa 2 làn, vạch giữa vàng đứt, vạch sơn vàng trước cổng.
  // Bên kia: vỉa hè đá xám, cây non chống cọc, đèn cột đôi cầu tròn và hàng rào sắt xanh hoa văn.
  // Sân bóng, khán đài, cột đèn cao áp và lưới chắn nằm phía sau dãy nhà bên trái.
  {
    const yellowPaint = M(0xe0b23a);
    for (let x = -150; x <= 150; x += 6) box(yellowPaint, WORLD, 3, 0.012, 0.15, x, 0.022, 44);
    for (const [x0, lane] of [[-15, 42], [10, 46]]) for (let i = 0; i < 6; i++) box(yellowPaint, WORLD, 0.45, 0.012, 3.2, x0 + i * 0.9, 0.022, lane);
    for (const z of [40, 48]) box(M(0xb9b6ae), WORLD, 300, 0.16, 0.25, 0, 0, z);

    // --- vỉa hè đối diện ---
    const fenceGreen = M(0x1f4a2e, { metalness: 0.4, roughness: 0.5 });
    const ornament = texMat(T.ornamentFenceTexture(), { alphaTest: 0.5, side: THREE.DoubleSide });
    plane(ornament, WORLD, 120, 1.25, 0, 0.62, 53.1, 0, 120 / 2.6, 1);
    for (let x = -60; x <= 60; x += 2.6) {
      box(fenceGreen, WORLD, 0.16, 1.45, 0.16, x, 0, 53.1);
      blob(fenceGreen, WORLD, x, 1.52, 53.1, 0.11, 0.11, 0.11);
    }
    W.colliders.push({ minX: -60.2, maxX: 60.2, minZ: 52.9, maxZ: 53.3, top: 1.5 });
    const globe = M(0xf4f1e6, { emissive: 0xfff3d0, emissiveIntensity: 0.02 });
    for (let x = -56; x <= 56; x += 16) {
      // đèn cột đôi cầu tròn màu xanh
      cyl(fenceGreen, WORLD, 0.08, 3.5, x, 0, 52.5, 0.7);
      box(fenceGreen, WORLD, 0.9, 0.06, 0.06, x, 3.3, 52.5);
      for (const s of [-1, 1]) {
        cyl(fenceGreen, WORLD, 0.03, 0.25, x + s * 0.42, 3.05, 52.5);
        blob(globe, WORLD, x + s * 0.42, 2.95, 52.5, 0.2, 0.2, 0.2);
      }
      const light = new THREE.PointLight(0xffe6b5, 0, 22, 2);
      light.position.set(x, 3, 52.5);
      scene.add(light);
      W.lamps.push({ light, bulb: globe, maxIntensity: 22 });
      W.colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: 52.38, maxZ: 52.62, top: 3.5 });
    }
    for (let x = -60; x <= 60; x += 16) {
      // cây non trong bồn vuông, chống ba cọc tre
      const tx = x + 8;
      box(M(0xa9a59c), WORLD, 1.5, 0.12, 1.5, tx, 0, 50.4);
      box(mats.soil, WORLD, 1.3, 0.13, 1.3, tx, 0, 50.4);
      cyl(mats.trunk, WORLD, 0.07, 3.4, tx, 0, 50.4, 0.6);
      // cây mới trồng: tán thưa, lá nhỏ xanh nhạt
      const young = M(0x7fb25a, { flatShading: true });
      for (let k = 0; k < 6; k++) blob(young, WORLD, tx + Math.cos(k * 2.1) * 0.45, 2.6 + k * 0.28, 50.4 + Math.sin(k * 2.1) * 0.45, 0.28, 0.2, 0.28);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        batch.add(M(0x9b7b55), new THREE.CylinderGeometry(0.025, 0.025, 2.0, 5).translate(0, 1.0, 0), xform(tx + Math.cos(a) * 0.55, 0, 50.4 + Math.sin(a) * 0.55, -a + Math.PI / 2, 0, 0.28));
      }
      W.colliders.push({ minX: tx - 0.75, maxX: tx + 0.75, minZ: 49.65, maxZ: 51.15, top: 0.6 });
    }
    // đèn đường cao, cần vươn ra lòng đường
    const roadLampMetal = M(0xa7a9ab, { metalness: 0.5 });
    const roadLampBulb = M(0xfff1cf, { emissive: 0xffd98a, emissiveIntensity: 0.02 });
    for (let x = -96; x <= 96; x += 32) {
      if (x === 0) continue;
      cyl(roadLampMetal, WORLD, 0.1, 9, x, 0, 48.5, 0.6);
      batch.add(roadLampMetal, new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6).rotateX(Math.PI / 2 - 0.25), xform(x, 8.9, 47.5));
      box(roadLampBulb, WORLD, 0.3, 0.12, 0.7, x, 9.05, 46.4);
      const light = new THREE.PointLight(0xffe3b1, 0, 46, 2);
      light.position.set(x, 8.95, 46.4);
      scene.add(light);
      W.lamps.push({ light, bulb: roadLampBulb, maxIntensity: 75 });
      W.colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: 48.35, maxZ: 48.65, top: 9 });
    }

    // --- sân bóng ---
    const FIELD_X = -125, FIELD_Z = -45;
    const fieldX = (x, z = 90.5) => FIELD_X + z - 90.5;
    const fieldZ = (x, z = 90.5) => FIELD_Z - x;
    const pitchLength = 100, pitchWidth = 48;
    const goalNetWidth = pitchWidth - 15;
    const fieldEntryZ = -28;
    ground(M(0xc3c0b8), -109, FIELD_Z, 98, 130, 0.012, 4);
    const pitchGeometry = new THREE.PlaneGeometry(pitchLength, pitchWidth);
    pitchGeometry.rotateX(-Math.PI / 2);
    pitchGeometry.rotateY(Math.PI / 2);
    const pitch = new THREE.Mesh(pitchGeometry, texMat(T.pitchTexture(), { roughness: 0.95 }));
    pitch.position.set(FIELD_X, 0.02, FIELD_Z);
    pitch.receiveShadow = true;
    root.add(pitch);
    const netMat = texMat(T.netTexture(), { alphaTest: 0.3, side: THREE.DoubleSide, transparent: true });
    netMat.userData.noShadow = true;
    for (const s of [-1, 1]) {
      // khung thành
      const goalZ = fieldZ(s * (pitchLength / 2 - 1.95));
      for (const dx of [-3.66, 3.66]) box(mats.white, WORLD, 0.12, 2.44, 0.12, FIELD_X + dx, 0, goalZ);
      box(mats.white, WORLD, 7.44, 0.12, 0.12, FIELD_X, 2.38, goalZ);
      plane(netMat, WORLD, 7.3, 2.44, FIELD_X, 1.22, goalZ - s * 1.5, 0, 7.3, 2.4);
      // lưới chắn bóng cao sau khung thành
      const postCount = Math.ceil(goalNetWidth / 7);
      const netZ = fieldZ(s * 52.5);
      for (let i = 0; i <= postCount; i++) {
        const dz = -goalNetWidth / 2 + (goalNetWidth * i) / postCount;
        cyl(M(0x8d8f91), WORLD, 0.07, 10, FIELD_X + dz, 0, netZ, 0.8);
      }
      plane(netMat, WORLD, goalNetWidth, 10, FIELD_X, 5, netZ, 0, goalNetWidth / 2, 10 / 2);
    }
    // cột đèn cao áp dạng giàn
    for (const [x, z] of [[-55, 58], [55, 58], [-55, 123], [55, 123]]) {
      const lx = fieldX(x, z), lz = fieldZ(x, z);
      const lattice = M(0x9a9ea2, { metalness: 0.5 });
      batch.add(lattice, new THREE.CylinderGeometry(0.25, 0.7, 24, 4).translate(0, 12, 0), xform(lx, 0, lz, Math.PI / 4));
      const lampHead = M(0xe8e8e8, { emissive: 0xfffbe0, emissiveIntensity: 0.02 });
      const inwardYaw = Math.atan2(FIELD_X - lx, FIELD_Z - lz);
      batch.add(lampHead, GEO.cbox, xform(lx - Math.sign(z - 90.5) * 0.6, 24.5, lz + Math.sign(x) * 0.6, inwardYaw, -0.4).multiply(new THREE.Matrix4().makeScale(3.4, 2.2, 0.35)));
      const floodlight = new THREE.SpotLight(0xffe6bc, 0, 90, Math.PI / 4, 0.4, 2);
      floodlight.position.set(lx, 24.5, lz);
      floodlight.target.position.set(FIELD_X, 0.2, FIELD_Z);
      scene.add(floodlight, floodlight.target);
      W.lamps.push({ light: floodlight, bulb: lampHead, maxIntensity: 110 });
    }
    // khán đài bê tông vàng, mặt bậc nâu đỏ
    const standYellow = M(0xe0b546), seats = M(0x9a5a48), stairGrey = M(0xb0aca4);
    function stand(F, len, tiers) {
      for (let t = 0; t < tiers; t++) {
        box(standYellow, F, len, 0.45 * (t + 1), 0.8, 0, 0, -t * 0.8 - 0.4);
        box(seats, F, len - 0.4, 0.06, 0.5, 0, 0.45 * (t + 1), -t * 0.8 - 0.5);
      }
      for (let i = -2; i <= 2; i++) box(stairGrey, F, 1.0, 0.45 * tiers + 0.02, tiers * 0.8, (i * len) / 5, 0, -tiers * 0.4);
      box(standYellow, F, len, 0.45 * tiers + 1.3, 0.3, 0, 0, -tiers * 0.8 - 0.15);
      W.rects.push({ ...F.rect(-len / 2, len / 2, -tiers * 0.8 - 0.3, 0), kind: 'stand' });
    }
    stand(new Frame(FIELD_X, FIELD_Z + 56, Math.PI), 52, 8);
    stand(new Frame(FIELD_X, FIELD_Z - 56, 0), 52, 8);
    // Nhà thể thao đa năng thay khán đài có mái ở cuối sân.
    {
      const hallX = -78, hallZ = -28;
      const hallF = new Frame(hallX, hallZ, Math.PI);
      const hallW = 40, hallD = 20, hallH = 8.5, hallWall = M(0xe5e8e8);
      const hallAccent = M(0x2c6682), hallRoof = M(0x46545b);
      const hallGlass = M(0x4f8192, { metalness: 0.25, roughness: 0.3 });
      const frontZ = -hallD / 2, backZ = hallD / 2;
      const wallY = 0.2, doorW = 5, sideW = (hallW - doorW) / 2;
      box(mats.floorTile, hallF, hallW, wallY, hallD, 0, 0, 0, { collide: true });
      box(hallWall, hallF, 0.4, hallH, hallD, -hallW / 2 + 0.2, wallY, 0, { collide: true });
      box(hallWall, hallF, 0.4, hallH, hallD, hallW / 2 - 0.2, wallY, 0, { collide: true });
      box(hallWall, hallF, hallW, hallH, 0.4, 0, wallY, backZ - 0.2, { collide: true });
      box(hallWall, hallF, sideW, hallH, 0.4, -(doorW + sideW) / 2, wallY, frontZ + 0.2, { collide: true });
      box(hallWall, hallF, sideW, hallH, 0.4, (doorW + sideW) / 2, wallY, frontZ + 0.2, { collide: true });
      for (const s of [-1, 1]) {
        box(hallGlass, hallF, 7.5, 2.3, 0.06, s * 5.75, 3.3, frontZ - 0.04);
        box(hallGlass, hallF, 0.06, 2.3, 7.5, s * (hallW / 2 - 0.04), 3.3, 0);
        box(hallAccent, hallF, 0.36, 3.8, 0.48, s * 2.7, wallY, frontZ - 0.1, { collide: true });
      }
      box(hallAccent, hallF, doorW + 0.8, 0.55, 0.5, 0, 3.45, frontZ - 0.1);
      box(hallAccent, hallF, hallW + 0.4, 0.65, 0.42, 0, hallH - 0.3, frontZ - 0.04);
      box(hallRoof, hallF, hallW + 1.2, 0.45, hallD + 1.2, 0, hallH + wallY, 0);
      box(M(0xc1915c), hallF, 34, 0.035, 14, 0, wallY, 0);
      const courtLine = M(0xf4eee1);
      for (const s of [-1, 1]) {
        box(courtLine, hallF, 0.07, 0.02, 14, s * 17, wallY + 0.035, 0);
        box(courtLine, hallF, 34, 0.02, 0.07, 0, wallY + 0.035, s * 7);
      }
      box(courtLine, hallF, 0.07, 0.02, 14, 0, wallY + 0.035, 0);
      sign(T.signTexture('NHÀ THỂ THAO ĐA NĂNG', { w: 1400, h: 180, bg: '#2c6682', fg: '#ffffff', border: '#f0d275', size: 88 }),
        12, 1.35, hallX, 7.15, hallZ + hallD / 2 + 0.25);
      W.rects.push({ ...hallF.rect(-hallW / 2, hallW / 2, -hallD / 2, hallD / 2), kind: 'building' });
      W.interact.push({
        x: hallX, z: hallZ + hallD / 2 + 1, r: 4.5,
        label: 'Xem nhà thể thao',
        title: 'Nhà thể thao đa năng',
        text: 'Nhà thể thao đa năng với sân trong nhà, phục vụ bóng rổ, bóng chuyền và các hoạt động thể chất.',
      });
    }
    // nhà thi đấu mái vòm + toà nhà trắng cao phía xa
    {
      const hx = -24, hz = 150;
      box(M(0xd8dde2), WORLD, 44, 8, 30, hx, 0, hz);
      batch.add(M(0x9aa5ae, { metalness: 0.5, roughness: 0.4 }), new THREE.CylinderGeometry(22.5, 22.5, 31, 32, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.32, 1), xform(hx, 8, hz));
      box(M(0xf2f2ee), WORLD, 16, 30, 14, 24, 0, 168);
      plane(mats.house, WORLD, 15, 28, 24, 15, 160.98, Math.PI, 3, 9);
    }
    // --- nhà dân hai đầu đường ---
    const walls = [['#f1e2c6', 0xf1e2c6], ['#d9e4ea', 0xd9e4ea], ['#f2cbb7', 0xf2cbb7], ['#e9e3a8', 0xe9e3a8], ['#dcd3ea', 0xdcd3ea], ['#f7f4ec', 0xf7f4ec], ['#cfe3c8', 0xcfe3c8], ['#a9c6e8', 0xa9c6e8]];
    const shops = [null, { text: 'TẠP HOÁ', bg: '#c62828', fg: '#fff' }, null, { text: 'VĂN PHÒNG PHẨM', bg: '#1565c0', fg: '#fff' }, { text: 'PHOTO – IN ẤN', bg: '#2e7d32', fg: '#fff' }, null, { text: 'TRÀ SỮA', bg: '#ad1457', fg: '#fff' }, { text: 'CƠM VĂN PHÒNG', bg: '#e65100', fg: '#fff' }];
    let hk = 0;
    function shopHouse(x, front, w, floors, faceZ) {
      const [css, hex] = walls[hk % walls.length], shop = shops[(hk * 3) % shops.length];
      hk++;
      const h = floors * 3.4, d = 12, cz = front - faceZ * d / 2;
      box(M(hex), WORLD, w - 0.15, h, d, x, 0, cz, { collide: true });
      sign(T.shopHouseTexture(floors, css, shop), w - 0.3, h, x, h / 2, front + faceZ * 0.02, faceZ > 0 ? 0 : Math.PI);
      if (hk % 3 === 0) batch.add(mats.tileRoof, GEO.pyramid, xform(x, h, cz).multiply(new THREE.Matrix4().makeScale(w * 0.72, 1.8, d * 0.72)));
      else box(M(hex), WORLD, w - 0.15, 0.9, 0.2, x, h, front - faceZ * 0.1);
    }
    for (const [x0, x1, front, faceZ] of [[62, 150, 54.5, -1], [-150, -76, 54.5, -1], [64, 150, 35.5, 1], [-150, -64, 35.5, 1]]) {
      let x = x0;
      while (x < x1) {
        const w = 4.2 + ((hk * 7) % 3) * 0.6, floors = 2 + ((hk * 5) % 3) + (hk % 4 === 0 ? 1 : 0);
        shopHouse(x + w / 2, front, w, floors, faceZ);
        x += w;
      }
    }
    // ô tô đỗ bên lề phía trường (ảnh: xe đỏ đỗ gần đầu phố)
    for (const [x, col] of [[70, 0xd32f2f], [76, 0xc62828], [92, 0xeeeeee]]) {
      box(M(col, { metalness: 0.4, roughness: 0.35 }), WORLD, 4.2, 0.8, 1.8, x, 0.3, 41.3, { collide: true });
      box(M(col, { metalness: 0.4, roughness: 0.35 }), WORLD, 2.4, 0.65, 1.7, x - 0.2, 1.1, 41.3);
      box(M(0x2f3a44, { roughness: 0.2 }), WORLD, 2.3, 0.5, 1.75, x - 0.2, 1.15, 41.3);
      for (const dx of [-1.3, 1.3]) for (const dz of [-0.85, 0.85]) batch.add(mats.dark, new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12).rotateX(Math.PI / 2), xform(x + dx, 0.33, 41.3 + dz));
    }

    // --- quán Tuấn Thảo: góc phía Tây, 2 tầng, cạnh giàn hoa giấy tím ---
    {
      const bx = -67, front = 54.5;
      const baseW = 11, baseD = 11.5, baseH = 6.6;
      box(M(0xf0d3b1), WORLD, baseW, baseH, baseD, bx, 0, front + 6.2, { collide: true });
      box(M(0xf7ead8), WORLD, baseW - 1.2, 0.9, baseD - 1.2, bx, baseH - 0.4, front + 6.2);
      box(M(0xb65a47), WORLD, baseW - 2.2, 1.8, 0.28, bx, 2.8, front + 6.2 + baseD / 2 - 0.18);
      box(M(0x8c4f3c), WORLD, baseW - 2.4, 0.18, 0.18, bx, 4.2, front + 6.2 + baseD / 2 - 0.16);
      for (const dx of [-2.4, 0, 2.4]) {
        box(M(0xa6b4ff), WORLD, 1.3, 2.3, 0.16, bx + dx, 2.1, front + 6.2 + baseD / 2 - 0.24);
        box(M(0xf5f5f5), WORLD, 1.0, 1.2, 0.08, bx + dx, 2.1, front + 6.2 + baseD / 2 - 0.12);
      }
      const roofW = baseW + 0.9, roofD = baseD + 1.0;
      batch.add(mats.tileRoof, GEO.pyramid, xform(bx, baseH + 0.18, front + 6.2).multiply(new THREE.Matrix4().makeScale(roofW * 0.58, 2.2, roofD * 0.58)));
      for (let f = 0; f < 2; f++) {
        box(M(0x3d4b55), WORLD, 7.8, 0.12, 0.12, bx, (f + 1) * 2.8 + 0.3, front + 6.2 - baseD / 2 + 0.2);
      }
      sign(T.signTexture([{ text: 'BIA HƠI', size: 42 }, { text: 'TUẤN THẢO', size: 82 }], { w: 1400, h: 260, bg: '#efe7da', fg: '#b3261e', border: '#3d4b55' }), 9.4, 1.4, bx, 3.1, front + 6.2 - baseD / 2 + 0.38, Math.PI);
      const purple = M(0x9b3fb0, { flatShading: true }), purple2 = M(0xc25bd0, { flatShading: true });
      for (let k = 0; k < 10; k++) blob(k % 2 ? purple : purple2, WORLD, -60 + Math.cos(k) * 1.5, 2.2 + (k % 4) * 0.9, 57 + k * 0.7, 1.4, 1.0, 1.2);
      W.interact.push({
        x: bx + 4, z: 51.5, r: 5, label: 'Xem quán Tuấn Thảo',
        title: 'Quán bia Tuấn Thảo',
        text: 'Quán bia 2 tầng ở góc đầu sân bóng phía Tây, đối diện trường bên kia đường Nguyễn Bỉnh Khiêm, cạnh giàn hoa giấy tím.',
      });
    }
    W.rects.push({ minX: FIELD_X - pitchWidth / 2, maxX: FIELD_X + pitchWidth / 2, minZ: FIELD_Z - pitchLength / 2, maxZ: FIELD_Z + pitchLength / 2, kind: 'field' });
    W.soccerBounds = {
      minX: FIELD_X - pitchWidth / 2 + 0.3,
      maxX: FIELD_X + pitchWidth / 2 - 0.3,
      minZ: FIELD_Z - pitchLength / 2 + 0.3,
      maxZ: FIELD_Z + pitchLength / 2 - 0.3,
    };
    W.interact.push({
      x: FIELD_X + pitchWidth / 2 - 3, z: fieldEntryZ, r: 5, label: 'Xem sân bóng',
      title: 'Sân bóng cỏ nhân tạo sau dãy nhà bên trái',
      text: 'Sân bóng cỏ nhân tạo phía sau dãy nhà bên trái, cạnh nhà thể thao đa năng; có khán đài bê tông, cột đèn cao áp và lưới chắn bóng.',
    });
  }

  // cây bồn tròn viền đỏ + cột điện dọc vỉa hè phía trường
  {
    for (const x of [-46, -54, 38, 46, 54]) {
      batch.add(M(0xb5462e), new THREE.CylinderGeometry(0.9, 0.9, 0.25, 16).translate(0, 0.125, 0), xform(x, 0, 38.9));
      batch.add(mats.soil, new THREE.CylinderGeometry(0.78, 0.78, 0.26, 16).translate(0, 0.13, 0), xform(x, 0, 38.9));
      roundTree(x, 38.9, 1.05);
    }
    const poleMat = M(0xb5b2aa);
    const tops = [];
    for (const x of [-84, -60, -40, 40, 64, 88]) {
      batch.add(poleMat, new THREE.CylinderGeometry(0.12, 0.2, 9, 8).translate(0, 4.5, 0), xform(x, 0, 39.7));
      box(poleMat, WORLD, 0.1, 0.12, 1.6, x, 8.3, 39.7);
      tops.push(x);
      W.colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: 39.5, maxZ: 39.9, top: 9 });
    }
    const pts = [];
  for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      if (a < 0 && b > 0) continue;
      for (const dz of [-0.7, 0, 0.7]) {
        const n = 8;
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, sag = t => 8.4 - Math.sin(t * Math.PI) * 0.6;
          pts.push(a + (b - a) * t0, sag(t0), 39.7 + dz, a + (b - a) * t1, sag(t1), 39.7 + dz);
        }
      }
    }
    const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
    root.add(wires);
  }

  // ---------- trang lưu bút (vật phẩm sưu tầm) ----------
  const memories = [
    [-24, 0.3, -32.2, 'Hành lang lớp học', 'Giờ ra chơi ồn ã trên hành lang, những lần đứng ngóng thầy cô vào lớp, tiếng ve ngoài cửa sổ.'],
    [0, 0, -13, 'Sáng thứ Hai', 'Cả trường xếp hàng ngay ngắn trước sân khấu chào cờ, hát Quốc ca, nghe tổng kết thi đua — những buổi sáng đầu tuần không thể quên.'],
    [42, 0, 28.5, 'Nhà xe', 'Chiếc xe đạp cũ dựng trong nhà xe, chở bao ước mơ trên những con đường làng về trường.'],
    [-51.7, 0.3, 0, 'Bục giảng', 'Bụi phấn trắng trên bục giảng, những người lái đò thầm lặng đưa biết bao thế hệ học trò sang sông.'],
    [2, 1.1, -21.5, 'Ngày bế giảng', 'Đứng trên sân khấu ngày chia tay, những dòng lưu bút viết vội, hẹn nhau ngày gặp lại.'],
    [27, 0, 38.6, 'Mùa phượng', 'Phượng đỏ rực trước cổng trường — mùa thi đến, mùa chia tay cũng đến.'],
    [12, 0, 24, 'Huy hiệu Đoàn', 'Huy hiệu Đoàn đeo lệch tim — nhắc nhở “Sơ vin tươm tất” mỗi sáng.'],
    [-30, 0.3, 14, 'Tem thi đua', 'Tem Sao xanh lớp mình dán trên cột báo màu sân trong.'],
    [38, 0, -12, 'Vé văn nghệ', 'Tờ vé cắt cổ mùa văn nghệ cuối năm — ký tên bạn bè trên mặt sau.'],
    [6, 0, -33, 'Ảnh lớp cũ', 'Tấm ảnh lớp nhòe màu — biết bao kỷ niệm ngày chụp trước sân khấu.'],
  ];
  const glow = T.glowTexture();
  const coverColors = [0xe57399, 0x4f8fd8, 0x58b368, 0xf0a63a, 0x9b6bd0, 0xe25555, 0xd84315, 0x00897b, 0x6d4c41, 0x5c6bc0];
  memories.forEach(([x, y, z, title, text], i) => {
    const g = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: coverColors[i], emissive: coverColors[i], emissiveIntensity: 0.35 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.065, 0.28), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2 }));
    pages.position.x = 0.02;
    cover.castShadow = true;
    g.add(cover, pages);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }));
    halo.scale.set(1.6, 1.6, 1);
    g.add(halo);
    g.position.set(x, y + 0.9, z);
    g.rotation.x = 0.4;
    root.add(g);
    W.collectibles.push({ x, z, baseY: y + 0.9, group: g, title, text, taken: false });
  });

  // ---------- cờ bay ----------
  const flagTex = T.flagTexture();
  function makeFlag(w, h, px, py, pz) {
    const geo = new THREE.PlaneGeometry(w, h, 18, 10).translate(w / 2, -h / 2, 0);
    const base = geo.attributes.position.array.slice();
    const mesh = new THREE.Mesh(geo, texMat(flagTex, { side: THREE.DoubleSide, roughness: 0.7 }));
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    root.add(mesh);
    W.updaters.push(t => {
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = base[i], k = x / w;
        p[i + 2] = Math.sin(x * 2.4 - t * 5.5) * 0.18 * k + Math.sin(x * 4.1 - t * 7.3) * 0.05 * k;
        p[i + 1] = base[i + 1] - k * k * 0.12;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    });
  }
  makeFlag(1.5, 1.0, W.roofFlag.x + 0.05, W.roofFlag.y, W.roofFlag.z);

  W.rects.push({ minX: -6.6, maxX: -2.2, minZ: 34.6, maxZ: 37.4, kind: 'gate' }, { minX: 2.2, maxX: 6.6, minZ: 34.6, maxZ: 37.4, kind: 'gate' });

  batch.flush(root);
  installClassroomSystem(scene, W, root);
  installYardPlay(scene, W, root);
  W.interact.push({
    x: W.soccerBall.spawn.x, z: W.soccerBall.spawn.z, r: 5,
    label: 'Sút bóng (chạy tới bóng)',
    title: 'Sân bóng cỏ nhân tạo',
    text: 'Bóng mặc định ở giữa sân cỏ nhân tạo. Chạy sát và di chuyển nhanh để sút; chỉ có thể chơi bóng trong phạm vi sân.',
  });
  return W;
}
