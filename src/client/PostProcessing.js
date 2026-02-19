/**
 * PostProcessing — EffectComposer with cartoon outlines, bloom, and FXAA
 *
 * 4 quality tiers with bidirectional FPS scaling:
 *   ultra:  all effects, pixelRatio 2.0, shadows 2048
 *   high:   bloom + FXAA, pixelRatio 1.5, shadows 1024
 *   medium: FXAA only, pixelRatio 1.25, no shadows
 *   low:    no post-processing, pixelRatio 1.0, no shadows
 *
 * Degrade: <30fps for 3s → drop one tier
 * Recover: >55fps for 15s → raise one tier (capped by maxTier)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];

const TIER_CONFIG = {
  ultra:  { pixelRatio: 2.0,  shadowSize: 2048, outline: true,  bloom: true,  fxaa: true,  particleBudget: 20 },
  high:   { pixelRatio: 1.5,  shadowSize: 1024, outline: false, bloom: true,  fxaa: true,  particleBudget: 15 },
  medium: { pixelRatio: 1.25, shadowSize: 0,    outline: false, bloom: false, fxaa: true,  particleBudget: 10 },
  low:    { pixelRatio: 1.0,  shadowSize: 0,    outline: false, bloom: false, fxaa: false, particleBudget: 5 },
};

let composer = null;
let outlinePass = null;
let bloomPass = null;
let fxaaPass = null;
let currentTier = 'high';
let maxTier = 'ultra';
let _renderer = null;
let _scene = null;
let _camera = null;
let _directionalLight = null;

// FPS tracking for bidirectional scaling
let frameCount = 0;
let fpsCheckTime = 0;
let degradeSince = 0;   // timestamp when fps first dropped below 30
let stableAbove55Since = 0; // timestamp when fps first exceeded 55
const FPS_CHECK_INTERVAL = 1000; // measure every 1s

function detectInitialTier() {
  const cores = navigator.hardwareConcurrency || 2;
  const pixels = screen.width * screen.height;
  const mobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768;

  if (mobile) {
    maxTier = 'medium';
    return cores >= 6 ? 'medium' : 'low';
  }

  if (cores >= 8 && pixels >= 2_000_000) return 'ultra';
  if (cores >= 6) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}

export function initPostProcessing(rendererRef, sceneRef, cameraRef, directionalLight) {
  _renderer = rendererRef;
  _scene = sceneRef;
  _camera = cameraRef;
  _directionalLight = directionalLight || null;

  currentTier = detectInitialTier();

  const size = new THREE.Vector2();
  _renderer.getSize(size);

  composer = new EffectComposer(_renderer);

  // 1. Render pass
  composer.addPass(new RenderPass(_scene, _camera));

  // 2. Outline pass — cartoon edges
  outlinePass = new OutlinePass(size, _scene, _camera);
  outlinePass.edgeStrength = 4.0;
  outlinePass.edgeGlow = 0.4;
  outlinePass.edgeThickness = 1.0;
  outlinePass.visibleEdgeColor.set('#5a5a8a');
  outlinePass.hiddenEdgeColor.set('#2a2a4a');
  composer.addPass(outlinePass);

  // 3. Bloom — glow for emissive objects
  bloomPass = new UnrealBloomPass(size, 0.6, 0.5, 0.3);
  composer.addPass(bloomPass);

  // 4. Output pass — tone mapping
  composer.addPass(new OutputPass());

  // 5. FXAA — anti-aliasing
  fxaaPass = new ShaderPass(FXAAShader);
  const pixelRatio = _renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(
    1 / (size.x * pixelRatio),
    1 / (size.y * pixelRatio)
  );
  composer.addPass(fxaaPass);

  fpsCheckTime = performance.now();

  // Apply initial tier
  applyTier(currentTier);

  console.log(`[PostProcess] Initial quality: ${currentTier} (max: ${maxTier})`);
  return composer;
}

let outlineUpdateTimer = 0;
const OUTLINE_UPDATE_INTERVAL = 200; // ms

export function updateOutlineObjects(entityMeshes, groupParents, playerMesh, remotePlayers) {
  if (!outlinePass || !outlinePass.enabled) return;

  const now = performance.now();
  if (now - outlineUpdateTimer < OUTLINE_UPDATE_INTERVAL) return;
  outlineUpdateTimer = now;

  const objects = [];

  for (const mesh of entityMeshes.values()) {
    if (mesh.visible && mesh.material && !mesh.material.transparent) {
      objects.push(mesh);
    }
  }

  for (const group of groupParents.values()) {
    if (group.visible) objects.push(group);
  }

  if (playerMesh) objects.push(playerMesh);
  for (const mesh of remotePlayers.values()) {
    if (mesh.visible) objects.push(mesh);
  }

  outlinePass.selectedObjects = objects;
}

export function renderFrame() {
  const cfg = TIER_CONFIG[currentTier];
  if (!composer || (!cfg.outline && !cfg.bloom && !cfg.fxaa)) {
    _renderer.render(_scene, _camera);
  } else {
    composer.render();
  }

  frameCount++;
  const now = performance.now();
  if (now - fpsCheckTime > FPS_CHECK_INTERVAL) {
    const fps = (frameCount / (now - fpsCheckTime)) * 1000;
    frameCount = 0;
    fpsCheckTime = now;
    autoAdjustQuality(fps, now);
  }
}

function autoAdjustQuality(fps, now) {
  const tierIdx = TIER_ORDER.indexOf(currentTier);

  if (fps < 30) {
    // Start or continue degrade tracking
    if (degradeSince === 0) degradeSince = now;
    stableAbove55Since = 0;

    if (now - degradeSince >= 3000 && tierIdx > 0) {
      degradeSince = 0;
      applyTier(TIER_ORDER[tierIdx - 1]);
    }
  } else if (fps > 55) {
    // Start or continue recovery tracking
    if (stableAbove55Since === 0) stableAbove55Since = now;
    degradeSince = 0;

    const maxIdx = TIER_ORDER.indexOf(maxTier);
    if (now - stableAbove55Since >= 15000 && tierIdx < maxIdx) {
      stableAbove55Since = 0;
      applyTier(TIER_ORDER[tierIdx + 1]);
    }
  } else {
    // 30-55 fps — stable range, reset both trackers
    degradeSince = 0;
    stableAbove55Since = 0;
  }
}

function applyTier(tier) {
  if (tier === currentTier && composer) return;
  currentTier = tier;
  if (!composer) return;

  const cfg = TIER_CONFIG[tier];
  console.log(`[PostProcess] Quality: ${tier}`);

  // Pass enable/disable
  outlinePass.enabled = cfg.outline;
  bloomPass.enabled = cfg.bloom;
  fxaaPass.enabled = cfg.fxaa;

  // Pixel ratio
  _renderer.setPixelRatio(cfg.pixelRatio);

  // Shadow control
  if (_directionalLight) {
    if (cfg.shadowSize > 0) {
      _directionalLight.castShadow = true;
      if (_directionalLight.shadow.mapSize.width !== cfg.shadowSize) {
        _directionalLight.shadow.mapSize.width = cfg.shadowSize;
        _directionalLight.shadow.mapSize.height = cfg.shadowSize;
        if (_directionalLight.shadow.map) {
          _directionalLight.shadow.map.dispose();
          _directionalLight.shadow.map = null;
        }
      }
    } else {
      _directionalLight.castShadow = false;
    }
  }
}

export function resizePostProcessing(width, height) {
  if (!composer) return;
  composer.setSize(width, height);
  if (fxaaPass) {
    const pixelRatio = _renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );
  }
}

export function getParticleBudget() {
  return TIER_CONFIG[currentTier].particleBudget;
}

export function getCurrentTier() {
  return currentTier;
}

export function setMaxTier(tier) {
  if (TIER_CONFIG[tier]) maxTier = tier;
}
