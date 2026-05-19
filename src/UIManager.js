import * as THREE from 'three';

export class UIManager {
  constructor() {
    this.crosshair = document.getElementById('crosshair');
    this.compassStrip = document.getElementById('compass-strip');
    this.staminaFill = document.getElementById('stamina-bar-fill');
    this.healthFill = document.getElementById('health-bar-fill');
    this.chargeFill = document.getElementById('charge-bar-fill');
    this.damageFlash = document.getElementById('damage-flash');
    this.activityFeed = document.getElementById('activity-feed');
    this.statTime = document.getElementById('stat-time');
    this.statKills = document.getElementById('stat-kills');
    this.statThreat = document.getElementById('stat-threat');
    this.statAlt = document.getElementById('stat-alt');
    this.enemyUiLayer = document.getElementById('enemy-ui-layer');
    this.targetLock = document.getElementById('target-lock');
    this.radarBlips = document.getElementById('radar-blips');
    this.boostVignette = document.getElementById('boost-vignette');
    this.altWarning = document.getElementById('altitude-warning');

    // Warnings
    this.stallWarning = document.getElementById('stall-warning');
    this.terrainWarning = document.getElementById('terrain-warning');
    this.noChargeWarning = document.getElementById('no-charge-warning');

    // Game Over
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.goTime = document.getElementById('go-time');
    this.goKills = document.getElementById('go-kills');

    // Crosshair lerping
    this.targetCrosshairPos = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    this.currentCrosshairPos = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);

    this.hpBars = {};

