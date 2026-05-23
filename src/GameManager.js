import * as THREE from 'three';
import { UIManager } from './UIManager.js';
import { InputController } from './InputController.js';
import { PlayerShip } from './PlayerShip.js';
import { Terrain } from './Terrain.js';
import { WeaponSystem } from './WeaponSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { EnemyManager } from './EnemyManager.js';
import { AudioManager } from './AudioManager.js';
import { SpeedLines } from './SpeedLines.js';

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
  constructor(scene, camera, isMobile = false) {
    this.scene = scene;
    this.camera = camera;
    this.isDead = false;
    this.isPaused = false;
    this.isStarted = false;
    this.isMobile = isMobile;

    this.state = { timeSurvived: 0, kills: 0 };

    // New state variables for polish upgrades
    this.killsSinceLastDamage = 0;
    this.nextSolarFlareTime = 45;
    this.radarJammedTimer = 0;
    this.solarFlareActive = false;
    this.lightningFlashTimer = 0;
    this.nextLightningTime = 180 + 10 + Math.random() * 15;

    this.introCinematicTimer = 0.0;
    this.introFinished = true;
    this.introStartPos = new THREE.Vector3();
    this.introStartYaw = 0;

    // Death sequence state
    this.deathSequenceState = 'none';
    this.deathSequenceTimer = 0;
    this.ejectPod = null;
    this.ejectPodVelocity = new THREE.Vector3();
    this.xwingMesh = null;
    this.xwingVelocity = new THREE.Vector3();
    this.xwingRotVel = new THREE.Vector3();
    this.xwingExploded = false;
    this.timeSinceExplosion = 0;

    this.killCamEndTime = 0;
    this.killCamExplosionPos = null;

    this.uiManager = new UIManager();
    this.inputController = new InputController();
    this.playerShip = new PlayerShip(this.camera);

    this.introStartPos.copy(this.camera.position);
    this.introStartYaw = this.playerShip.yaw;

    this.terrain = new Terrain(this.scene, isMobile);
    this.particleSystem = new ParticleSystem(this.scene, isMobile);
    this.enemyManager = new EnemyManager(this.scene, this.particleSystem, this.playerShip, isMobile);
    this.audioManager = new AudioManager();
    this.weaponSystem = new WeaponSystem(this.scene, this.camera, this.enemyManager, this.uiManager, isMobile, this.audioManager);
    this.speedLines = new SpeedLines(this.camera, isMobile ? 30 : 70);

    this.enemyManager.terrain = this.terrain;

    this.enemyManager.onEnemyKilled = () => {
      this.state.kills++;
      this.killsSinceLastDamage++;
      this.uiManager.addLog('TARGET DESTROYED');

      // Streak check
      let streakName = '';
      let color = '';
      if (this.killsSinceLastDamage === 3) {
        streakName = 'TRIPLE THREAT';
        color = '#00ffaa';
      } else if (this.killsSinceLastDamage === 5) {
        streakName = 'UNTOUCHABLE';
        color = '#ffaa00';
      } else if (this.killsSinceLastDamage === 10) {
        streakName = 'GODLIKE';
        color = '#ff0000';
      }

      if (streakName) {
        const banner = document.getElementById('killstreak-banner');
        if (banner) {
          banner.innerText = streakName;
          banner.style.color = color;
          banner.className = 'active';
          void banner.offsetWidth; // trigger layout reflow
        }

        setTimeout(() => {
          const streakMessages = [
            `▸ INTERCEPT: "This pilot is... request reinforcements!"`,
            `▸ INTERCEPT: "We need backup! Immediately!"`,
            `▸ INTERCEPT: "Defensive maneuvers! He's picking us apart!"`
          ];
          const msg = streakMessages[Math.floor(Math.random() * streakMessages.length)];
          this.uiManager.addLog(msg, 'intercept');
        }, 600);
      }

      // 60% chance of enemy radio comms chatter on kill
      if (Math.random() < 0.6) {
        setTimeout(() => {
          const killMessages = [
            `▸ INTERCEPT: "He got Viper-3! Break formation—"`,
            `▸ INTERCEPT: "—signal lost—"`,
            `▸ INTERCEPT: "Viper-2 is down! I repeat, Viper-2 is down!"`,
            `▸ INTERCEPT: "Target is too fast! Break off!"`,
            `▸ INTERCEPT: "Lost contact with wingman!"`
          ];
          const msg = killMessages[Math.floor(Math.random() * killMessages.length)];
          this.uiManager.addLog(msg, 'intercept');
        }, 400);
      }
    };

    this.enemyManager.onEnemyCrashed = (position) => {
      this.audioManager.playExplosion(position);

      // Slow-motion kill cam flash
      const toExplosion = position.clone().sub(this.camera.position).normalize();
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      if (camDir.dot(toExplosion) > 0.62) { // enemy explosion in FOV
        this.killCamEndTime = performance.now() + 50; // slow-mo for 50ms
        this.killCamExplosionPos = position.clone();
      }
    };

    this.enemyManager.onPlayerHit = () => {
      this.uiManager.triggerDamageFlash();

      // Trigger chromatic aberration via CSS class on main container
      const appDiv = document.getElementById('app');
      if (appDiv) {
        appDiv.classList.add('chroma-active');
        setTimeout(() => appDiv.classList.remove('chroma-active'), 500);
      }

      this.uiManager.addLog('INCOMING FIRE — HULL DAMAGE', 'critical');
      this.playerShip.triggerShake(1.0);
      this.audioManager.playGrunt();
      this.killsSinceLastDamage = 0; // Reset streak
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

    // Build player wireframe meshes for eject sequence
    this.xwingMesh = this._buildWireframeXWing();
    this.ejectPod = this._buildEscapePod();

    // Hook up enemy repositioning chatter callback
    this.enemyManager.onEnemyRetreat = () => {
      const retreatMessages = [
        `▸ INTERCEPT: "Negative lock — repositioning"`,
        `▸ INTERCEPT: "Pulling back for another run"`,
        `▸ INTERCEPT: "Hostile outmaneuvered, breaking off"`
      ];
      const msg = retreatMessages[Math.floor(Math.random() * retreatMessages.length)];
      this.uiManager.addLog(msg, 'intercept');
    };

    // Start Screen Setup
    const btnLetsPlay = document.getElementById('btn-lets-play');
    const btnHowToPlay = document.getElementById('btn-how-to-play');
    const startTitle = document.querySelector('.start-title');

    // Keep controls fully visible immediately
    if (btnLetsPlay) btnLetsPlay.style.opacity = '1';
    if (btnHowToPlay) btnHowToPlay.style.opacity = '1';
    if (startTitle) startTitle.style.opacity = '1';

    if (btnLetsPlay) {
      btnLetsPlay.addEventListener('mouseenter', () => this.audioManager.playUIHover());
      btnLetsPlay.addEventListener('click', () => {
        this.audioManager.playUIClick();
        this.isStarted = true;
        this.uiManager.startGame();
        this.state.timeSurvived = 0; // reset clock

        // Direct fullscreen request on mobile click gesture (highly compliant & reliable)
        if (this.isMobile) {
          const docEl = document.documentElement;
          const isCurrentlyFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
          if (!isCurrentlyFullscreen) {
            const requestFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
            if (requestFS) {
              requestFS.call(docEl).catch(() => {
                // Ignore failure
              });
            }
          }
        }

        // Resume audio context (browser autoplay policy requires user gesture)
        this.audioManager.resume();
      });
    }

    if (btnHowToPlay) {
      btnHowToPlay.addEventListener('mouseenter', () => this.audioManager.playUIHover());
      btnHowToPlay.addEventListener('click', () => {
        this.audioManager.playUIClick();
      });
    }

    this.introFighters = null;

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
    const starCount = this.isMobile ? 600 : 1600;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    const minR = this.isMobile ? 2500 : 2900;
    const maxR = this.isMobile ? 2800 : 3300;

    for (let i = 0; i < starCount; i++) {
      // Random position mostly in the upper hemisphere
      // By keeping theta roughly between 0 and PI, sin(theta) is positive (Y is positive)
      const theta = -0.15 + Math.random() * (Math.PI + 0.3);
      const phi = Math.acos(2 * Math.random() - 1);
      const r = minR + Math.random() * (maxR - minR);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Softer stars: brightness threshold of 0.35 to 0.8
      const brightness = 0.35 + Math.random() * 0.45;
      const tint = Math.random();
      if (tint > 0.8) {
        // Slightly blue
        colors[i * 3] = brightness * 0.8;
        colors[i * 3 + 1] = brightness * 0.9;
        colors[i * 3 + 2] = brightness;
      } else if (tint > 0.6) {
        // Slightly yellow
        colors[i * 3] = brightness;
        colors[i * 3 + 1] = brightness * 0.95;
        colors[i * 3 + 2] = brightness * 0.7;
      } else {
        // White
        colors[i * 3] = brightness;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness;
      }
    }

    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 2.3, // Smaller star points
      vertexColors: true,
      transparent: true,
      opacity: 0.8, // Softer background blending
      sizeAttenuation: false,  // constant size regardless of distance
      fog: false
    });

    this.starfield = new THREE.Points(starGeom, starMat);
    this.skyGroup.add(this.starfield);
  }

  _createSuns() {
    // Generate circular glow textures dynamically (orange-yellow primary, blue-cyan secondary)
    const sun1Texture = createCircularGlowTexture('#ff9900', '#ffffff');
    const sun2Texture = createCircularGlowTexture('#00ccff', '#ffffff');

    const skyScale = this.isMobile ? 2.1 : 2.6;

    // Sun 1: warm white — main light source
    const sun1Mat = new THREE.SpriteMaterial({
      map: sun1Texture,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const sun1 = new THREE.Sprite(sun1Mat);
    sun1.position.set(800 * skyScale, 900 * skyScale, -600 * skyScale);
    sun1.scale.set(380 * skyScale, 380 * skyScale, 1);
    this.skyGroup.add(sun1);

    // Directional light from sun1
    const sunLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight1.position.set(800 * skyScale, 900 * skyScale, -600 * skyScale);
    this.skyGroup.add(sunLight1);
    this.skyGroup.add(sunLight1.target);

    // Sun 2: warm yellow — secondary
    const sun2Mat = new THREE.SpriteMaterial({
      map: sun2Texture,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    const sun2 = new THREE.Sprite(sun2Mat);
    sun2.position.set(-500 * skyScale, 700 * skyScale, 800 * skyScale);
    sun2.scale.set(240 * skyScale, 240 * skyScale, 1);
    this.skyGroup.add(sun2);

    // Directional light from sun2
    const sunLight2 = new THREE.DirectionalLight(0xffffcc, 0.6);
    sunLight2.position.set(-500 * skyScale, 700 * skyScale, 800 * skyScale);
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

    // Eject death animation sequence takes over completely if player is dead
    if (this.isDead) {
      this._updateDeathSequence(deltaTime);
      return;
    }

    // 1. Slow-motion Hit-Stop / "Kill Cam" check
    const now = performance.now();
    let isSlowMo = false;
    let actualDelta = deltaTime;
    if (now < this.killCamEndTime) {
      actualDelta = deltaTime * 0.15; // 15% game speed
      isSlowMo = true;
    }

    // Consume accumulated input — cap mouse deltas before any physics
    this.inputController.consumeMovement();

    // 2. Automated Intro Cinematic sequence
    if (!this.isStarted) {
      if (this.introCinematicTimer > 0) {
        this.introCinematicTimer -= deltaTime;

        // Automated flythrough camera path
        const progress = 5.0 - this.introCinematicTimer;
        this.camera.position.x = this.introStartPos.x + progress * 160;
        this.camera.position.z = this.introStartPos.z - progress * 140;

        const terrainHeight = this.terrain.getHeightAt(this.camera.position.x, this.camera.position.z);
        this.camera.position.y = terrainHeight + 80 + Math.sin(progress * Math.PI / 2.5) * 35;

        // Pan camera panning around
        this.playerShip.yaw = this.introStartYaw + Math.sin(progress * 1.2) * 0.22;
        this.playerShip.pitch = -0.06 + Math.sin(progress * 1.8) * 0.05;
        this.playerShip.roll = Math.cos(progress * 1.5) * 0.12;

        // Patrolling TIE fighters fly relative to cinematic camera
        if (this.introFighters) {
          this.introFighters.position.copy(this.camera.position);
          this.introFighters.quaternion.copy(this.camera.quaternion);
          this.introFighters.translateZ(-145 + progress * 35);
          this.introFighters.translateX(Math.sin(progress * 1.5) * 55 - 20);
          this.introFighters.translateY(Math.cos(progress * 1.5) * 12);
        }

        if (this.introCinematicTimer <= 0) {
          this._finishIntro();
        }
      }

      this.playerShip.update(deltaTime, this.inputController, this.terrain, true); // true = isIntro
      this.terrain.update(this.playerShip.camera.position.x, this.playerShip.camera.position.z);
      this.skyGroup.position.copy(this.playerShip.camera.position);
      this.inputController.clearDeltas();
      return;
    }

    this.state.timeSurvived += actualDelta;

    // 3. Solar Flare Weather Event
    if (this.state.timeSurvived > this.nextSolarFlareTime) {
      this.radarJammedTimer = 10.0;
      this.nextSolarFlareTime = this.state.timeSurvived + 45;

      // Flash full screen white overlay
      const flareOverlay = document.getElementById('solar-flare-overlay');
      if (flareOverlay) {
        flareOverlay.classList.add('active');
        setTimeout(() => flareOverlay.classList.remove('active'), 300);
      }

      this.uiManager.addLog('WARNING: SOLAR FLARE INTERCEPTED', 'critical');
      this.uiManager.addLog('RADAR JAMMED — TACTICAL STATIC DETECTED', 'warning');
    }

    if (this.radarJammedTimer > 0) {
      this.radarJammedTimer -= actualDelta;
    }

    // 4. Dynamic Skybox Progression & Lightning Flashes
    const time = this.state.timeSurvived;
    const colorBlue = new THREE.Color(0x000a40);
    const colorOrange = new THREE.Color(0x381000);
    const colorRed = new THREE.Color(0x2a0000);
    const currentSkyColor = new THREE.Color();

    if (time < 90) {
      currentSkyColor.copy(colorBlue);
    } else if (time < 180) {
      const u = (time - 90) / 90;
      currentSkyColor.lerpColors(colorBlue, colorOrange, u);
    } else {
      const u = Math.min(1.0, (time - 180) / 90);
      currentSkyColor.lerpColors(colorOrange, colorRed, u);

      // Trigger storm lightning
      if (time > this.nextLightningTime) {
        this.lightningFlashTimer = 0.15;
        this.nextLightningTime = time + 8 + Math.random() * 12;
      }
    }

    if (this.lightningFlashTimer > 0) {
      this.lightningFlashTimer -= actualDelta;
    }

    // 5. Update game entities (applying slow-mo actualDelta)
    this.playerShip.update(actualDelta, this.inputController, this.terrain, false);
    this.terrain.update(this.playerShip.camera.position.x, this.playerShip.camera.position.z);
    this.skyGroup.position.copy(this.playerShip.camera.position);

    this.enemyManager.update(actualDelta);
    this.weaponSystem.update(actualDelta, this.inputController, currentTime, this.playerShip.velocity);
    this.particleSystem.update(actualDelta, this.terrain);
    this.speedLines.update(actualDelta, this.playerShip.isBoosting);

    // Slow-mo zoom in feature removed

    // Audio updates
    const shipState = this.playerShip.getState();
    this.audioManager.updateListener(this.playerShip.camera.position, this.playerShip.camera.quaternion);
    this.audioManager.updateEngine(this.playerShip.throttle, shipState.speed);
    this.audioManager.updateBoost(this.playerShip.isBoosting);
    this.audioManager.updateWarning(shipState.terrainWarning || shipState.isStalled);
    this.audioManager.updateFlyby(actualDelta, this.enemyManager.getEnemies(), this.playerShip.camera.position);

    // UI Updates
    this.uiManager.setCrosshairTarget(this.inputController.mouse.x, this.inputController.mouse.y);
    this.uiManager.update(
      actualDelta,
      this.playerShip.getState(),
      this.state,
      this.weaponSystem.getChargeState(),
      this.camera,
      this.radarJammedTimer > 0
    );
    this.uiManager.updateEnemyUI(this.camera, this.enemyManager.getEnemies(), this.weaponSystem.lockedEnemy);

    this.inputController.clearDeltas();

    this._checkPlayerCollisions();
    this._checkDeathConditions();
  }

  _checkPlayerCollisions() {
    const enemies = this.enemyManager.getEnemies();
    const playerPos = this.playerShip.camera.position;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active || enemy.dying) continue;
      const dist = playerPos.distanceTo(enemy.mesh.position);
      if (dist < 12) {
        this.uiManager.triggerDamageFlash();

        // Trigger chromatic aberration via CSS class on main container
        const appDiv = document.getElementById('app');
        if (appDiv) {
          appDiv.classList.add('chroma-active');
          setTimeout(() => appDiv.classList.remove('chroma-active'), 500);
        }

        this.uiManager.addLog('HULL BREACH DETECTED', 'critical');
        this.playerShip.triggerShake(2.0);
        this.playerShip.hp -= 20;
        this.enemyManager.killEnemy(enemy, false);
        this.killsSinceLastDamage = 0; // Reset streak
      }
    }
  }

  _checkDeathConditions() {
    if (this.playerShip.terrainCrashed) {
      this._startDeathSequence('TERRAIN IMPACT — SHIP DESTROYED');
      return;
    }
    if (this.playerShip.hp <= 0 && this.deathSequenceState === 'none') {
      this.playerShip.hp = 0;
      this.uiManager.addLog('CRITICAL: HULL INTEGRITY ZERO', 'critical');
      this.uiManager.addLog('WARNING: FLIGHT SYSTEMS OFFLINE', 'critical');
      this._startDeathSequence('SHIP CRITICAL DAMAGE — EJECT EJECT');
    }
  }

  _startDeathSequence(message) {
    if (this.deathSequenceState !== 'none') return;
    this.isDead = true;
    this.deathSequenceState = 'ejecting';
    this.deathSequenceTimer = 0;
    this.xwingExploded = false;

    this.uiManager.addLog(message, 'critical');
    this.uiManager.triggerDamageFlash();

    this.killsSinceLastDamage = 0;

    // Position blue wireframe X-Wing at camera cockpit
    this.xwingMesh.position.copy(this.camera.position);
    this.xwingMesh.quaternion.copy(this.camera.quaternion);
    this.xwingMesh.visible = true;

    // Position escape pod
    this.ejectPod.position.copy(this.camera.position);
    this.ejectPod.visible = true;

    // Pod ejects upward & slightly back relative to orientation — slowed down
    const localEjectDir = new THREE.Vector3(0, 75, 25);
    this.ejectPodVelocity.copy(localEjectDir).applyQuaternion(this.camera.quaternion);

    // Ship tumbles forward tumbles — inherits 100% forward velocity
    this.xwingVelocity.copy(this.playerShip.velocity);
    this.xwingRotVel.set(
      (Math.random() - 0.5) * 2.5,
      1.0 + Math.random() * 1.5,
      (Math.random() - 0.5) * 2.0
    );

    // Stop flight audio and play explosion
    this.audioManager.stopAll();
    this.audioManager.playExplosion(this.camera.position);
  }

  _updateDeathSequence(deltaTime) {
    this.deathSequenceTimer += deltaTime;

    // 1. Fall & tumble X-wing — slowed down
    if (this.xwingMesh && !this.xwingExploded) {
      this.xwingVelocity.y -= 120 * deltaTime; // gravity reduced
      this.xwingMesh.position.addScaledVector(this.xwingVelocity, deltaTime);

      this.xwingMesh.rotation.x += this.xwingRotVel.x * deltaTime;
      this.xwingMesh.rotation.y += this.xwingRotVel.y * deltaTime;
      this.xwingMesh.rotation.z += this.xwingRotVel.z * deltaTime;

      // Spawn burning sparks behind cockpit
      const offset = new THREE.Vector3(0, 0, 4).applyQuaternion(this.xwingMesh.quaternion);
      const smokePos = this.xwingMesh.position.clone().add(offset);
      for (let i = 0; i < 2; i++) {
        const p = this.particleSystem._getFree();
        if (p) {
          p.active = true;
          p.position.copy(smokePos);
          p.velocity.set(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
          );
          p.age = 0;
          p.life = 0.4 + Math.random() * 0.5;
          p.color.setHex(Math.random() > 0.5 ? 0xff3c00 : 0x777777);
        }
      }

      // Check crash against terrain
      const terrainH = this.terrain.getHeightAt(this.xwingMesh.position.x, this.xwingMesh.position.z);
      if (this.xwingMesh.position.y <= terrainH + 4) {
        this.xwingMesh.position.y = terrainH;
        this.xwingExploded = true;
        this.deathSequenceState = 'xwing_exploding';

        // Major ground explosion and shockwave
        this.particleSystem.spawnGroundExplosion(this.xwingMesh.position);
        this.particleSystem.spawnShockwave(this.xwingMesh.position, this.terrain);
        this.audioManager.playExplosion(this.xwingMesh.position);

        this.xwingMesh.visible = false;
      }
    }

    // 2. Eject escape pod — gravity & particles slowed down
    if (this.ejectPod) {
      this.ejectPodVelocity.y -= 15 * deltaTime; // gravity reduced
      this.ejectPod.position.addScaledVector(this.ejectPodVelocity, deltaTime);

      // Ejection trail particles — slowed down
      for (let i = 0; i < 3; i++) {
        const p = this.particleSystem._getFree();
        if (p) {
          p.active = true;
          p.position.copy(this.ejectPod.position);
          p.velocity.set(
            (Math.random() - 0.5) * 10,
            -45 - Math.random() * 20,
            (Math.random() - 0.5) * 10
          ).applyQuaternion(this.ejectPod.quaternion);
          p.age = 0;
          p.life = 0.4 + Math.random() * 0.4;
          p.color.setHex(0x00ffaa); // cyan sparks
        }
      }
    }

    // 3. Camera tracks escape pod and looks at X-wing
    if (this.ejectPod) {
      const offset = new THREE.Vector3(0, 15, 30).applyQuaternion(this.ejectPod.quaternion);
      this.camera.position.copy(this.ejectPod.position).add(offset);

      if (!this.xwingExploded && this.xwingMesh) {
        this.camera.lookAt(this.xwingMesh.position);
      } else {
        const site = this.xwingMesh ? this.xwingMesh.position : this.ejectPod.position;
        this.camera.lookAt(site);
      }
    }

    this.terrain.update(this.camera.position.x, this.camera.position.z);
    this.skyGroup.position.copy(this.camera.position);

    this.particleSystem.update(deltaTime, this.terrain);

    // Update active laser projectiles so they continue moving after death
    const mockInput = { isFiring: () => false };
    this.weaponSystem.update(deltaTime, mockInput, performance.now() / 1000, new THREE.Vector3());

    if (this.xwingExploded) {
      this.timeSinceExplosion += deltaTime;
    }

    // Delay game over screen display — exactly 1.0 seconds after the X-wing explodes on the ground
    if (this.xwingExploded && this.timeSinceExplosion > 1.0) {
      this.uiManager.showGameOver(this.state);
      this.deathSequenceState = 'gameover';
    }
  }

  _finishIntro() {
    if (this.introFinished) return;
    this.introFinished = true;
    this.introCinematicTimer = 0;

    const btnLetsPlay = document.getElementById('btn-lets-play');
    const btnHowToPlay = document.getElementById('btn-how-to-play');
    const startTitle = document.querySelector('.start-title');

    if (btnLetsPlay) btnLetsPlay.style.opacity = '1';
    if (btnHowToPlay) btnHowToPlay.style.opacity = '1';
    if (startTitle) startTitle.style.opacity = '1';

    if (this.introFighters) {
      this.scene.remove(this.introFighters);
      this.introFighters = null;
    }

    // Snaps camera back to base height/pitch
    this.camera.position.set(this.introStartPos.x, 350, this.introStartPos.z - 700);
    this.playerShip.pitch = 0;
    this.playerShip.yaw = this.introStartYaw;
    this.playerShip.roll = 0;
  }

  _buildWireframeXWing() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });

    const bodyGeom = new THREE.CylinderGeometry(1.2, 0.4, 18, 6);
    bodyGeom.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeom, mat);
    group.add(body);

    const wingGeom = new THREE.BoxGeometry(10, 0.2, 3);

    const wl1 = new THREE.Mesh(wingGeom, mat);
    wl1.position.set(-5, 2.5, -1);
    wl1.rotation.z = 0.25; wl1.rotation.y = -0.15;

    const wr1 = new THREE.Mesh(wingGeom, mat);
    wr1.position.set(5, 2.5, -1);
    wr1.rotation.z = -0.25; wr1.rotation.y = 0.15;

    const wl2 = new THREE.Mesh(wingGeom, mat);
    wl2.position.set(-5, -2.5, -1);
    wl2.rotation.z = -0.25; wl2.rotation.y = -0.15;

    const wr2 = new THREE.Mesh(wingGeom, mat);
    wr2.position.set(5, -2.5, -1);
    wr2.rotation.z = 0.25; wr2.rotation.y = 0.15;

    group.add(wl1, wr1, wl2, wr2);

    const gunGeom = new THREE.CylinderGeometry(0.15, 0.15, 6, 4);
    gunGeom.rotateX(Math.PI / 2);

    const gunPos = [
      [-10, 3.5, -1], [10, 3.5, -1],
      [-10, -3.5, -1], [10, -3.5, -1]
    ];
    gunPos.forEach(pos => {
      const gun = new THREE.Mesh(gunGeom, mat);
      gun.position.set(pos[0], pos[1], pos[2]);
      group.add(gun);
    });

    const engGeom = new THREE.CylinderGeometry(0.8, 0.8, 4, 6);
    engGeom.rotateX(Math.PI / 2);
    const eng = new THREE.Mesh(engGeom, mat);
    eng.position.set(0, 0, -8);
    group.add(eng);

    group.scale.set(1.5, 1.5, 1.5);
    group.visible = false;
    this.scene.add(group);
    return group;
  }

  _buildEscapePod() {
    const geom = new THREE.SphereGeometry(1.2, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      wireframe: true,
      transparent: true,
      opacity: 0.9
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  reset() {
    this.isDead = false;
    this.state.timeSurvived = 0;
    this.state.kills = 0;
    this.killsSinceLastDamage = 0;
    this.nextSolarFlareTime = 45;
    this.radarJammedTimer = 0;
    this.solarFlareActive = false;
    this.lightningFlashTimer = 0;
    this.killCamEndTime = 0;
    this.killCamExplosionPos = null;

    this.deathSequenceState = 'none';
    this.deathSequenceTimer = 0;
    this.xwingExploded = false;
    this.timeSinceExplosion = 0;
    if (this.xwingMesh) this.xwingMesh.visible = false;
    if (this.ejectPod) this.ejectPod.visible = false;

    this.playerShip.reset();
    this.enemyManager.reset();
    this.weaponSystem.reset();
    this.particleSystem.reset();
    if (this.speedLines) this.speedLines.opacity = 0;
    this.audioManager.reset();
    this.uiManager.reset();
    this.uiManager.addLog('CLONE ACTIVATED — SYSTEMS ONLINE', 'normal');
  }
}
