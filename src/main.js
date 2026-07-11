import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GameManager } from './GameManager.js';

const appContainer = document.getElementById('app');

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200);



const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
// Desktop/Mobile: clamp pixel ratio to 1.0 to massively reduce fill rate on integrated GPUs
renderer.setPixelRatio(1.0);
renderer.toneMapping = THREE.ReinhardToneMapping;


appContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Mobile: denser fog = shorter draw distance = fewer fragments
scene.fog = new THREE.FogExp2(0x000a40, isMobile ? 0.0025 : 0.0015);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, isMobile ? 3000 : 4000);

// Post-processing — skip bloom entirely on mobile (biggest GPU savings)
let composer = null;
let useComposer = !isMobile;

if (useComposer) {
  const renderScene = new RenderPass(scene, camera);
  // Render bloom at half-resolution to save massive GPU fill rate (visually identical)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
    1.0,  // strength — full vibrant glow
    0.3,  // radius
    0.2   // threshold — low enough for lasers/suns/explosions to bloom, but avoids dark terrain
  );
  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
}

// Game — pass isMobile so subsystems can scale down
const gameManager = new GameManager(scene, camera, isMobile);

// Resize
function triggerResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
}

let resizePending = false;
const handleResize = () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    triggerResize();
    resizePending = false;
  });
};

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => {
  handleResize();
  setTimeout(handleResize, 100);
  setTimeout(handleResize, 300);
});

// Game loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();
  gameManager.update(dt, t);
  if (useComposer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

animate();

// === UI Audio & Autoplay Policy Fix ===

// 1. Wire up the hover and click sounds to all buttons on the screen
const menuButtons = document.querySelectorAll('#btn-how-to-play, #btn-close-modal, #tab-desktop, #tab-mobile, button');

menuButtons.forEach(btn => {
  btn.addEventListener('mouseenter', () => {
    // Access the audioManager that lives inside your gameManager
    if (gameManager.audioManager) {
      gameManager.audioManager.playUIHover();
    }
  });

  btn.addEventListener('click', () => {
    if (gameManager.audioManager) {
      gameManager.audioManager.playUIClick();
    }
  });
});

// 2. The "Global Unlock" Hack
// This listens for the very first click ANYWHERE on the document.
// It instantly unlocks the AudioContext so subsequent hovers will work perfectly.
document.body.addEventListener('click', async () => {
  const am = gameManager.audioManager;
  if (am && am.ctx && am.ctx.state === 'suspended') {
    await am.ctx.resume();
  }
}, { once: true }); // { once: true } ensures this only fires exactly once