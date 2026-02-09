/**
 * ProceduralTextures — Canvas-based texture generators for toon surfaces
 *
 * Each returns a cached CanvasTexture (128x128, tiled).
 * Auto-assigned per entity type in ToonMaterials.
 */

import * as THREE from 'three';

const SIZE = 128;
const textureCache = new Map();

function getCached(key, generator) {
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = generator();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, texture);
  return texture;
}

export function checkerTexture(color1 = '#4a90d9', color2 = '#3a7bc8') {
  const key = `checker_${color1}_${color2}`;
  return getCached(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const half = SIZE / 2;

    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = color2;
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);

    const tex = new THREE.CanvasTexture(canvas);
    tex.repeat.set(2, 2);
    return tex;
  });
}

export function stripeTexture(color = '#e67e22', darkColor = '#d35400') {
  const key = `stripe_${color}_${darkColor}`;
  return getCached(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const stripeWidth = SIZE / 8;

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = darkColor;
    for (let i = 0; i < 8; i += 2) {
      ctx.fillRect(i * stripeWidth, 0, stripeWidth, SIZE);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.repeat.set(1, 1);
    return tex;
  });
}

export function hexTexture(color = '#e67e22', lineColor = '#c0690080') {
  const key = `hex_${color}_${lineColor}`;
  return getCached(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    const r = SIZE / 4;
    const h = r * Math.sqrt(3) / 2;

    for (let row = -1; row < 4; row++) {
      for (let col = -1; col < 4; col++) {
        const cx = col * r * 1.5;
        const cy = row * h * 2 + (col % 2 ? h : 0);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + r * 0.9 * Math.cos(angle);
          const py = cy + r * 0.9 * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    return new THREE.CanvasTexture(canvas);
  });
}

export function noiseTexture(color = '#95a5a6', variance = 30) {
  const key = `noise_${color}_${variance}`;
  return getCached(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * variance;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    return new THREE.CanvasTexture(canvas);
  });
}

export function dotTexture(color = '#f1c40f', dotColor = '#ffffff40') {
  const key = `dot_${color}_${dotColor}`;
  return getCached(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = dotColor;
    const spacing = SIZE / 4;
    for (let x = spacing / 2; x < SIZE; x += spacing) {
      for (let y = spacing / 2; y < SIZE; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, spacing * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return new THREE.CanvasTexture(canvas);
  });
}

export function getProceduralTexture(entity) {
  const props = entity.properties || {};
  const type = entity.type;

  if (props.isIce) return null;
  if (type === 'obstacle' || type === 'collectible') return null;

  if (props.isConveyor) {
    return stripeTexture(props.color || '#e67e22');
  }

  if (props.breakable) {
    return hexTexture(props.color || '#e67e22');
  }

  if (type === 'platform' || type === 'ramp') {
    const c = props.color || '#3498db';
    const base = new THREE.Color(c);
    const dark = base.clone().multiplyScalar(0.85);
    return checkerTexture(c, '#' + dark.getHexString());
  }

  if (type === 'trigger' && props.isGoal) {
    return dotTexture(props.color || '#f1c40f');
  }

  if (type === 'decoration') {
    return noiseTexture(props.color || '#95a5a6');
  }

  return null;
}
