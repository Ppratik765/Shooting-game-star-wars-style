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
// Mobile: clamp pixel ratio to 1.0 to massively reduce fill rate
renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
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
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
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
let resizePending = false;
window.addEventListener('resize', () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
    resizePending = false;
  });
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
