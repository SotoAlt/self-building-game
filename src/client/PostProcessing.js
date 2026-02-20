/**
 * PostProcessing — RenderPipeline with TSL outline, bloom, and FXAA
 *
 * 4 quality tiers with bidirectional FPS scaling:
 *   ultra:  all effects, pixelRatio 2.0, shadows 2048
 *   high:   outline + bloom + FXAA, pixelRatio 1.5, shadows 1024
 *   medium: FXAA only, pixelRatio 1.25, no shadows
 *   low:    no post-processing, pixelRatio 1.0, no shadows
 *
 * Degrade: <30fps for 3s → drop one tier
 * Recover: >55fps for 15s → raise one tier (capped by maxTier)
 */

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];

const TIER_CONFIG = {
  ultra:  { pixelRatio: 2.0,  shadowSize: 2048, outline: true,  bloom: true,  fxaa: true,  particleBudget: 20 },
  high:   { pixelRatio: 1.5,  shadowSize: 1024, outline: true,  bloom: true,  fxaa: true,  particleBudget: 15 },
  medium: { pixelRatio: 1.25, shadowSize: 0,    outline: false, bloom: false, fxaa: true,  particleBudget: 10 },
  low:    { pixelRatio: 1.0,  shadowSize: 0,    outline: false, bloom: false, fxaa: false, particleBudget: 5 },
};

let renderPipeline = null;
let outlineNode = null;
let currentTier = 'high';
let maxTier = 'ultra';
let _renderer = null;
let _scene = null;
let _camera = null;
let _directionalLight = null;

// Shared reference array for outline selectedObjects (mutated in place)
const selectedObjects = [];

// FPS tracking for bidirectional scaling
let frameCount = 0;
let fpsCheckTime = 0;
let degradeSince = 0;
let stableAbove55Since = 0;
const FPS_CHECK_INTERVAL = 1000;

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

function buildPipeline(tier) {
  const cfg = TIER_CONFIG[tier];
  const hasEffects = cfg.outline || cfg.bloom || cfg.fxaa;

  if (!hasEffects) {
    if (renderPipeline) {
      renderPipeline.dispose();
      renderPipeline = null;
    }
    outlineNode = null;
    return;
  }

  if (!renderPipeline) {
    renderPipeline = new THREE.RenderPipeline(_renderer);
  }

  // Build compositing chain: scene -> +outline -> +bloom -> fxaa
  const scenePass = pass(_scene, _camera);
  const scenePassColor = scenePass.getTextureNode('output');
  let outputNode = scenePassColor;

  if (cfg.outline) {
    outlineNode = outline(_scene, _camera, {
      selectedObjects,
      edgeThickness: 1.0,
      edgeGlow: 0.4,
    });
    const visibleColor = new THREE.Color('#5a5a8a');
    const hiddenColor = new THREE.Color('#2a2a4a');
    const { visibleEdge, hiddenEdge } = outlineNode;
    outputNode = outputNode.add(
      visibleEdge.mul(visibleColor).add(hiddenEdge.mul(hiddenColor)).mul(4.0)
    );
  } else {
    outlineNode = null;
  }

  if (cfg.bloom) {
    // bloom(input, strength, radius, threshold)
    outputNode = outputNode.add(bloom(scenePassColor, 0.25, 0.5, 0.3));
  }

  if (cfg.fxaa) {
    outputNode = fxaa(outputNode);
  }

  renderPipeline.outputNode = outputNode;
  renderPipeline.needsUpdate = true;
}

export function initPostProcessing(rendererRef, sceneRef, cameraRef, directionalLight) {
  _renderer = rendererRef;
  _scene = sceneRef;
  _camera = cameraRef;
  _directionalLight = directionalLight || null;

  currentTier = detectInitialTier();

  fpsCheckTime = performance.now();

  buildPipeline(currentTier);
  applyShadowSettings(currentTier);

  console.log(`[PostProcess] Initial quality: ${currentTier} (max: ${maxTier})`);
}

let outlineUpdateTimer = 0;
const OUTLINE_UPDATE_INTERVAL = 200;

export function updateOutlineObjects(entityMeshes, groupParents, playerMesh, remotePlayers) {
  if (!outlineNode) return;

  const now = performance.now();
  if (now - outlineUpdateTimer < OUTLINE_UPDATE_INTERVAL) return;
  outlineUpdateTimer = now;

  selectedObjects.length = 0;

  for (const mesh of entityMeshes.values()) {
    if (mesh.visible && mesh.material && !mesh.material.transparent) {
      selectedObjects.push(mesh);
    }
  }

  for (const group of groupParents.values()) {
    if (group.visible) selectedObjects.push(group);
  }

  if (playerMesh) selectedObjects.push(playerMesh);
  for (const mesh of remotePlayers.values()) {
    if (mesh.visible) selectedObjects.push(mesh);
  }
}

export function renderFrame() {
  if (!renderPipeline) {
    _renderer.render(_scene, _camera);
  } else {
    renderPipeline.render();
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
    if (degradeSince === 0) degradeSince = now;
    stableAbove55Since = 0;

    if (now - degradeSince >= 3000 && tierIdx > 0) {
      degradeSince = 0;
      applyTier(TIER_ORDER[tierIdx - 1]);
    }
  } else if (fps > 55) {
    if (stableAbove55Since === 0) stableAbove55Since = now;
    degradeSince = 0;

    const maxIdx = TIER_ORDER.indexOf(maxTier);
    if (now - stableAbove55Since >= 15000 && tierIdx < maxIdx) {
      stableAbove55Since = 0;
      applyTier(TIER_ORDER[tierIdx + 1]);
    }
  } else {
    degradeSince = 0;
    stableAbove55Since = 0;
  }
}

function applyTier(tier) {
  if (tier === currentTier) return;
  currentTier = tier;

  const cfg = TIER_CONFIG[tier];
  console.log(`[PostProcess] Quality: ${tier}`);

  buildPipeline(tier);
  _renderer.setPixelRatio(cfg.pixelRatio);
  applyShadowSettings(tier);
}

function applyShadowSettings(tier) {
  const cfg = TIER_CONFIG[tier];
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

export function getParticleBudget() {
  return TIER_CONFIG[currentTier].particleBudget;
}

export function getCurrentTier() {
  return currentTier;
}

export function setMaxTier(tier) {
  if (TIER_CONFIG[tier]) maxTier = tier;
}
