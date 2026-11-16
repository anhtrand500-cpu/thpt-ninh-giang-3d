import * as THREE from 'three';

const LIFETIME = 1.35;

function createHeartTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff4f81';
  ctx.beginPath();
  ctx.moveTo(64, 112);
  ctx.bezierCurveTo(53, 101, 12, 72, 12, 42);
  ctx.bezierCurveTo(12, 13, 48, 10, 64, 35);
  ctx.bezierCurveTo(80, 10, 116, 13, 116, 42);
  ctx.bezierCurveTo(116, 72, 75, 101, 64, 112);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(42, 38, 7, 12, -0.65, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createHearts(scene) {
  const texture = createHeartTexture();
  const hearts = [];

  function pop(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 1,
      });
      const sprite = new THREE.Sprite(material);
      const size = 0.32 + Math.random() * 0.2;
      sprite.scale.set(size, size, 1);
      sprite.position.set(
        x + (Math.random() - 0.5) * 0.7,
        y + Math.random() * 0.35,
        z + (Math.random() - 0.5) * 0.45,
      );
      scene.add(sprite);
      hearts.push({
        sprite,
        age: 0,
        rise: 1.4 + Math.random() * 0.8,
        drift: (Math.random() - 0.5) * 0.55,
      });
    }
  }

  function update(dt) {
    for (let i = hearts.length - 1; i >= 0; i--) {
      const heart = hearts[i];
      heart.age += dt;
      if (heart.age >= LIFETIME) {
        scene.remove(heart.sprite);
        heart.sprite.material.dispose();
        hearts.splice(i, 1);
        continue;
      }
      const progress = heart.age / LIFETIME;
      heart.sprite.position.y += dt * heart.rise;
      heart.sprite.position.x += dt * heart.drift;
      heart.sprite.material.opacity = 1 - progress;
      heart.sprite.scale.multiplyScalar(1 + dt * 0.18);
    }
  }

  return { pop, update };
}
