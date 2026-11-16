// Hoạt động sân trường: chào cờ, bóng đá, album ảnh thật.
import * as THREE from 'three';

export function installYardPlay(scene, W, root) {
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
    { x: 0, z: -17.6, r: 4, img: 'reference/2022-san-khau-nha-chinh.jpg', title: 'Sân khấu & nhà chính', text: 'Lễ khai giảng — sân khấu trước dãy nhà học.' },
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
