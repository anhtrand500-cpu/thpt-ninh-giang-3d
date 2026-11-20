// Hoạt động sân trường: Kỳ Đài Học Trò, chào cờ, bóng đá và album ảnh thật.
import * as THREE from 'three';

export function installYardPlay(scene, W, root) {
  const gameScale = 0.2;
  const sourceCenter = { x: -24, z: 24 };
  const gameCenter = { x: 17.5, z: -12 };
  const gameArea = { minX: -40, maxX: -8, minZ: 14, maxZ: 34 };
  const gameRoot = new THREE.Group();
  gameRoot.position.set(gameCenter.x, 0.02, gameCenter.z);
  gameRoot.scale.setScalar(gameScale);
  root.add(gameRoot);
  const toWorld = (x, z) => ({
    x: gameCenter.x + (x - sourceCenter.x) * gameScale,
    z: gameCenter.z + (z - sourceCenter.z) * gameScale,
  });
  const materials = {
    paving: new THREE.MeshStandardMaterial({ color: 0xd7d0c2, roughness: 0.92 }),
    border: new THREE.MeshStandardMaterial({ color: 0x9b4431, roughness: 0.82 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x777d80, roughness: 0.85 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x26373a, metalness: 0.48, roughness: 0.52 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x493b32, roughness: 0.82 }),
    tabletop: new THREE.MeshStandardMaterial({ color: 0xe9e1d0, roughness: 0.78 }),
    grid: new THREE.MeshStandardMaterial({ color: 0x334f9d, roughness: 0.7 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb83229, roughness: 0.78 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf3eee3, roughness: 0.78 }),
    green: new THREE.MeshStandardMaterial({ color: 0x2d7645, roughness: 0.78 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2764a3, roughness: 0.78 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a72c, roughness: 0.72 }),
  };
  const addBox = (material, width, height, depth, x, y, z, collide = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x - sourceCenter.x, y + height / 2, z - sourceCenter.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    gameRoot.add(mesh);
    if (collide) {
      const position = toWorld(x, z);
      W.colliders.push({
        minX: position.x - width * gameScale / 2,
        maxX: position.x + width * gameScale / 2,
        minZ: position.z - depth * gameScale / 2,
        maxZ: position.z + depth * gameScale / 2,
        top: 0.02 + (y + height) * gameScale,
      });
    }
    return mesh;
  };
  const addFloor = (material, width, depth, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x - sourceCenter.x, y, z - sourceCenter.z);
    mesh.receiveShadow = true;
    gameRoot.add(mesh);
  };
  const addSign = () => {
    addBox(materials.wood, 0.18, 3.9, 0.18, -29.1, 0, 33.25, true);
    addBox(materials.wood, 0.18, 3.9, 0.18, -18.9, 0, 33.25, true);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#211910';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d4a72c';
    ctx.lineWidth = 18;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6d66e';
    ctx.font = 'bold 72px Arial, sans-serif';
    ctx.fillText('KỲ ĐÀI HỌC TRÒ', canvas.width / 2, 132);
    ctx.fillStyle = '#f5f0e2';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText('CỜ CARO  ·  CỜ CÁ NGỰA  ·  CỜ VUA', canvas.width / 2, 230);
    ctx.fillStyle = '#b7d4be';
    ctx.font = '32px Arial, sans-serif';
    ctx.fillText('SÂN SAU NHÀ HỌC CHÍNH', canvas.width / 2, 294);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 3.15),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.68, side: THREE.DoubleSide }),
    );
    sign.position.set(-24 - sourceCenter.x, 3.7, 33.25 - sourceCenter.z);
    sign.castShadow = true;
    gameRoot.add(sign);
  };
  const drawCaroBoard = (x, z) => {
    const side = 3.25, top = 1.08, start = -side / 2, gap = side / 14;
    addBox(materials.tabletop, side + 0.32, 0.16, side + 0.32, x, top - 0.08, z);
    for (let i = 0; i < 15; i++) {
      const offset = start + i * gap;
      addBox(materials.grid, 0.035, 0.018, side, x + offset, top + 0.08, z);
      addBox(materials.grid, side, 0.018, 0.035, x, top + 0.08, z + offset);
    }
  };
  const drawChessBoard = (x, z) => {
    const side = 3.45, top = 1.08, cell = side / 8;
    addBox(materials.wood, side + 0.28, 0.18, side + 0.28, x, top - 0.09, z);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      addBox((row + col) % 2 ? materials.red : materials.white, cell, 0.025, cell,
        x - side / 2 + cell * (col + 0.5), top + 0.09, z - side / 2 + cell * (row + 0.5));
    }
  };
  const drawHorseBoard = (x, z) => {
    const side = 3.5, top = 1.08, cell = side / 6;
    const colors = [materials.red, materials.blue, materials.gold, materials.green];
    addBox(materials.wood, side + 0.28, 0.18, side + 0.28, x, top - 0.09, z);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
      const arm = (row >= 2 && row <= 3) || (col >= 2 && col <= 3);
      const corner = row < 2 && col < 2 ? 0 : row < 2 && col > 3 ? 1 : row > 3 && col > 3 ? 2 : row > 3 && col < 2 ? 3 : -1;
      const material = corner >= 0 ? colors[corner] : arm ? materials.white : materials.tabletop;
      addBox(material, cell, 0.025, cell,
        x - side / 2 + cell * (col + 0.5), top + 0.09, z - side / 2 + cell * (row + 0.5));
    }
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const horse = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 8), colors[i]);
      horse.position.set(x + Math.cos(angle) * 0.45, top + 0.275, z + Math.sin(angle) * 0.45);
      horse.castShadow = true;
      root.add(horse);
    }
  };
  const drawTable = (x, z, board) => {
    addBox(materials.iron, 0.18, 1.0, 0.18, x - 1.25, 0, z - 1.25);
    addBox(materials.iron, 0.18, 1.0, 0.18, x + 1.25, 0, z - 1.25);
    addBox(materials.iron, 0.18, 1.0, 0.18, x - 1.25, 0, z + 1.25);
    addBox(materials.iron, 0.18, 1.0, 0.18, x + 1.25, 0, z + 1.25);
    if (board === 'caro') drawCaroBoard(x, z);
    else if (board === 'chess') drawChessBoard(x, z);
    else drawHorseBoard(x, z);
    addBox(materials.iron, 3.9, 0.12, 0.16, x, 0.48, z + 2.45);
    addBox(materials.stone, 4.0, 0.16, 0.58, x, 0.72, z + 2.45);
    const position = toWorld(x, z);
    W.colliders.push({
      minX: position.x - 1.45 * gameScale, maxX: position.x + 1.45 * gameScale,
      minZ: position.z - 1.45 * gameScale, maxZ: position.z + 1.45 * gameScale,
      top: 1.28 * gameScale,
    });
    const bench = toWorld(x, z + 2.45);
    W.colliders.push({
      minX: bench.x - 2.1 * gameScale, maxX: bench.x + 2.1 * gameScale,
      minZ: bench.z - 0.34 * gameScale, maxZ: bench.z + 0.34 * gameScale,
      top: 0.92 * gameScale,
    });
  };

  addFloor(materials.paving, 32, 20, -24, 0.035, 24);
  for (let x = gameArea.minX; x <= gameArea.maxX; x += 4) {
    addBox(materials.border, 0.1, 0.045, 20, x, 0.04, 24);
  }
  for (let z = gameArea.minZ; z <= gameArea.maxZ; z += 4) {
    addBox(materials.border, 32, 0.045, 0.1, -24, 0.04, z);
  }
  addSign();
  drawTable(-33, 23, 'caro');
  drawTable(-24, 23, 'horses');
  drawTable(-15, 23, 'chess');
  const min = toWorld(gameArea.minX, gameArea.minZ);
  const max = toWorld(gameArea.maxX, gameArea.maxZ);
  W.rects.push({ minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, kind: 'yardGame' });
  for (const [x, z, radius, label, game] of [
    [-33, 20.7, 3.7, 'Chơi Cờ Caro', 'caro'],
    [-24, 20.7, 3.7, 'Chơi Cờ Cá Ngựa', 'horses'],
    [-15, 20.7, 3.7, 'Chơi Cờ Vua', 'chess'],
    [-24, 32, 4.2, 'Mở Kỳ Đài Học Trò', null],
  ]) {
    const position = toWorld(x, z);
    W.interact.push({
      ...position,
      r: radius * gameScale,
      label,
      action: 'yard-game',
      ...(game ? { game } : {}),
    });
  }

  const bounds = W.soccerBounds;
  const spawn = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
  );
  ball.position.set(spawn.x, 0.22, spawn.z);
  ball.castShadow = true;
  root.add(ball);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.04, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x212121 }),
  );
  stripe.rotation.z = Math.PI / 2;
  ball.add(stripe);
  W.soccerBall = {
    mesh: ball,
    pos: ball.position,
    vel: new THREE.Vector3(),
    onGround: true,
    spawn,
  };

  const albums = [
    { x: 0, z: 36.8, r: 3.2, img: 'reference/2022-cong-nhin-tu-trong.jpg', title: 'Cổng nhìn từ trong', text: 'Ảnh thực tế khu cổng trường.' },
    { x: 0, z: -17.6, r: 4, img: 'reference/2022-san-khau-nha-chinh.jpg', title: 'Sân khấu & nhà chính', text: 'Lễ chào mừng ngày Nhà Giáo Việt Nam 20/11 — sân khấu trước dãy nhà học.' },
    { x: -24, z: 6, r: 3, img: 'reference/2022-cay-co-thu.jpg', title: 'Cây cổ thụ sân trong', text: 'Gốc cây treo kẻng ra chơi.' },
    { x: 20, z: -28, r: 3, img: 'reference/nha-hoc-chinh.jpg', title: 'Nhà học chính', text: 'Mặt tiền dãy lớp học ba tầng.' },
    { x: 0, z: 51, r: 5, img: 'reference/gg-street-2026-san-bong.png', title: 'Sân bóng đối diện', text: 'Sân cỏ nhân tạo bên kia đường Nguyễn Bỉnh Khiêm.' },
  ];
  for (const a of albums) {
    W.interact.push({
      x: a.x, z: a.z, r: a.r,
      label: 'Xem ảnh thật trường',
      action: 'gallery',
      title: a.title,
      text: a.text,
      image: a.img,
    });
  }
}

