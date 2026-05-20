import * as THREE from 'three';
import { UIManager } from './UIManager.js';
import { InputController } from './InputController.js';
import { PlayerShip } from './PlayerShip.js';
import { Terrain } from './Terrain.js';
import { WeaponSystem } from './WeaponSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { EnemyManager } from './EnemyManager.js';

function createCircularGlowTexture(colorHex, coreColorHex = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Radial gradient: white-hot center to main sun color to outer orange corona/radiation glow
  const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, coreColorHex);
  grad.addColorStop(0.12, coreColorHex);
  grad.addColorStop(0.28, colorHex);
  
  if (colorHex === '#ff9900') {
    // Primary Orange Sun: blend to hot red-orange corona, then dark red corona
    grad.addColorStop(0.5, '#ff3c00');
    grad.addColorStop(0.75, 'rgba(255, 60, 0, 0.45)');
    grad.addColorStop(0.9, 'rgba(255, 0, 0, 0.15)');
  } else {
    // Secondary Blue Sun: blend to electric purple/blue corona
    grad.addColorStop(0.5, '#3300ff');
    grad.addColorStop(0.75, 'rgba(51, 0, 255, 0.45)');
    grad.addColorStop(0.9, 'rgba(128, 0, 255, 0.15)');
  }
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class GameManager {
  constructor(scene, camera) {
    this.scene  = scene;
    this.camera = camera;
    this.isDead = false;
    this.isPaused = false;

    this.state = { timeSurvived: 0, kills: 0 };

    this.uiManager        = new UIManager();
    this.inputController  = new InputController();
    this.playerShip       = new PlayerShip(this.camera);
    this.terrain          = new Terrain(this.scene);
    this.particleSystem   = new ParticleSystem(this.scene);
    this.enemyManager     = new EnemyManager(this.scene, this.particleSystem, this.playerShip);
    this.weaponSystem     = new WeaponSystem(this.scene, this.camera, this.enemyManager, this.uiManager);

    this.enemyManager.terrain = this.terrain;

    this.enemyManager.onEnemyKilled = () => {
      this.state.kills++;
      this.uiManager.addLog('TARGET DESTROYED');
    };

    this.enemyManager.onPlayerHit = () => {
      this.uiManager.triggerDamageFlash();
      this.uiManager.addLog('INCOMING FIRE — HULL DAMAGE', 'critical');
      this.playerShip.triggerShake(1.0);
    };

    const retryBtn = document.getElementById('retry-button');
    if (retryBtn) retryBtn.addEventListener('click', () => this.reset());

    // Settings & Calibration menu hookups
    const settingsBtn = document.getElementById('settings-btn');
    const settingsMenu = document.getElementById('settings-menu');
    const resumeBtn = document.getElementById('resume-button');
    const calibrateBtn = document.getElementById('calibrate-button');

    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', () => {
        this.isPaused = true;
        settingsMenu.style.display = 'flex';
      });
    }

    if (resumeBtn && settingsMenu) {
      resumeBtn.addEventListener('click', () => {
        this.isPaused = false;
        settingsMenu.style.display = 'none';
      });
    }

    if (calibrateBtn) {
      calibrateBtn.addEventListener('click', () => {
        this.inputController.calibrateGyro();
        // Visual confirmation feedback
        calibrateBtn.textContent = 'CALIBRATED!';
        calibrateBtn.style.color = '#ffb700';
        calibrateBtn.style.borderColor = '#ffb700';
        setTimeout(() => {
          calibrateBtn.textContent = 'CALIBRATE SCREEN';
          calibrateBtn.style.color = '#00ffaa';
          calibrateBtn.style.borderColor = '#00ffaa';
        }, 1500);
      });
    }

    // === Sky Group: Groups stars & suns so they move together with camera ===
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);

    // === Create starfield ===
    this._createStarfield();

    // === Create two suns ===
    this._createSuns();

    this.uiManager.addLog('ALL SYSTEMS NOMINAL', 'normal');
    this.uiManager.addLog('WEAPONS HOT — ENGAGE AT WILL', 'warning');
  }

  _createStarfield() {
    const starCount = 3000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // Random position mostly in the upper hemisphere
      // By keeping theta roughly between 0 and PI, sin(theta) is positive (Y is positive)
      const theta = -0.15 + Math.random() * (Math.PI + 0.3);
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1700 + Math.random() * 200;

      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Brighter stars: minimum threshold of 0.6 instead of 0.3
      const brightness = 0.6 + Math.random() * 0.4;
      const tint = Math.random();
      if (tint > 0.8) {
        // Slightly blue
        colors[i * 3]     = brightness * 0.8;
        colors[i * 3 + 1] = brightness * 0.9;
        colors[i * 3 + 2] = brightness;
      } else if (tint > 0.6) {
        // Slightly yellow
        colors[i * 3]     = brightness;
        colors[i * 3 + 1] = brightness * 0.95;
        colors[i * 3 + 2] = brightness * 0.7;
      } else {
        // White
        colors[i * 3]     = brightness;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness;
      }
    }

    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 3.5, // Brighter/larger star points
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: false  // constant size regardless of distance
    });

    this.starfield = new THREE.Points(starGeom, starMat);
    this.skyGroup.add(this.starfield);
  }

  _createSuns() {
    // Generate circular glow textures dynamically (orange-yellow primary, blue-cyan secondary)
    const sun1Texture = createCircularGlowTexture('#ff9900', '#ffffff');
    const sun2Texture = createCircularGlowTexture('#00ccff', '#ffffff');

    // Sun 1: warm white — main light source
    const sun1Mat = new THREE.SpriteMaterial({
      map: sun1Texture,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const sun1 = new THREE.Sprite(sun1Mat);
    sun1.position.set(800, 900, -600);
    sun1.scale.set(380, 380, 1);
    this.skyGroup.add(sun1);

    // Directional light from sun1
    const sunLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight1.position.set(800, 900, -600);
    this.skyGroup.add(sunLight1);
    this.skyGroup.add(sunLight1.target);

    // Sun 2: warm yellow — secondary
    const sun2Mat = new THREE.SpriteMaterial({
      map: sun2Texture,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const sun2 = new THREE.Sprite(sun2Mat);
    sun2.position.set(-500, 700, 800);
    sun2.scale.set(240, 240, 1);
    this.skyGroup.add(sun2);

    // Directional light from sun2
    const sunLight2 = new THREE.DirectionalLight(0xffffcc, 0.6);
    sunLight2.position.set(-500, 700, 800);
    this.skyGroup.add(sunLight2);
    this.skyGroup.add(sunLight2.target);

    // Ambient light for overall visibility
    const ambLight = new THREE.AmbientLight(0x222244, 0.5);
    this.scene.add(ambLight);
  }

  update(deltaTime, currentTime) {
    if (this.isPaused) {
      this.inputController.consumeMovement();
      this.inputController.clearDeltas();
      return;
    }

    deltaTime = Math.min(deltaTime, 0.05);

    // Consume accumulated input — cap mouse deltas before any physics
    this.inputController.consumeMovement();

    if (this.isDead) {
      this.particleSystem.update(deltaTime, this.terrain);
      return;
    }

    this.state.timeSurvived += deltaTime;

    this.playerShip.update(deltaTime, this.inputController, this.terrain);
    this.terrain.update(this.playerShip.camera.position.x, this.playerShip.camera.position.z);

    // Move skyGroup with camera so stars/suns remain at fixed "infinite" distance
    this.skyGroup.position.copy(this.playerShip.camera.position);

    this.enemyManager.update(deltaTime);
    this.weaponSystem.update(deltaTime, this.inputController, currentTime, this.playerShip.velocity);
    this.particleSystem.update(deltaTime, this.terrain);

    this.uiManager.setCrosshairTarget(this.inputController.mouse.x, this.inputController.mouse.y);
    this.uiManager.update(
      deltaTime,
      this.playerShip.getState(),
      this.state,
      this.weaponSystem.getChargeState()
    );
    this.uiManager.updateEnemyUI(this.camera, this.enemyManager.getEnemies(), this.weaponSystem.lockedEnemy);

    this.inputController.clearDeltas();

    this._checkPlayerCollisions();
    this._checkDeathConditions();
  }

  _checkPlayerCollisions() {
    const enemies   = this.enemyManager.getEnemies();
    const playerPos = this.playerShip.camera.position;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active || enemy.dying) continue;
      const dist = playerPos.distanceTo(enemy.mesh.position);
      if (dist < 12) {
        this.uiManager.triggerDamageFlash();
        this.uiManager.addLog('HULL BREACH DETECTED', 'critical');
        this.playerShip.triggerShake(2.0);
        this.playerShip.hp -= 20;
        this.enemyManager.killEnemy(enemy, false);
      }
    }
  }

  _checkDeathConditions() {
    if (this.playerShip.terrainCrashed) {
      this._triggerDeath('TERRAIN IMPACT — SHIP DESTROYED');
      return;
    }
    if (this.playerShip.hp <= 0 && !this.playerShip.isDying) {
      this.playerShip.hp = 0;
      this.uiManager.addLog('CRITICAL: HULL INTEGRITY ZERO', 'critical');
      this.uiManager.addLog('WARNING: FLIGHT SYSTEMS OFFLINE', 'critical');
      this.playerShip.die();
    }
  }

  _triggerDeath(message) {
    if (this.isDead) return;
    this.isDead = true;
    this.uiManager.addLog(message, 'critical');
    this.particleSystem.spawnGroundExplosion(this.playerShip.camera.position);
    this.particleSystem.spawnShockwave(this.playerShip.camera.position, this.terrain);
    this.uiManager.triggerDamageFlash();
    setTimeout(() => { this.uiManager.showGameOver(this.state); }, 1500);
  }

  reset() {
    this.isDead = false;
    this.state.timeSurvived = 0;
    this.state.kills = 0;
    this.playerShip.reset();
    this.enemyManager.reset();
    this.weaponSystem.reset();
    this.particleSystem.reset();
    this.uiManager.reset();
    this.uiManager.addLog('CLONE ACTIVATED — SYSTEMS ONLINE', 'normal');
  }
}
