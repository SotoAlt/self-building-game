/**
 * Visual effects — camera shake, screen flash, vignette, particles.
 * Receives scene reference via initScreenEffects().
 */

import * as THREE from 'three';
import { cameraShake, particles } from '../state.js';

let _scene = null;

export function initScreenEffects(scene) {
  _scene = scene;
}

export function triggerCameraShake(intensity, duration) {
  cameraShake.intensity = intensity;
  cameraShake.duration = duration;
  cameraShake.startTime = Date.now();
}

export function updateCameraShake() {
  const elapsed = Date.now() - cameraShake.startTime;
  if (elapsed >= cameraShake.duration) {
    cameraShake.offset.set(0, 0, 0);
    return;
  }
  const decay = 1 - elapsed / cameraShake.duration;
  const i = cameraShake.intensity * decay;
  cameraShake.offset.set(
    (Math.random() - 0.5) * i,
    (Math.random() - 0.5) * i,
    (Math.random() - 0.5) * i
  );
}

function createOverlay(zIndex) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:${zIndex};opacity:0;transition:opacity 0.3s;`;
  document.body.appendChild(el);
  return el;
}

let screenFlashEl = null;
let vignetteEl = null;

export function screenFlash(color, duration = 300) {
  if (!screenFlashEl) screenFlashEl = createOverlay(300);
  screenFlashEl.style.background = color;
  screenFlashEl.style.transition = 'none';
  screenFlashEl.style.opacity = '0.4';
  requestAnimationFrame(() => {
    screenFlashEl.style.transition = `opacity ${duration}ms`;
    screenFlashEl.style.opacity = '0';
  });
}

export function showVignette(color, duration = 2000) {
  if (!vignetteEl) vignetteEl = createOverlay(299);
  vignetteEl.style.background = `radial-gradient(ellipse at center, transparent 50%, ${color} 100%)`;
  vignetteEl.style.opacity = '0.6';
  setTimeout(() => { vignetteEl.style.opacity = '0'; }, duration);
}

export function spawnParticles(position, color, count = 20, speed = 5) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];

  const px = position.x ?? position[0] ?? 0;
  const py = position.y ?? position[1] ?? 0;
  const pz = position.z ?? position[2] ?? 0;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    velocities.push(new THREE.Vector3(
      (Math.random() - 0.5) * speed,
      Math.random() * speed,
      (Math.random() - 0.5) * speed
    ));
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(color),
    size: 0.3,
    transparent: true,
    opacity: 1
  });

  const points = new THREE.Points(geometry, material);
  _scene.add(points);

  particles.push({
    mesh: points,
    velocities,
    startTime: Date.now(),
    lifetime: 1500
  });
}

export function updateParticles() {
  const now = Date.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const elapsed = now - p.startTime;

    if (elapsed >= p.lifetime) {
      _scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }

    const positions = p.mesh.geometry.attributes.position.array;
    const count = positions.length / 3;
    const dt = 0.016; // ~60fps

    for (let j = 0; j < count; j++) {
      positions[j * 3] += p.velocities[j].x * dt;
      positions[j * 3 + 1] += p.velocities[j].y * dt;
      positions[j * 3 + 2] += p.velocities[j].z * dt;
      p.velocities[j].y -= 9.8 * dt;
    }

    p.mesh.geometry.attributes.position.needsUpdate = true;
    p.mesh.material.opacity = 1 - elapsed / p.lifetime;
  }
}