export function tickSoccer(W, col, player, dt) {
  const b = W.soccerBall;
  const bounds = W.soccerBounds;
  if (!b || !bounds) return;
  const { pos, vel, mesh } = b;
  const insideField = p => p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
  const d = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
  const kick = insideField(player.pos) && insideField(pos) && d < 0.85 && Math.hypot(player.vel.x, player.vel.z) > 2;
  if (kick && performance.now() - (b.lastKick || 0) > 400) {
    b.lastKick = performance.now();
    const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z, len = Math.hypot(dx, dz) || 1;
    vel.set((dx / len) * 9 + player.vel.x * 0.4, 0, (dz / len) * 9 + player.vel.z * 0.4);
    b.onGround = false;
  }
  vel.multiplyScalar(0.985);
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  if (pos.x < bounds.minX) { pos.x = bounds.minX; if (vel.x < 0) vel.x *= -0.35; }
  else if (pos.x > bounds.maxX) { pos.x = bounds.maxX; if (vel.x > 0) vel.x *= -0.35; }
  if (pos.z < bounds.minZ) { pos.z = bounds.minZ; if (vel.z < 0) vel.z *= -0.35; }
  else if (pos.z > bounds.maxZ) { pos.z = bounds.maxZ; if (vel.z > 0) vel.z *= -0.35; }
  let gY = col.groundAt(pos.x, pos.z, 0);
  col.resolve(pos, gY, 0.22);
  pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, pos.x));
  pos.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, pos.z));
  gY = col.groundAt(pos.x, pos.z, 0);
  let y = gY + 0.22;
  if (!b.onGround) {
    b.vy = (b.vy ?? 0) - 12 * dt;
    y += b.vy * dt;
    if (y <= gY + 0.22) { y = gY + 0.22; b.vy = 0; b.onGround = true; }
  }
  mesh.position.set(pos.x, y, pos.z);
  mesh.rotation.x += vel.z * dt * 2;
  mesh.rotation.z -= vel.x * dt * 2;
}

