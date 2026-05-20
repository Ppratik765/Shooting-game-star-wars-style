import * as THREE from 'three';

export class UIManager {
  constructor() {
    this.crosshair    = document.getElementById('crosshair');
    this.compassStrip = document.getElementById('compass-strip');
    this.damageFlash  = document.getElementById('damage-flash');
    this.activityFeed = document.getElementById('activity-feed');
    this.statTime     = document.getElementById('stat-time');
    this.statKills    = document.getElementById('stat-kills');
    this.statThreat   = document.getElementById('stat-threat');
    this.statAlt      = document.getElementById('stat-alt');
    this.enemyUiLayer = document.getElementById('enemy-ui-layer');
    this.targetLock   = document.getElementById('target-lock');
    this.radarBlips   = document.getElementById('radar-blips');
    this.boostVignette = document.getElementById('boost-vignette');
    this.altWarning   = document.getElementById('altitude-warning');

    // Classic bottom bars (now hidden — replaced by arc HUD)
    this.healthFill   = document.getElementById('health-bar-fill');
    this.staminaFill  = document.getElementById('stamina-bar-fill');
    this.chargeFill   = document.getElementById('charge-bar-fill');

    // Warnings
    this.stallWarning    = document.getElementById('stall-warning');
    this.terrainWarning  = document.getElementById('terrain-warning');
    this.noChargeWarning = document.getElementById('no-charge-warning');

    // Game Over
    this.gameOverScreen = document.getElementById('game-over-screen');
    this.goTime  = document.getElementById('go-time');
    this.goKills = document.getElementById('go-kills');

    // Crosshair lerp
    this.targetCrosshairPos  = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
    this.currentCrosshairPos = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);

    this.hpBars = {};

    // === Arc HUD Canvas ===
    this._initArcHUD();

    // === Sonar radar state ===
    this.sonarTimer    = 0;
    this.sonarInterval = 3.0;    // seconds between sonar pings
    this.sonarBlips    = [];     // cached blip positions from last ping

