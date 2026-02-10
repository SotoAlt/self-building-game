/**
 * PostProcessing — EffectComposer with cartoon outlines, bloom, and FXAA
 *
 * Quality tiers auto-degrade if FPS drops below 45.
 *   high:   all effects, native pixel ratio
 *   medium: bloom + outline, pixelRatio 1
 *   low:    outline only
 *   potato: no post-processing (toon materials alone)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

let composer = null;
let outlinePass = null;
let bloomPass = null;
let fxaaPass = null;
let currentTier = 'high';
let renderer = null;
let scene = null;
let camera = null;

// FPS tracking for auto-degrade
let frameCount = 0;
let fpsCheckTime = 0;
const FPS_CHECK_INTERVAL = 3000; // check every 3s

export function initPostProcessing(rendererRef, sceneRef, cameraRef) {
  renderer = rendererRef;
  scene = sceneRef;
  camera = cameraRef;

  const size = new THREE.Vector2();
  renderer.getSize(size);

  composer = new EffectComposer(renderer);

  // 1. Render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 2. Outline pass — cartoon edges
  outlinePass = new OutlinePass(size, scene, camera);
  outlinePass.edgeStrength = 4.0;
  outlinePass.edgeGlow = 0.4;
  outlinePass.edgeThickness = 1.0;
  outlinePass.visibleEdgeColor.set('#5a5a8a');
  outlinePass.hiddenEdgeColor.set('#2a2a4a');
  composer.addPass(outlinePass);

  // 3. Bloom — selective glow for emissive objects
  bloomPass = new UnrealBloomPass(size, 0.4, 0.4, 0.85);
  composer.addPass(bloomPass);

  // 4. Output pass — tone mapping
  composer.addPass(new OutputPass());

  // 5. FXAA — anti-aliasing
  fxaaPass = new ShaderPass(FXAAShader);
  const pixelRatio = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(
    1 / (size.x * pixelRatio),
    1 / (size.y * pixelRatio)
  );
  composer.addPass(fxaaPass);

  fpsCheckTime = performance.now();
  return composer;
}

let outlineUpdateTimer = 0;
const OUTLINE_UPDATE_INTERVAL = 200; // ms

export function updateOutlineObjects(entityMeshes, groupParents, playerMesh, remotePlayers) {
  if (!outlinePass) return;

  const now = performance.now();
  if (now - outlineUpdateTimer < OUTLINE_UPDATE_INTERVAL) return;
  outlineUpdateTimer = now;

  const objects = [];

  // Add all entity meshes
  for (const mesh of entityMeshes.values()) {
    if (mesh.visible && mesh.material && !mesh.material.transparent) {
      objects.push(mesh);
    }
  }

  // Add group parents
  for (const group of groupParents.values()) {
    if (group.visible) {
      objects.push(group);
    }
  }

  // Add players
  if (playerMesh) objects.push(playerMesh);
  for (const mesh of remotePlayers.values()) {
    if (mesh.visible) objects.push(mesh);
  }

  outlinePass.selectedObjects = objects;
}

export function renderFrame() {
  if (!composer || currentTier === 'potato') {
    renderer.render(scene, camera);
  } else {
    composer.render();
  }

  frameCount++;
  const now = performance.now();
  if (now - fpsCheckTime > FPS_CHECK_INTERVAL) {
    const fps = (frameCount / (now - fpsCheckTime)) * 1000;
    frameCount = 0;
    fpsCheckTime = now;
    autoAdjustQuality(fps);
  }
}

function autoAdjustQuality(fps) {
  if (fps < 30 && currentTier !== 'potato') {
    setQualityTier('potato');
  } else if (fps < 45 && currentTier === 'high') {
    setQualityTier('medium');
  } else if (fps < 45 && currentTier === 'medium') {
    setQualityTier('low');
  }
}

function setQualityTier(tier) {
  if (tier === currentTier || !composer) return;
  currentTier = tier;
  console.log(`[PostProcess] Quality: ${tier}`);

  switch (tier) {
    case 'high':
      outlinePass.enabled = true;
      bloomPass.enabled = true;
      fxaaPass.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      break;
    case 'medium':
      outlinePass.enabled = true;
      bloomPass.enabled = true;
      fxaaPass.enabled = true;
      renderer.setPixelRatio(1);
      break;
    case 'low':
      outlinePass.enabled = true;
      bloomPass.enabled = false;
      fxaaPass.enabled = false;
      renderer.setPixelRatio(1);
      break;
    case 'potato':
      outlinePass.enabled = false;
      bloomPass.enabled = false;
      fxaaPass.enabled = false;
      renderer.setPixelRatio(1);
      break;
  }
}

export function resizePostProcessing(width, height) {
  if (!composer) return;
  composer.setSize(width, height);
  if (fxaaPass) {
    const pixelRatio = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );
  }
}

