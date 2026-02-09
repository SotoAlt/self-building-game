/**
 * ToonMaterials — Cel-shaded material factory for all game entities and players
 *
 * Replaces flat MeshStandardMaterial with MeshToonMaterial + gradient maps.
 * Gives the game a stylized cartoon look (Fall Guys / Splatoon vibe).
 */

import * as THREE from 'three';
import { getProceduralTexture } from './ProceduralTextures.js';

function createGradientTexture(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const GRADIENT_2 = createGradientTexture(2); // Bold: dark/light
const GRADIENT_3 = createGradientTexture(3); // Classic toon: shadow/mid/highlight
const GRADIENT_4 = createGradientTexture(4); // Softer: 4 steps

const GRADIENT_MAP = {
  platform: GRADIENT_3,
  ramp: GRADIENT_3,
  collectible: GRADIENT_2,
  obstacle: GRADIENT_2,
  trigger: GRADIENT_3,
  decoration: GRADIENT_4,
};

export function createEntityToonMaterial(entity) {
  const props = entity.properties || {};
  const type = entity.type;

  // Ice: keep physical material for reflective look
  if (props.isIce) {
    return new THREE.MeshPhysicalMaterial({
      color: '#b3e5fc',
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.85,
      emissive: '#b3e5fc',
      emissiveIntensity: 0.1,
    });
  }

  const color = getEntityColor(type, props.color);
  const isTransparent = props.opacity != null && props.opacity < 1;
  const gradientMap = GRADIENT_MAP[type] || GRADIENT_3;

  const matOpts = {
    color,
    gradientMap,
    emissive: color,
    emissiveIntensity: props.emissive ? 0.5 : 0.12,
    transparent: isTransparent,
    opacity: props.opacity ?? 1,
  };

  // Conveyor belt: warmer emissive
  if (props.isConveyor) {
    matOpts.emissive = new THREE.Color('#e67e22');
    matOpts.emissiveIntensity = 0.25;
  }

  const material = new THREE.MeshToonMaterial(matOpts);

  const texture = getProceduralTexture(entity);
  if (texture) {
    material.map = texture;
  }

  return material;
}

export function createPlayerToonMaterial(color) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: GRADIENT_3,
    emissive: color,
    emissiveIntensity: 0.3,
  });
}

export function createGroundToonMaterial() {
  return new THREE.MeshToonMaterial({
    color: 0x3d4446,
    gradientMap: GRADIENT_4,
    emissive: 0x3d4446,
    emissiveIntensity: 0.08,
  });
}

const ENTITY_COLORS = {
  platform: 0x3498db,
  ramp: 0x2ecc71,
  collectible: 0xf1c40f,
  obstacle: 0xe74c3c,
  trigger: 0x9b59b6,
  decoration: 0x95a5a6,
};

function getEntityColor(type, customColor) {
  if (customColor) return new THREE.Color(customColor);
  return new THREE.Color(ENTITY_COLORS[type] || 0x95a5a6);
}

export { getEntityColor };