    window.addEventListener('resize', () => {
      this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
      this.currentCrosshairPos.copy(this.targetCrosshairPos);
      this._resizeArcHUD();
    });
  }

  _initArcHUD() {
    this.arcCanvas = document.createElement('canvas');
    this.arcCanvas.id = 'arc-hud';
    this.arcCanvas.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 20;
    `;
    document.getElementById('ui-layer').appendChild(this.arcCanvas);
    this.arcCtx = this.arcCanvas.getContext('2d');
    this._resizeArcHUD();
  }

  _resizeArcHUD() {
    this.arcCanvas.width  = window.innerWidth;
    this.arcCanvas.height = window.innerHeight;
  }

  _drawArcHUD(chargeState, playerState) {
    const ctx = this.arcCtx;
    const cx  = window.innerWidth  / 2;
    const cy  = window.innerHeight / 2;
    const R   = 70; // radius from crosshair center

    ctx.clearRect(0, 0, this.arcCanvas.width, this.arcCanvas.height);

    // --- LEFT ARC: Engine / Stamina ---
    const staminaRatio = playerState.stamina / playerState.maxStamina;
    this._drawArc(ctx, cx, cy, R,
      Math.PI * 0.75,  // start angle (lower left)
      Math.PI * 1.25,  // end angle (upper left)
      staminaRatio,
      playerState.staminaDepleted ? '#ff4400' : '#00aaff',
      'BOOST',
      Math.floor(staminaRatio * 100) + '%',
      -1  // label on left side
    );

    // --- RIGHT ARC: Charge ---
    if (chargeState) {
      const chargeRatio = chargeState.charge / chargeState.maxCharge;
      this._drawArc(ctx, cx, cy, R,
        Math.PI * 1.75, // start angle (upper right)
        Math.PI * 2.25, // end angle (lower right)
        chargeRatio,
        chargeState.chargeDepleted ? '#ff2200' : '#ffaa00',
        'CHRG',
        Math.floor(chargeRatio * 100) + '%',
        1   // label on right side
      );
    }
  }

  _drawArc(ctx, cx, cy, R, startAngle, endAngle, ratio, color, label, valueText, side) {
    const arcSpan = endAngle - startAngle;

    // Background track
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 5;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Filled portion
    if (ratio > 0.001) {
      const fillEnd = startAngle + arcSpan * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, fillEnd);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 5;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 14;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }

    // Label text
    const labelAngle  = (startAngle + endAngle) / 2 + Math.PI; // opposite side
    const labelRadius = R + 20;
    const lx = cx + Math.cos(startAngle + arcSpan * 0.5) * labelRadius * (side < 0 ? 1 : 1);
    const ly = cy + Math.sin(startAngle + arcSpan * 0.5) * labelRadius;

    ctx.font      = '11px VT323, monospace';
    ctx.fillStyle = color;
    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.shadowColor = color;
    ctx.shadowBlur  = 6;
    ctx.fillText(label, lx + (side < 0 ? -8 : 8), ly - 4);
    ctx.font = '13px VT323, monospace';
    ctx.fillText(valueText, lx + (side < 0 ? -8 : 8), ly + 10);
    ctx.shadowBlur = 0;
    ctx.textAlign  = 'left';
  }

  update(deltaTime, playerState, gameState, chargeState) {
    // Crosshair lerp
    this.currentCrosshairPos.lerp(this.targetCrosshairPos, 0.12);
    const dx = this.currentCrosshairPos.x - window.innerWidth / 2;
    const dy = this.currentCrosshairPos.y - window.innerHeight / 2;
    this.crosshair.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;

    // Compass
    const pxPerRev = 390;
    const centerOffset = -pxPerRev;
    const yawOffset = (playerState.yaw / (Math.PI * 2)) * pxPerRev;
    this.compassStrip.style.transform = `translateX(${centerOffset + yawOffset}px)`;

    // Hull bar (still in meters container)
    if (this.healthFill) {
      this.healthFill.style.width = `${Math.max(0, (playerState.hp / playerState.maxHp) * 100)}%`;
      if (playerState.hp < playerState.maxHp * 0.3) {
        this.healthFill.style.background   = '#ff0000';
        this.healthFill.style.boxShadow    = '0 0 8px #ff0000';
      } else {
        this.healthFill.style.background   = '#00ffaa';
        this.healthFill.style.boxShadow    = '0 0 8px #00ffaa';
      }
    }

    // Hide old stamina/charge bars (arc HUD replaces them)
    if (this.staminaFill) this.staminaFill.parentElement.parentElement.style.display = 'none';
    if (this.chargeFill)  this.chargeFill.parentElement.parentElement.style.display  = 'none';

    // Draw arc HUD
    this._drawArcHUD(chargeState, playerState);

    // Boost vignette — BLUE
    if (this.boostVignette) {
      this.boostVignette.classList.toggle('active', playerState.isBoosting);
    }

    // Altitude warning
    if (this.altWarning) {
      this.altWarning.classList.toggle('active', playerState.isAboveMaxAlt);
    }

    // Charge warning
    if (chargeState) {
      this._toggleWarning(this.noChargeWarning, chargeState.chargeDepleted);
    }

    // Stats
    this.statTime.innerText  = this._formatTime(gameState.timeSurvived);
    this.statKills.innerText = gameState.kills;
    this.statAlt.innerText   = Math.floor(playerState.altitude);

    let threat = 'LOW';
    if (gameState.kills > 30)      threat = 'CRITICAL';
    else if (gameState.kills > 15) threat = 'HIGH';
    else if (gameState.kills > 5)  threat = 'MEDIUM';
    this.statThreat.innerText = threat;

    this._toggleWarning(this.stallWarning,   playerState.isStalled);
    this._toggleWarning(this.terrainWarning, playerState.terrainWarning && !playerState.isStalled);
  }

  updateEnemyUI(camera, enemies, lockedEnemy) {
    const hw = window.innerWidth  / 2;
    const hh = window.innerHeight / 2;

    const radarRadius = 85;
    const radarScale  = 0.08;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    const camRight = new THREE.Vector3(camDir.z, 0, -camDir.x);

    let isLockedEnemyVisible = false;

    // === Sonar: only update blips on ping interval ===
    // (sonarTimer is updated in update() — we pass enemies list here)
    // We refresh sonarBlips periodically and render from cache

    // Rebuild enemy HP bars + collect radar positions
    const liveBlips = [];

    for (const enemy of enemies) {
      if (enemy.active) {
        const pos = enemy.mesh.position.clone().project(camera);
        if (pos.z < 1 && pos.z > 0) {
          if (!this.hpBars[enemy.id]) {
            const div  = document.createElement('div');
            div.className = 'enemy-hp-container';
            const fill = document.createElement('div');
            fill.className = 'enemy-hp-fill';
            div.appendChild(fill);
            this.enemyUiLayer.appendChild(div);
            this.hpBars[enemy.id] = { div, fill };
          }
          const bar = this.hpBars[enemy.id];
          const px  = pos.x * hw + hw;
          const py  = -(pos.y * hh) + hh;
          bar.div.style.left    = `${px}px`;
          bar.div.style.top     = `${py - 30}px`;
          bar.fill.style.width  = `${(enemy.hp / enemy.maxHp) * 100}%`;
          bar.div.style.display = 'block';

          if (enemy === lockedEnemy) {
            isLockedEnemyVisible = true;
            this.targetLock.style.left = `${px}px`;
            this.targetLock.style.top  = `${py}px`;
            this.targetLock.classList.add('active');
          }
        } else if (this.hpBars[enemy.id]) {
          this.hpBars[enemy.id].div.style.display = 'none';
        }

        // Collect for sonar
        const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, camera.position);
        toEnemy.y = 0;
        const distFwd   = toEnemy.dot(camDir);
        const distRight = toEnemy.dot(camRight);
        let rX = distRight * radarScale;
        let rY = -distFwd  * radarScale;
        const distRadar = Math.sqrt(rX * rX + rY * rY);
        if (distRadar > radarRadius) {
          rX = (rX / distRadar) * radarRadius;
          rY = (rY / distRadar) * radarRadius;
        }
        liveBlips.push({ rX, rY, isLocked: enemy === lockedEnemy });

      } else if (this.hpBars[enemy.id]) {
        this.hpBars[enemy.id].div.style.display = 'none';
      }
    }

    // Sonar: update cached blips every interval, then render them with fade
    this.sonarTimer = (this.sonarTimer || 0) + (1 / 60); // approximate dt
    if (this.sonarTimer >= this.sonarInterval) {
      this.sonarTimer = 0;
      this.sonarBlips = liveBlips.slice();
      // Trigger sonar ping animation
      const radar = document.getElementById('radar-container');
      if (radar) {
        radar.classList.remove('sonar-ping');
        void radar.offsetWidth; // reflow
        radar.classList.add('sonar-ping');
      }
    }

    // Render cached sonar blips
    this.radarBlips.innerHTML = '';
    for (const blip of (this.sonarBlips || [])) {
      const el = document.createElement('div');
      el.className = 'radar-blip';
      el.style.left = `${90 + blip.rX}px`;
      el.style.top  = `${90 + blip.rY}px`;
      if (blip.isLocked) {
        el.style.background  = '#00ffaa';
        el.style.boxShadow   = '0 0 5px #00ffaa';
      }
      this.radarBlips.appendChild(el);
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
    this.goTime.innerText  = this._formatTime(stats.timeSurvived);
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
    if (show) el.classList.add('active');
    else      el.classList.remove('active');
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
    this.activityFeed.innerHTML = '';
    this.enemyUiLayer.innerHTML = '';
    this.hpBars = {};
    this.sonarBlips = [];
    this.sonarTimer = 0;
    this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
    this.currentCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
  }
}
