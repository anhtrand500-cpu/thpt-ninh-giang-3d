// Xe đạp học sinh — lấy ở nhà xe, đạp nhanh hơn đi bộ.
import * as THREE from 'three';

export function createBikeVisual(color = 0x2d6cb5) {
  const root = new THREE.Group();
  const wheelGeo = new THREE.TorusGeometry(0.3, 0.03, 8, 20);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 });
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.08 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.45, roughness: 0.35 });
  const wheels = [];
  for (const z of [-0.88, 0.88]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.3, z);
    w.castShadow = true;
    root.add(w);
    wheels.push(w);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.48), paint);
  frame.position.set(0, 0.52, 0);
  frame.castShadow = true;
  root.add(frame);
  const down = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), paint);
  down.position.set(0, 0.32, -0.38);
  down.rotation.x = -0.55;
  root.add(down);
  const driverSeat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.2), chrome);
  driverSeat.position.set(0, 0.74, 0);
  const passengerSeat = driverSeat.clone();
  passengerSeat.position.set(0, 0.78, 0.66);
  root.add(driverSeat, passengerSeat);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.04), chrome);
  bar.position.set(0, 0.92, -0.55);
  root.add(bar);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), paint);
  stem.position.set(0, 0.8, -0.45);
  stem.rotation.x = -0.35;
  root.add(stem);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.9 }));
  basket.position.set(0, 0.72, -0.82);
  root.add(basket);
  const pedalL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.06), chrome);
  pedalL.position.set(-0.1, 0.34, 0.02);
  const pedalR = pedalL.clone();
  pedalR.position.x = 0.1;
  root.add(pedalL, pedalR);
  const footrestL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.08), chrome);
  footrestL.position.set(-0.22, 0.34, 0.68);
  const footrestR = footrestL.clone();
  footrestR.position.x = 0.22;
  root.add(footrestL, footrestR);
  const riders = new Set();
  root.userData.bikeRiders = riders;
  return { root, wheels, pedals: [pedalL, pedalR], riders, colorCode: color };
}

export function attachBikeRider(bikeRoot, charRoot, seat = 'driver') {
  if (charRoot.parent === bikeRoot) {
    charRoot.position.set(0, 0.48, seat === 'passenger' ? 0.68 : 0.02);
    return;
  }
  charRoot.parent?.userData?.bikeRiders?.delete(charRoot);
  charRoot.parent?.remove(charRoot);
  bikeRoot.add(charRoot);
  bikeRoot.userData.bikeRiders?.add(charRoot);
  charRoot.position.set(0, 0.48, seat === 'passenger' ? 0.68 : 0.02);
  charRoot.rotation.set(0, 0, 0);
}

export function detachBikeRider(scene, charRoot, position, facing) {
  charRoot.parent?.userData?.bikeRiders?.delete(charRoot);
  charRoot.parent?.remove(charRoot);
  scene.add(charRoot);
  charRoot.position.copy(position);
  charRoot.rotation.set(0, facing, 0);
}

/** Gắn nhân vật lên yên — con là child của xe, quay theo hướng đạp. */
export function mountBike(player, scene, color, charRoot) {
  if (player.bike) return false;
  const built = createBikeVisual(color);
  player.bike = built;
  player.onBike = true;
  scene.add(built.root);
  attachBikeRider(built.root, charRoot, 'driver');
  return true;
}

export function dismountBike(player, scene, charRoot, feetY, facing) {
  if (!player.bike) return false;
  const b = player.bike;
  b.root.updateMatrixWorld(true);
  for (const rider of [...b.riders]) {
    if (rider === charRoot) continue;
    const position = rider.getWorldPosition(new THREE.Vector3());
    detachBikeRider(scene, rider, position, facing);
  }
  detachBikeRider(scene, charRoot, new THREE.Vector3(player.pos.x, feetY, player.pos.z), facing);
  scene.remove(b.root);
  player.bike = null;
  player.onBike = false;
  return true;
}

export function syncBikeVisual(player, groundY, dt, moveSpeed) {
  const b = player.bike;
  if (!b) return;
  b.root.position.set(player.pos.x, groundY, player.pos.z);
  b.root.rotation.y = player.facing;
  const roll = moveSpeed * dt * 2.8;
  for (const w of b.wheels) w.rotation.x += roll;
  if (b.pedals?.length === 2) {
    const a = performance.now() * 0.008 * Math.min(2, moveSpeed * 0.35);
    b.pedals[0].rotation.x = Math.sin(a) * 0.9;
    b.pedals[1].rotation.x = Math.sin(a + Math.PI) * 0.9;
  }
}
