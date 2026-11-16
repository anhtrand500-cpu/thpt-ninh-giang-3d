// Phòng học trong khối nhà — tham khảo ảnh phòng THPT Ninh Giang: cửa đóng/mở (E), không xuyên tường.
import * as THREE from 'three';
import * as T from './textures.js';

const FH = 3.6;
const DOOR_W = 1.02;
const DOOR_H = 2.05;

const matCache = new Map();
function M(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...opts }));
  return matCache.get(key);
}

export function isClassRoomCode(name) {
  const code = String(name ?? '').toUpperCase().replace(/\s/g, '');
  return /^\d{1,2}[A-Z]{1,2}\d{0,2}$/.test(code);
}

function pushCol(W, rect, top, bottom = 0, noCam = false) {
  W.colliders.push({ ...rect, top, bottom, noCam });
}

function worldPos(F, x, y, z) {
  return new THREE.Vector3(x, y, z).applyMatrix4(F.m);
}

function faceY(F) {
  return Math.atan2(F.m.elements[8], F.m.elements[0]) + Math.PI;
}

const shellBuilt = new Set();

/** Vách kín + sàn; cửa do installClassroomDoor (đóng mặc định). */
export function ensureClassroomShell(F, W, mats, batch, wallMat, { xc, bw, D, roomFront, floorIndex }) {
  const key = `${F.m.elements[12]}|${F.m.elements[14]}|${xc}|${floorIndex}`;
  if (shellBuilt.has(key)) return;
  shellBuilt.add(key);

  const interior = M(0xf5f1e8);
  const zBack = -D / 2 + 0.12;
  const zFront = roomFront - 0.06;
  const halfW = bw / 2 - 0.16;
  const y0 = floorIndex === 0 ? 0 : floorIndex * FH;
  const yFloor = y0 + (floorIndex === 0 ? 0.3 : 0.02);
  const wallY = floorIndex === 0 ? 0.15 : y0;
  const wallH = FH - (floorIndex === 0 ? 0.15 : 0);
  const wt = 0.16;
  const doorHalf = DOOR_W / 2;

  const floorTh = 0.2;
  batch.add(mats.floorTile, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    F.at(xc, y0, (zBack + zFront) / 2).multiply(new THREE.Matrix4().makeScale(bw - 0.22, floorTh, zFront - zBack)));
  pushCol(W, F.rect(xc - halfW, xc + halfW, zBack, zFront), yFloor + 0.12, y0);

  batch.add(interior, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    F.at(xc, wallY, zBack - wt / 2).multiply(new THREE.Matrix4().makeScale(bw - 0.06, wallH, wt)));
  pushCol(W, F.rect(xc - halfW, xc + halfW, zBack - wt, zBack), wallY + wallH, wallY);

  for (const s of [-1, 1]) {
    batch.add(interior, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      F.at(xc + s * halfW, wallY, (zBack + zFront) / 2).multiply(new THREE.Matrix4().makeScale(wt, wallH, zFront - zBack + 0.06)));
    pushCol(W, F.rect(xc + s * (halfW - wt / 2), xc + s * (halfW + wt / 2), zBack, zFront), wallY + wallH, wallY);
  }

  const segW = Math.max(0.2, halfW - doorHalf - 0.06);
  for (const s of [-1, 1]) {
    const segX = xc + s * (doorHalf + segW / 2 + 0.02);
    batch.add(wallMat, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      F.at(segX, wallY, zFront + wt / 2).multiply(new THREE.Matrix4().makeScale(segW, wallH, wt)));
    pushCol(W, F.rect(segX - segW / 2, segX + segW / 2, zFront, zFront + wt + 0.02), wallY + wallH, wallY);
  }
  const lintelH = wallH - DOOR_H;
  if (lintelH > 0.08) {
    batch.add(wallMat, new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      F.at(xc, wallY + DOOR_H, zFront + wt / 2).multiply(new THREE.Matrix4().makeScale(DOOR_W + 0.06, lintelH, wt)));
    pushCol(W, F.rect(xc - doorHalf - 0.03, xc + doorHalf + 0.03, zFront, zFront + wt + 0.02), wallY + wallH, wallY + DOOR_H);
  }
}

