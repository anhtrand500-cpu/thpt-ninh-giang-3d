import * as THREE from 'three';

const COLORS = [0xff4d4d, 0x54d6ff, 0xffd84a, 0xd978ff, 0x70ff9b];
const LAUNCH_X = [-5.5, 0, 5.5];
const LAUNCH_Z = -20.2;
const BURST_COUNT = 84;
const BURST_LIFETIME = 2.1;

export function createFireworks(scene) {
  const rockets = [];
  const bursts = [];
  const rocketGeometry = new THREE.SphereGeometry(0.1, 8, 6);
  let time = 0;

  function launch() {
    for (let i = 0; i < LAUNCH_X.length; i++) {
      const x = LAUNCH_X[i] + (Math.random() - 0.5) * 0.8;
      const z = LAUNCH_Z + (Math.random() - 0.5) * 0.5;
      rockets.push({
        startAt: time + i * 0.28,
        startX: x,
        startZ: z,
        targetX: x + (Math.random() - 0.5) * 1.8,
        targetY: 11 + Math.random() * 3,
        targetZ: z + (Math.random() - 0.5) * 1.4,
        duration: 0.9 + Math.random() * 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        mesh: null,
        trail: null,
        trailPositions: null,
      });
    }
  }

  function createRocketTrail(rocket) {
    const material = new THREE.MeshBasicMaterial({ color: rocket.color });
    rocket.mesh = new THREE.Mesh(rocketGeometry, material);
    scene.add(rocket.mesh);

    rocket.trailPositions = new Float32Array(18);
    for (let i = 0; i < 6; i++) {
      rocket.trailPositions[i * 3] = rocket.startX;
      rocket.trailPositions[i * 3 + 1] = 1.25;
      rocket.trailPositions[i * 3 + 2] = rocket.startZ;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(rocket.trailPositions, 3));
    const trailMaterial = new THREE.LineBasicMaterial({
      color: rocket.color,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    rocket.trail = new THREE.Line(geometry, trailMaterial);
    rocket.trail.frustumCulled = false;
    scene.add(rocket.trail);
  }

  function createBurst(rocket, elapsed) {
    const positions = new Float32Array(BURST_COUNT * 3);
    const colors = new Float32Array(BURST_COUNT * 3);
    const velocities = new Float32Array(BURST_COUNT * 3);
    const baseColor = new THREE.Color(rocket.color);
    const brightColor = new THREE.Color(0xffffff);
    for (let i = 0; i < BURST_COUNT; i++) {
      const p = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const vertical = Math.random() * 2 - 1;
      const radial = Math.sqrt(1 - vertical * vertical);
      const speed = 2.5 + Math.random() * 4.5;
      velocities[p] = Math.cos(theta) * radial * speed;
      velocities[p + 1] = vertical * speed;
      velocities[p + 2] = Math.sin(theta) * radial * speed;
      const color = Math.random() < 0.28 ? brightColor : baseColor;
      colors[p] = color.r;
      colors[p + 1] = color.g;
      colors[p + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    bursts.push({
      points,
      positions,
      velocities,
      x: rocket.targetX,
      y: rocket.targetY,
      z: rocket.targetZ,
      startedAt: elapsed,
    });
  }

  function removeRocket(rocket) {
    scene.remove(rocket.mesh, rocket.trail);
    rocket.mesh.material.dispose();
    rocket.trail.geometry.dispose();
    rocket.trail.material.dispose();
  }

  function update(elapsed) {
    time = elapsed;
    for (let i = rockets.length - 1; i >= 0; i--) {
      const rocket = rockets[i];
      if (elapsed < rocket.startAt) continue;
      if (!rocket.mesh) createRocketTrail(rocket);

      const progress = Math.min(1, (elapsed - rocket.startAt) / rocket.duration);
      const eased = progress * progress;
      const x = rocket.startX + (rocket.targetX - rocket.startX) * eased;
      const y = 1.25 + (rocket.targetY - 1.25) * progress;
      const z = rocket.startZ + (rocket.targetZ - rocket.startZ) * eased;
      rocket.mesh.position.set(x, y, z);

      const trail = rocket.trailPositions;
      for (let j = 5; j > 0; j--) {
        trail[j * 3] = trail[(j - 1) * 3];
        trail[j * 3 + 1] = trail[(j - 1) * 3 + 1];
        trail[j * 3 + 2] = trail[(j - 1) * 3 + 2];
      }
      trail[0] = x;
      trail[1] = y;
      trail[2] = z;
      rocket.trail.geometry.attributes.position.needsUpdate = true;

      if (progress === 1) {
        createBurst(rocket, elapsed);
        removeRocket(rocket);
        rockets.splice(i, 1);
      }
    }

    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i];
      const age = elapsed - burst.startedAt;
      if (age >= BURST_LIFETIME) {
        scene.remove(burst.points);
        burst.points.geometry.dispose();
        burst.points.material.dispose();
        bursts.splice(i, 1);
        continue;
      }
      for (let j = 0; j < BURST_COUNT; j++) {
        const p = j * 3;
        burst.positions[p] = burst.x + burst.velocities[p] * age;
        burst.positions[p + 1] = burst.y + burst.velocities[p + 1] * age - 1.8 * age * age;
        burst.positions[p + 2] = burst.z + burst.velocities[p + 2] * age;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.points.material.opacity = 1 - age / BURST_LIFETIME;
    }
  }

  return { launch, update };
}
