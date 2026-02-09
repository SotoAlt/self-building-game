/**
 * SurfaceShaders — Animated ShaderMaterials for lava, water, and wind
 *
 * Each shader takes a `time` uniform updated in the animate loop.
 * All GPU-computed — no CPU overhead beyond uniform updates.
 */

import * as THREE from 'three';

const lavaVertexShader = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying float vDisplacement;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    float n = noise(pos.xz * 0.3 + time * 0.4) * 0.4;
    n += noise(pos.xz * 0.7 - time * 0.3) * 0.2;
    pos.y += n;
    vDisplacement = n;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const lavaFragmentShader = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying float vDisplacement;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 uv = vUv * 6.0;

    // Two-layer scrolling noise
    float n1 = noise(uv + time * 0.3);
    float n2 = noise(uv * 2.0 - time * 0.5);
    float combined = n1 * 0.6 + n2 * 0.4;

    // Color ramp: dark red -> orange -> bright yellow
    vec3 darkRed = vec3(0.5, 0.05, 0.0);
    vec3 orange = vec3(0.9, 0.3, 0.0);
    vec3 yellow = vec3(1.0, 0.8, 0.2);

    vec3 color = mix(darkRed, orange, smoothstep(0.2, 0.5, combined));
    color = mix(color, yellow, smoothstep(0.6, 0.85, combined));

    // Bright crack lines
    float crack = smoothstep(0.78, 0.82, combined);
    color += vec3(1.0, 0.9, 0.4) * crack * 0.8;

    // Pulsing glow
    color *= 0.9 + sin(time * 2.0) * 0.1;

    gl_FragColor = vec4(color, 0.9);
  }
`;

export function createLavaShaderMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: lavaVertexShader,
    fragmentShader: lavaFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

const waterVertexShader = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Multi-frequency sine waves
    float wave = sin(pos.x * 1.5 + time * 2.0) * 0.15;
    wave += sin(pos.z * 2.0 - time * 1.5) * 0.1;
    wave += sin((pos.x + pos.z) * 0.8 + time * 1.0) * 0.08;
    pos.y += wave;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vWorldNormal = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = /* glsl */ `
  uniform float time;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    // Fresnel: more opaque at edges
    float fresnel = pow(1.0 - max(dot(vWorldNormal, vViewDir), 0.0), 2.0);

    vec3 deepBlue = vec3(0.05, 0.15, 0.4);
    vec3 surfaceTeal = vec3(0.1, 0.5, 0.6);
    vec3 highlight = vec3(0.4, 0.8, 0.9);

    vec3 color = mix(deepBlue, surfaceTeal, vUv.y * 0.5 + 0.5);

    // Shimmer
    float shimmer = sin(vUv.x * 20.0 + time * 3.0) * sin(vUv.y * 15.0 - time * 2.0);
    color += highlight * smoothstep(0.7, 1.0, shimmer) * 0.3;

    float alpha = mix(0.6, 0.85, fresnel);

    gl_FragColor = vec4(color, alpha);
  }
`;

export function createWaterShaderMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

const windVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const windFragmentShader = /* glsl */ `
  uniform float time;
  uniform vec3 windDirection;
  varying vec2 vUv;

  void main() {
    // Scrolling dashes in wind direction
    vec2 dir = normalize(windDirection.xz);
    float projected = dot(vUv - 0.5, dir);
    float dash = sin((projected * 15.0 - time * 4.0) * 3.14159) * 0.5 + 0.5;
    dash = smoothstep(0.6, 0.8, dash);

    // Fade at edges
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x)
               * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

    vec3 color = vec3(0.6, 0.85, 1.0);
    float alpha = dash * edge * 0.15;

    gl_FragColor = vec4(color, alpha);
  }
`;

export function createWindShaderMaterial(windForce = [1, 0, 0]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector3(...windForce).normalize() },
    },
    vertexShader: windVertexShader,
    fragmentShader: windFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const shaderMaterials = [];

export function registerShaderMaterial(material) {
  shaderMaterials.push(material);
}

export function updateShaderTime(time) {
  for (const mat of shaderMaterials) {
    if (mat.uniforms?.time) {
      mat.uniforms.time.value = time;
    }
  }
}

const conveyorMaterials = [];

export function registerConveyorMaterial(material, speed, direction) {
  conveyorMaterials.push({ material, speed, direction });
}

export function updateConveyorScrolls(delta) {
  for (const entry of conveyorMaterials) {
    if (entry.material.map) {
      const dir = entry.direction || [1, 0, 0];
      entry.material.map.offset.x += dir[0] * entry.speed * delta * 0.1;
      entry.material.map.offset.y += dir[2] * entry.speed * delta * 0.1;
    }
  }
}