    window.addEventListener('resize', () => {
      this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
      this.currentCrosshairPos.copy(this.targetCrosshairPos);
    });
  }

  update(deltaTime, playerState, gameState, chargeState) {
    // Crosshair lerp
    this.currentCrosshairPos.lerp(this.targetCrosshairPos, 0.12);
    const dx = this.currentCrosshairPos.x - window.innerWidth / 2;
    const dy = this.currentCrosshairPos.y - window.innerHeight / 2;
    this.crosshair.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;

    // Compass — strip has 3 repetitions of 8 headings
    // One full revolution of headings ≈ 390px of text width
    // Center offset: the middle "N" in the strip is roughly at the center
    const pxPerRev = 390;
    const centerOffset = -pxPerRev; // Start centered on middle repetition
    const yawOffset = (playerState.yaw / (Math.PI * 2)) * pxPerRev;
    this.compassStrip.style.transform = `translateX(${centerOffset + yawOffset}px)`;

    // Meters
    this.staminaFill.style.width = `${(playerState.stamina / playerState.maxStamina) * 100}%`;
    this.healthFill.style.width = `${Math.max(0, (playerState.hp / playerState.maxHp) * 100)}%`;

    // Boost vignette
    if (this.boostVignette) {
      if (playerState.isBoosting) {
          this.boostVignette.classList.add('active');
      } else {
          this.boostVignette.classList.remove('active');
      }
    }

    // Altitude warning
    if (this.altWarning) {
      if (playerState.isAboveMaxAlt) {
          this.altWarning.classList.add('active');
      } else {
          this.altWarning.classList.remove('active');
      }
    }

    // Health bar color change when low
    if (playerState.hp < playerState.maxHp * 0.3) {
      this.healthFill.style.background = '#ff0000';
      this.healthFill.style.boxShadow = '0 0 8px #ff0000';
    } else {
      this.healthFill.style.background = '#00ffaa';
      this.healthFill.style.boxShadow = '0 0 8px #00ffaa';
    }

    // Charge bar
    if (chargeState) {
      this.chargeFill.style.width = `${(chargeState.charge / chargeState.maxCharge) * 100}%`;
      // Warning
      this._toggleWarning(this.noChargeWarning, chargeState.chargeDepleted);
    }

    // Stats
    this.statTime.innerText = this._formatTime(gameState.timeSurvived);
    this.statKills.innerText = gameState.kills;
    this.statAlt.innerText = Math.floor(playerState.altitude);

    // Threat level
    let threat = 'LOW';
    if (gameState.kills > 30) threat = 'CRITICAL';
    else if (gameState.kills > 15) threat = 'HIGH';
    else if (gameState.kills > 5) threat = 'MEDIUM';
    this.statThreat.innerText = threat;

    // Warnings
    this._toggleWarning(this.stallWarning, playerState.isStalled);
    this._toggleWarning(this.terrainWarning, playerState.terrainWarning && !playerState.isStalled);
  }

  updateEnemyUI(camera, enemies, lockedEnemy) {
    const hw = window.innerWidth / 2;
    const hh = window.innerHeight / 2;
    
    // Clear radar blips this frame
    this.radarBlips.innerHTML = '';
    const radarRadius = 85; // 180px container / 2 - padding
    const radarScale = 0.08; // How far 1 world unit is on radar

    // Get camera forward and right vectors for relative radar
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    const camRight = new THREE.Vector3(camDir.z, 0, -camDir.x);

    let isLockedEnemyVisible = false;

    for (const enemy of enemies) {
      if (enemy.active) {
        // --- 1. HP Bars ---
        const pos = enemy.mesh.position.clone().project(camera);
        if (pos.z < 1 && pos.z > 0) {
          if (!this.hpBars[enemy.id]) {
            const div = document.createElement('div');
            div.className = 'enemy-hp-container';
            const fill = document.createElement('div');
            fill.className = 'enemy-hp-fill';
            div.appendChild(fill);
            this.enemyUiLayer.appendChild(div);
            this.hpBars[enemy.id] = { div, fill };
          }
          const bar = this.hpBars[enemy.id];
          const px = (pos.x * hw) + hw;
          const py = -(pos.y * hh) + hh;
          bar.div.style.left = `${px}px`;
          bar.div.style.top = `${py - 30}px`;
          bar.fill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
          bar.div.style.display = 'block';

          // Lock bracket snapping
          if (enemy === lockedEnemy) {
            isLockedEnemyVisible = true;
            this.targetLock.style.left = `${px}px`;
            this.targetLock.style.top = `${py}px`;
            this.targetLock.classList.add('active');
          }
        } else if (this.hpBars[enemy.id]) {
          this.hpBars[enemy.id].div.style.display = 'none';
        }

        // --- 2. Radar Blips ---
        const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, camera.position);
        toEnemy.y = 0; // Flat radar
        
        // Project onto forward/right vectors
        const distFwd = toEnemy.dot(camDir);
        const distRight = toEnemy.dot(camRight);

        // Scale distance
        let rX = distRight * radarScale;
        let rY = -distFwd * radarScale; // Negative because forward is "up" on radar (-Y)

        // Clamp to radar circle
        const distRadar = Math.sqrt(rX*rX + rY*rY);
        if (distRadar > radarRadius) {
          rX = (rX / distRadar) * radarRadius;
          rY = (rY / distRadar) * radarRadius;
        }

        // Create blip DOM
        const blip = document.createElement('div');
        blip.className = 'radar-blip';
        // 90px is center of 180px radar
        blip.style.left = `${90 + rX}px`;
        blip.style.top = `${90 + rY}px`;
        if (enemy === lockedEnemy) {
          blip.style.background = '#00ffaa'; // Locked enemy is cyan on radar
          blip.style.boxShadow = '0 0 5px #00ffaa';
        }
        this.radarBlips.appendChild(blip);

      } else if (this.hpBars[enemy.id]) {
        this.hpBars[enemy.id].div.style.display = 'none';
      }
    }

    if (!isLockedEnemyVisible) {
      this.targetLock.classList.remove('active');
    }
  }

  setCrosshairTarget(x, y) {
    this.targetCrosshairPos.set(x, y);
  }

  triggerDamageFlash() {
    this.damageFlash.classList.add('hit-flash');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.remove('hit-flash');
  }

  showGameOver(stats) {
    this.goTime.innerText = this._formatTime(stats.timeSurvived);
    this.goKills.innerText = stats.kills;
    this.gameOverScreen.classList.add('active');
  }

  hideGameOver() {
    this.gameOverScreen.classList.remove('active');
  }

  addLog(message, type = 'normal') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.innerText = `> ${message}`;
    this.activityFeed.appendChild(el);
    setTimeout(() => {
      if (this.activityFeed.contains(el)) this.activityFeed.removeChild(el);
    }, 5000);
  }

  _toggleWarning(el, show) {
    if (show) { el.classList.add('active'); }
    else { el.classList.remove('active'); }
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  reset() {
    this.hideGameOver();
    this.stallWarning.classList.remove('active');
    this.terrainWarning.classList.remove('active');
    this.noChargeWarning.classList.remove('active');
    // Clear activity feed
    this.activityFeed.innerHTML = '';
    // Clear enemy HP bars
    this.enemyUiLayer.innerHTML = '';
    this.hpBars = {};
    this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
    this.currentCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
  }
}