let flagDoneSession = false;
let flagT = 0;
let flagActive = false;

export function tickFlagCeremony(ctx, dt) {
  const { player, npcs, toast, drumSound, mp } = ctx;
  if (flagDoneSession) return;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const force = typeof location !== 'undefined' && new URLSearchParams(location.search).has('chuaco');
  const morning = force || (h === 7 && m < 30);
  const atStage = Math.hypot(player.pos.x, player.pos.z + 20) < 22;
  if (!morning && !flagActive) return;
  if (!atStage && !flagActive) return;
  if (!flagActive) {
    flagActive = true;
    flagT = 0;
    toast('7h15 — Chào cờ đầu tuần! Đứng trên sân khấu xem lễ.', 4500);
    drumSound?.();
    for (const n of npcs) if (!n.static) {
      n.mode = 'ceremony';
      n.target = { x: (Math.random() - 0.5) * 12, z: -21 - Math.random() * 3 };
      n.wait = 0;
    }
    mp?.act?.('drum');
  }
  flagT += dt;
  if (flagT > 28) {
    flagDoneSession = true;
    flagActive = false;
    toast('Hạ cờ — vào lớp thôi!', 2800);
    for (const n of npcs) if (!n.static) { n.mode = 'wander'; n.target = null; }
  }
}

export function openGallery(image, title, text) {
  const el = document.getElementById('galleryView');
  if (!el) return;
  el.querySelector('h2').textContent = title || 'Ảnh trường';
  el.querySelector('p').textContent = text || '';
  el.querySelector('img').src = image;
  el.hidden = false;
}

export function closeGallery() {
  const el = document.getElementById('galleryView');
  if (el) el.hidden = true;
}
