/**
 * EnvironmentEffects — Ambient particles and sky gradient sphere
 *
 * Auto-selects particle type from floor type / environment colors.
 * Single Points mesh per type = one draw call for all particles.
 */

import * as THREE from 'three';

let particleSystem = null;
let particleVelocities = null;
let particleType = 'dust'; // dust, embers, snow
let skyDome = null;

const PARTICLE_COUNT = 150;
const PARTICLE_SPREAD = 60;

const skyVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;
  varying vec3 vWorldPosition;

  void main() {
    float h = normalize(vWorldPosition + offset).y;
    float t = max(pow(max(h, 0.0), exponent), 0.0);
    gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
  }
`;

export function createSkyDome(scene) {
  const skyGeo = new THREE.SphereGeometry(400, 16, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x1a3050) },
      bottomColor: { value: new THREE.Color(0x2a3a5e) },
      offset: { value: 20 },
      exponent: { value: 0.6 },
    },
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });

  skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);
  return skyDome;
}

export function updateSkyColors(skyColor, fogColor) {
  if (!skyDome) return;
  const top = new THREE.Color(skyColor);
  const bottom = fogColor ? new THREE.Color(fogColor) : top.clone().multiplyScalar(0.6);
  skyDome.material.uniforms.topColor.value.copy(top);
  skyDome.material.uniforms.bottomColor.value.copy(bottom);
}

function getParticleConfig(type) {
  switch (type) {
    case 'embers':
      return {
        color: 0xff6622,
        size: 0.25,
        velocityY: [0.5, 1.5],  // rise
        velocityXZ: 0.3,
        opacity: 0.7,
      };
    case 'snow':
      return {
        color: 0xffffff,
        size: 0.2,
        velocityY: [-0.8, -0.3],  // fall
        velocityXZ: 0.5,
        opacity: 0.6,
      };
    case 'dust':
    default:
      return {
        color: 0xffffff,
        size: 0.12,
        velocityY: [-0.1, 0.1],  // drift
        velocityXZ: 0.2,
        opacity: 0.35,
      };
  }
}

export function initParticles(scene, type = 'dust') {
  disposeParticles(scene);

  particleType = type;
  const config = getParticleConfig(type);

  const positions = new Float32Array(PARTICLE_COUNT * 3);
  particleVelocities = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * PARTICLE_SPREAD;
    positions[i3 + 1] = Math.random() * 30 + 2;
    positions[i3 + 2] = (Math.random() - 0.5) * PARTICLE_SPREAD;

    particleVelocities[i3] = (Math.random() - 0.5) * config.velocityXZ;
    particleVelocities[i3 + 1] = config.velocityY[0] + Math.random() * (config.velocityY[1] - config.velocityY[0]);
    particleVelocities[i3 + 2] = (Math.random() - 0.5) * config.velocityXZ;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: config.color,
    size: config.size,
    transparent: true,
    opacity: config.opacity,
    depthWrite: false,
    blending: type === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  particleSystem = new THREE.Points(geometry, material);
  particleSystem.frustumCulled = false;
  scene.add(particleSystem);
}

export function updateEnvironmentEffects(delta, cameraPosition) {
  if (!particleSystem || !particleVelocities) return;

  const positions = particleSystem.geometry.attributes.position.array;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] += particleVelocities[i3] * delta;
    positions[i3 + 1] += particleVelocities[i3 + 1] * delta;
    positions[i3 + 2] += particleVelocities[i3 + 2] * delta;

    if (cameraPosition) {
      const dx = positions[i3] - cameraPosition.x;
      const dz = positions[i3 + 2] - cameraPosition.z;
      const halfSpread = PARTICLE_SPREAD / 2;
      if (dx > halfSpread) positions[i3] -= PARTICLE_SPREAD;
      if (dx < -halfSpread) positions[i3] += PARTICLE_SPREAD;
      if (dz > halfSpread) positions[i3 + 2] -= PARTICLE_SPREAD;
      if (dz < -halfSpread) positions[i3 + 2] += PARTICLE_SPREAD;
    }

    if (particleType === 'embers' && positions[i3 + 1] > 35) {
      positions[i3 + 1] = 0;
    } else if (particleType === 'snow' && positions[i3 + 1] < -1) {
      positions[i3 + 1] = 30;
    } else if (positions[i3 + 1] > 35 || positions[i3 + 1] < -1) {
      positions[i3 + 1] = Math.random() * 30;
    }
  }

  particleSystem.geometry.attributes.position.needsUpdate = true;
}

export function disposeParticles(scene) {
  if (particleSystem) {
    scene.remove(particleSystem);
    particleSystem.geometry.dispose();
    particleSystem.material.dispose();
    particleSystem = null;
    particleVelocities = null;
  }
}

export function selectParticleType(floorType, environment) {
  if (floorType === 'lava') return 'embers';

  if (environment?.skyColor) {
    const sky = new THREE.Color(environment.skyColor);
    if (sky.b > 0.4 && sky.r < 0.3 && sky.g < 0.3) return 'snow';
    if (sky.r > 0.3 && sky.b < 0.15) return 'embers';
  }

  return 'dust';
}