/** Cửa gỗ + va chạm khi đóng; E để mở/đóng. */
export function installClassroomDoor(root, F, W, { xc, roomFront, floorIndex, className }) {
  const y0 = floorIndex === 0 ? 0 : floorIndex * FH;
  const wallY = floorIndex === 0 ? 0.15 : y0;
  const zFront = roomFront - 0.06;
  const fy = faceY(F);
  const id = `${className}-f${floorIndex}`;

  const hinge = new THREE.Group();
  const wood = M(0x6d4c33);
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.07), wood);
  doorMesh.position.set(DOOR_W / 2, DOOR_H / 2, 0.04);
  hinge.add(doorMesh);

  const hingeLocal = new THREE.Vector3(xc - DOOR_W / 2, wallY, zFront + 0.04);
  hinge.position.copy(worldPos(F, hingeLocal.x, hingeLocal.y, hingeLocal.z));
  hinge.rotation.y = fy;
  root.add(hinge);

  const closedRect = F.rect(xc - DOOR_W / 2, xc + DOOR_W / 2, zFront - 0.02, zFront + 0.18);
  const closedCol = { ...closedRect, top: wallY + DOOR_H, bottom: wallY, doorId: id };
  W.colliders.push(closedCol);

  const interact = worldPos(F, xc, wallY + 1.0, zFront + 0.55);
  const door = {
    id,
    className,
    floor: floorIndex + 1,
    hinge,
    open: false,
    baseRot: fy,
    swing: -Math.PI / 2.15,
    closedCol,
    colRef: closedCol,
    ix: interact.x,
    iz: interact.z,
  };
  W.classroomDoors = W.classroomDoors || [];
  W.classroomDoors.push(door);
}

export function toggleClassroomDoor(W, id) {
  const d = (W.classroomDoors || []).find(x => x.id === id);
  if (!d) return false;
  d.open = !d.open;
  if (d.open) {
    const i = W.colliders.indexOf(d.colRef);
    if (i >= 0) W.colliders.splice(i, 1);
    d.colRef = null;
    d.hinge.rotation.y = d.baseRot + d.swing;
  } else {
    const col = { ...d.closedCol, doorId: id };
    W.colliders.push(col);
    d.colRef = col;
    d.hinge.rotation.y = d.baseRot;
  }
  return d.open;
}

