import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GameManager } from './GameManager.js';

const appContainer = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ReinhardToneMapping;
appContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000a40, 0.0015);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);

// Post-processing
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.0,  // strength (reduced from 2.0)
  0.3,  // radius (reduced from 0.4)
  0.15  // threshold
);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Game
const gameManager = new GameManager(scene, camera);

// Resize
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// Game loop — fixed timestep accumulator for stable 60fps
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  // Cap delta to prevent spiral-of-death & massive jumps after tab switch
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();
  gameManager.update(dt, t);
  composer.render();
}

animate();