/** Nội thất kiểu ảnh phòng: lối giữa, bàn dài hai bên, bảng xanh + TV, bàn GV. */
export function furnishClassroom(root, F, W, { xc, bw, D, roomFront, floorIndex, className }) {
  const zBack = -D / 2 + 0.4;
  const zFront = roomFront - 0.45;
  const zC = (zBack + zFront) / 2;
  const depth = zFront - zBack;
  const halfW = bw / 2 - 0.38;
  const y0 = floorIndex === 0 ? 0 : floorIndex * FH;
  const fy = faceY(F);

  const group = new THREE.Group();
  group.name = `class-${className}-f${floorIndex}`;
  root.add(group);

  const wood = M(0xc9a86c);
  const woodLight = M(0xe3d0b0);
  const boardGreen = M(0x2d5c44, { roughness: 0.92 });
  const metal = M(0xe8e8e8, { metalness: 0.35, roughness: 0.5 });
  const chair = M(0x5a7ea8);

  const place = (mesh, lx, ly, lz, rotOff = 0) => {
    mesh.position.copy(worldPos(F, xc + lx, y0 + ly, zC + lz));
    mesh.rotation.y = fy + rotOff;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const colBox = (lx, lz, w, d, h, ly = 0) => {
    pushCol(W, F.rect(xc + lx - w / 2, xc + lx + w / 2, zC + lz - d / 2, zC + lz + d / 2), y0 + ly + h, y0 + ly);
  };

  const backZ = -depth / 2 + 0.35;
  // Bảng xanh hai bên + TV giữa (như ảnh)
  for (const s of [-1, 1]) {
    const bw_ = Math.min(1.05, halfW - 0.55);
    place(new THREE.Mesh(new THREE.BoxGeometry(bw_, 1.05, 0.05), boardGreen), s * (bw_ * 0.55 + 0.35), 1.35, backZ);
    place(new THREE.Mesh(new THREE.BoxGeometry(bw_, 0.06, 0.12), M(0xc8b87a)), s * (bw_ * 0.55 + 0.35), 0.78, backZ + 0.04);
  }
  const tvTex = T.signTexture(className, { w: 900, h: 300, bg: '#1a237e', fg: '#ffffff', border: '#90caf9', size: 72 });
  place(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.72, 0.05), new THREE.MeshStandardMaterial({ map: tvTex })), 0, 1.42, backZ);
  place(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.9), M(0xd7ccc8)), 0, 0.18, backZ + 0.48);

  // Bàn giáo viên góc trái (ảnh: khăn xanh)
  place(new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.74, 0.58), wood), -halfW + 0.62, 0.5, backZ + 0.95);
  place(new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.03, 0.62), M(0x1565c0)), -halfW + 0.62, 0.76, backZ + 0.95);
  colBox(-halfW + 0.62, backZ + 0.95, 1.15, 0.6, 0.74);

  // Bàn học sinh dài hai dãy, lối đi giữa
  const deskLen = Math.min(1.35, halfW * 0.65);
  const colXs = [-halfW * 0.62, halfW * 0.62];
  const rows = Math.min(5, Math.max(4, Math.floor(depth / 1.05)));
  for (let r = 0; r < rows; r++) {
    const z = backZ + 1.45 + r * 0.92;
    if (z > depth / 2 - 0.45) break;
    for (const x of colXs) {
      place(new THREE.Mesh(new THREE.BoxGeometry(deskLen, 0.06, 0.52), woodLight), x, 0.74, z);
      place(new THREE.Mesh(new THREE.BoxGeometry(deskLen, 0.04, 0.02), metal), x, 0.71, z);
      colBox(x, z, deskLen, 0.52, 0.74);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.36), chair), x - 0.22, 0.48, z + 0.52);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.36), chair), x + 0.22, 0.48, z + 0.52);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.04), chair), x, 0.68, z + 0.72);
    }
  }

  // Đèn treo + quạt
  for (const x of [-halfW * 0.5, halfW * 0.5]) {
    place(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.32), M(0xffffff, { emissive: 0xfff8e7, emissiveIntensity: 0.45 })), x, FH - 0.28, 0);
  }
  place(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8), metal), 0, FH - 0.55, 0.25);

  // Cửa sổ vách trái (như ảnh)
  if (halfW > 0.55) {
    const nWin = Math.min(2, Math.floor(depth / 2.2));
    for (let w = 0; w < nWin; w++) {
      const wz = backZ + 1.2 + w * (depth / (nWin + 0.5));
      place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 1.25), M(0xc8e8ff, { emissive: 0xb3e5fc, emissiveIntensity: 0.15 })), -halfW + 0.06, 1.42, wz);
      place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 1.35), M(0xffffff)), -halfW + 0.05, 1.85, wz);
    }
  }

  // Máy lạnh treo tường
  place(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.26, 0.2), M(0xf5f5f5)), halfW - 0.45, 2.75, backZ + 0.35);
}

export function registerClassroomMeta(W, F, { xc, bw, D, roomFront, floorIndex, className }) {
  const zC = (roomFront - 0.45 + (-D / 2 + 0.4)) / 2;
  const cen = worldPos(F, xc, floorIndex * FH + 1.5, zC);
  W.classroomRooms = W.classroomRooms || [];
  W.classroomRooms.push({ className, floor: floorIndex + 1, x: cen.x, z: cen.z });
}

export function installClassroomSystem(_parent, W, _yardRoot) {
  W.classroomDoors = W.classroomDoors || [];
}
