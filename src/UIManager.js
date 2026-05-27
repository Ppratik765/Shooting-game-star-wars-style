import * as THREE from 'three';

const SUN1_POS = new THREE.Vector3(2080, 2340, -1560);
const SUN2_POS = new THREE.Vector3(-1300, 1820, 2080);

export class UIManager {
  constructor() {
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200);

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
    this.boostVignette = document.getElementById('boost-vignette');
    this.altWarning   = document.getElementById('altitude-warning');

    // Start Screen
    this.uiLayer = document.getElementById('ui-layer');
    this.startScreen = document.getElementById('start-screen');
    this.uiLayer.style.display = 'none';

    // Hook up start screen modals
    this._setupStartScreen();

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
    this.crackSeedOffset = Math.floor(Math.random() * 1000);

    // === Arc HUD Canvas ===
    this._initArcHUD();

    // === Crack overlay canvas ===
    this._initCrackOverlay();

    // === Sonar radar state ===
    this.sonarTimer    = 0;
    this.sonarInterval = 3.0;
    this.sonarBlips    = [];

    let uiResizePending = false;
    window.addEventListener('resize', () => {
      if (uiResizePending) return;
      uiResizePending = true;
      requestAnimationFrame(() => {
        this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
        this.currentCrosshairPos.copy(this.targetCrosshairPos);
        this._resizeArcHUD();
        uiResizePending = false;
      });
    });
  }

  _setupStartScreen() {
    const btnHowToPlay = document.getElementById('btn-how-to-play');
    const modal = document.getElementById('how-to-play-modal');
    const btnClose = document.getElementById('btn-close-modal');

    if (btnHowToPlay && modal) {
      btnHowToPlay.addEventListener('click', () => {
        modal.style.display = 'flex';
      });
    }

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // Tabs logic
    const tabDesktop = document.getElementById('tab-desktop');
    const tabMobile = document.getElementById('tab-mobile');
    const contentDesktop = document.getElementById('content-desktop');
    const contentMobile = document.getElementById('content-mobile');

    if (tabDesktop && tabMobile) {
      tabDesktop.addEventListener('click', () => {
        tabDesktop.classList.add('active');
        tabMobile.classList.remove('active');
        contentDesktop.classList.add('active');
        contentMobile.classList.remove('active');
      });
      tabMobile.addEventListener('click', () => {
        tabMobile.classList.add('active');
        tabDesktop.classList.remove('active');
        contentMobile.classList.add('active');
        contentDesktop.classList.remove('active');
      });
    }
  }

  startGame() {
    if (this.startScreen) this.startScreen.style.display = 'none';
    if (this.uiLayer) this.uiLayer.style.display = 'block';
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

  _initCrackOverlay() {
    this.crackCanvas = document.getElementById('crack-overlay');
    this.crackCtx = this.crackCanvas ? this.crackCanvas.getContext('2d') : null;
    this._resizeCrackOverlay();
    this.cachedCracks = null;
    this.cachedCrackLevel = -1;
    window.addEventListener('resize', () => {
      this._resizeCrackOverlay();
      this.cachedCracks = null; // regenerate on resize
      this.cachedCrackLevel = -1;
    });
  }

  _resizeCrackOverlay() {
    if (!this.crackCanvas) return;
    this.crackCanvas.width = window.innerWidth;
    this.crackCanvas.height = window.innerHeight;
  }

  _generateCrackPattern(level) {
    // level: 1 (just below 30%) to 6 (nearly dead)
    // Returns an array of crack line segments
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cracks = [];

    // Use a constant seed for the entire run to prevent PRNG drift between damage levels
    const rng = this._seededRandom(this.crackSeedOffset);

    const maxCracks = 9;
    const visibleCracks = Math.max(1, Math.floor(level * 1.5));

    for (let c = 0; c < maxCracks; c++) {
      // Query edge and start positions deterministically so paths are identical
      const edge = Math.floor(rng() * 4);
      let sx, sy;
      const rVal1 = rng();
      const rVal2 = rng();
      switch (edge) {
        case 0: sx = rVal1 * w; sy = 0; break;       // top
        case 1: sx = w; sy = rVal2 * h; break;        // right
        case 2: sx = rVal1 * w; sy = h; break;        // bottom
        case 3: sx = 0; sy = rVal2 * h; break;        // left
      }

      const maxSegments = 8;
      // Active segment count grows as the damage level increases
      const activeSegments = Math.max(1, Math.min(maxSegments, Math.floor(1 + level * 1.2)));

      const points = [{ x: sx, y: sy }];
      let curX = sx, curY = sy;
      // Point toward center
      const toCenterX = w / 2 - sx;
      const toCenterY = h / 2 - sy;
      let baseAngle = Math.atan2(toCenterY, toCenterX);

      const generatedPoints = [];
      const branchData = [];

      for (let s = 0; s < maxSegments; s++) {
        const angleRand = rng();
        const lenRand = rng();
        const nextAngleRand = rng();
        const branchRand1 = rng();
        const branchRand2 = rng();
        const branchRand3 = rng();

        const angle = baseAngle + (angleRand - 0.5) * 1.0;
        // Segment length bounds scale slightly with severity level
        const maxLen = 15 + level * 8;
        const len = 8 + lenRand * maxLen;

        curX += Math.cos(angle) * len;
        curY += Math.sin(angle) * len;
        generatedPoints.push({ x: curX, y: curY });

        baseAngle = angle + (nextAngleRand - 0.5) * 0.5;

        // Occasional branch
        if (branchRand1 > 0.70) {
          const branchAngle = angle + (branchRand2 > 0.5 ? 1 : -1) * (0.3 + branchRand3 * 0.6);
          const branchLen = 8 + lenRand * maxLen * 0.4;
          branchData.push({
            segmentIndex: s,
            start: { x: curX, y: curY },
            end: {
              x: curX + Math.cos(branchAngle) * branchLen,
              y: curY + Math.sin(branchAngle) * branchLen
            }
          });
        }
      }

      // If this crack index is active at this damage level
      if (c < visibleCracks) {
        const crackPoints = [points[0]];
        for (let s = 0; s < activeSegments; s++) {
          crackPoints.push(generatedPoints[s]);
        }

        // Add the main crack line
        cracks.push({
          points: crackPoints,
          width: 0.6 + (c % 3) * 0.4
        });

        // Add branches (only visible at higher damage levels, branching from active segments)
        if (level > 3) {
          for (const branch of branchData) {
            if (branch.segmentIndex < activeSegments) {
              cracks.push({
                points: [branch.start, branch.end],
                width: 0.3 + (c % 2) * 0.2
              });
            }
          }
        }
      }
    }

    return cracks;
  }

  _seededRandom(seed) {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  _drawCracks(hpRatio) {
    if (!this.crackCtx) return;
    const ctx = this.crackCtx;
    ctx.clearRect(0, 0, this.crackCanvas.width, this.crackCanvas.height);

    if (hpRatio >= 0.3) {
      this.cachedCracks = null;
      this.cachedCrackLevel = -1;
      return;
    }

    // Level 1-6 based on how far below 30% we are
    const severity = 1.0 - (hpRatio / 0.3); // 0 at 30%, 1 at 0%
    const level = Math.max(1, Math.min(6, Math.ceil(severity * 6)));

    if (level !== this.cachedCrackLevel) {
      this.cachedCracks = this._generateCrackPattern(level);
      this.cachedCrackLevel = level;
    }

    // Increased opacity for better visibility (starts at 0.25, goes up to 0.70)
    const alpha = 0.25 + severity * 0.45;

    for (const crack of this.cachedCracks) {
      ctx.beginPath();
      ctx.moveTo(crack.points[0].x, crack.points[0].y);
      for (let i = 1; i < crack.points.length; i++) {
        ctx.lineTo(crack.points[i].x, crack.points[i].y);
      }
      ctx.strokeStyle = `rgba(195, 215, 245, ${alpha})`;
      ctx.lineWidth = crack.width;
      ctx.shadowColor = `rgba(130, 185, 255, ${alpha * 0.55})`;
      ctx.shadowBlur = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  _drawArcHUD(chargeState, playerState) {
    const ctx = this.arcCtx;
    // Arc center follows the crosshair position
    const cx  = this.currentCrosshairPos.x;
    const cy  = this.currentCrosshairPos.y;
    const R   = 70; // radius from crosshair center

    // Calculate rotation angle in radians based on crosshair X position
    const dx = this.currentCrosshairPos.x - window.innerWidth / 2;
    const maxRot = 1.2; // ~70 degrees max rotation
    const rotVal = (dx / (window.innerWidth / 2)) * maxRot;

    ctx.clearRect(0, 0, this.arcCanvas.width, this.arcCanvas.height);
    this._drawLensFlares(ctx);

    // --- LEFT ARC: Engine / Stamina ---
    const staminaRatio = playerState.stamina / playerState.maxStamina;
    this._drawArc(ctx, cx, cy, R,
      Math.PI * 0.75 + rotVal,
      Math.PI * 1.25 + rotVal,
      staminaRatio,
      playerState.staminaDepleted ? '#ff4400' : '#00aaff',
      'BOOST',
      Math.floor(staminaRatio * 100) + '%',
      -1
    );

    // --- RIGHT ARC: Charge ---
    if (chargeState) {
      const chargeRatio = chargeState.charge / chargeState.maxCharge;
      this._drawArc(ctx, cx, cy, R,
        Math.PI * 1.75 + rotVal,
        Math.PI * 2.25 + rotVal,
        chargeRatio,
        chargeState.chargeDepleted ? '#ff2200' : '#ffaa00',
        'CHRG',
        Math.floor(chargeRatio * 100) + '%',
        1
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
    const labelRadius = R + 20;
    const lx = cx + Math.cos(startAngle + arcSpan * 0.5) * labelRadius;
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

  _drawLensFlares(ctx) {
    if (!this.sunProjCoords || this.sunProjCoords.length === 0) return;

    const hw = window.innerWidth / 2;
    const hh = window.innerHeight / 2;

    this.sunProjCoords.forEach(sun => {
      const dx = sun.x - hw;
      const dy = sun.y - hh;

      const elements = [
        { factor: 0.35, size: 25, type: 'ring' },
        { factor: 0.55, size: 12, type: 'ring' },
        { factor: 0.75, size: 45, type: 'hexagon' },
        { factor: 0.95, size: 18, type: 'ring' },
        { factor: 1.15, size: 65, type: 'hexagon' },
        { factor: -0.25, size: 30, type: 'ring' },
        { factor: -0.45, size: 15, type: 'ring' }
      ];

      elements.forEach(el => {
        const fx = hw + dx * el.factor;
        const fy = hh + dy * el.factor;

        ctx.strokeStyle = sun.color;
        ctx.lineWidth = 1;
        ctx.fillStyle = sun.color;

        ctx.beginPath();
        if (el.type === 'ring') {
          ctx.arc(fx, fy, el.size, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(fx, fy, el.size * 0.95, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Hexagon
          for (let side = 0; side < 6; side++) {
            const angle = (side / 6) * Math.PI * 2;
            const hx = fx + Math.cos(angle) * el.size;
            const hy = fy + Math.sin(angle) * el.size;
            if (side === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    });
  }

  update(deltaTime, playerState, gameState, chargeState, camera, isRadarJammed) {
    this.isRadarJammed = !!isRadarJammed;

    // Toggle radar container jammed visual class
    const radarContainer = document.getElementById('radar-container');
    if (radarContainer) {
      radarContainer.classList.toggle('jammed', this.isRadarJammed);
    }

    // Project Suns for Lens Flare drawing
    const hw = window.innerWidth / 2;
    const hh = window.innerHeight / 2;
    this.sunProjCoords = [];

    if (camera) {
      [SUN1_POS, SUN2_POS].forEach((sunPos, idx) => {
        const pos = sunPos.clone().project(camera);
        if (pos.z < 1 && pos.z > 0) {
          const px = pos.x * hw + hw;
          const py = -(pos.y * hh) + hh;
          this.sunProjCoords.push({
            x: px, y: py,
            color: idx === 0 ? 'rgba(255, 153, 0, 0.08)' : 'rgba(0, 170, 255, 0.08)'
          });
        }
      });
    }

    // Crosshair lerp - instantaneous on mobile, lerped on desktop
    if (this.isMobile) {
      this.currentCrosshairPos.copy(this.targetCrosshairPos);
    } else {
      this.currentCrosshairPos.lerp(this.targetCrosshairPos, 0.12);
    }
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

    // Draw arc HUD (follows crosshair)
    this._drawArcHUD(chargeState, playerState);

    // Boost vignette — BLUE
    if (this.boostVignette) {
      this.boostVignette.classList.toggle('active', playerState.isBoosting);
    }

    // Altitude warning
    if (this.altWarning) {
      this._toggleWarning(this.altWarning, playerState.isAboveMaxAlt);
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

    // Display customized stall warnings depending on device
    if (playerState.isStalled) {
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200);
      if (isMobile) {
        this.stallWarning.innerText = "⚠ STALL ⚠";
      } else {
        this.stallWarning.innerText = `⚠ MASH CTRL TO RESTART ENGINES (${Math.floor(playerState.stallRecoveryProgress)}%) ⚠`;
      }
    } else {
      this.stallWarning.innerText = "⚠ STALL ⚠";
    }

    this._toggleWarning(this.stallWarning,   playerState.isStalled);
    this._toggleWarning(this.terrainWarning, playerState.terrainWarning && !playerState.isStalled);

    // Crack overlay for low hull
    this._drawCracks(playerState.hp / playerState.maxHp);
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

    const liveBlips = [];

    // Auto-Aim Magnetism
    let closestEnemyProj = null;
    let minDistance = Infinity;

    for (const enemy of enemies) {
      if (enemy.active && !enemy.dying) {
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

          // Distance of this enemy from current crosshair
          const distToCrosshair = Math.hypot(px - this.currentCrosshairPos.x, py - this.currentCrosshairPos.y);
          if (distToCrosshair < minDistance) {
            minDistance = distToCrosshair;
            closestEnemyProj = { x: px, y: py };
          }
        } else if (this.hpBars[enemy.id]) {
          this.hpBars[enemy.id].div.style.display = 'none';
        }

        // Collect for sonar (only when not jammed)
        if (!this.isRadarJammed) {
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
          liveBlips.push({ rX, rY, isLocked: false });
        }

      } else if (this.hpBars[enemy.id]) {
        this.hpBars[enemy.id].div.style.display = 'none';
      }
    }

    // Apply auto-aim magnetism:
    // On mobile, magnetically pull the actual controller's aim coordinates towards closest target
    const threshold = this.isMobile ? 200 : 130;
    const pullStrength = this.isMobile ? 0.25 : 0.16;

    if (closestEnemyProj && minDistance < threshold) {
      if (this.isMobile && this.inputController) {
        this.inputController.mouse.x = THREE.MathUtils.lerp(this.inputController.mouse.x, closestEnemyProj.x, pullStrength);
        this.inputController.mouse.y = THREE.MathUtils.lerp(this.inputController.mouse.y, closestEnemyProj.y, pullStrength);
        this.targetCrosshairPos.copy(this.inputController.mouse);
      } else {
        this.targetCrosshairPos.x = THREE.MathUtils.lerp(this.targetCrosshairPos.x, closestEnemyProj.x, pullStrength);
        this.targetCrosshairPos.y = THREE.MathUtils.lerp(this.targetCrosshairPos.y, closestEnemyProj.y, pullStrength);
      }
    }

    // If jammed, generate static noise blips
    if (this.isRadarJammed) {
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * radarRadius;
        liveBlips.push({
          rX: Math.cos(angle) * r,
          rY: Math.sin(angle) * r,
          isLocked: false
        });
      }
    }

    // Sonar sweep aesthetic trigger
    const now = Date.now();
    if (!this.lastSonarTime) this.lastSonarTime = now;
    if (now - this.lastSonarTime >= 3000) {
      this.lastSonarTime = now;
      const radar = document.getElementById('radar-container');
      if (radar) {
        radar.classList.remove('sonar-ping');
        void radar.offsetWidth;
        radar.classList.add('sonar-ping');
      }
    }

    // Reuse existing blip elements to avoid DOM churn and improve performance
    const blipElements = this.radarBlips.children;
    const diff = liveBlips.length - blipElements.length;

    if (diff > 0) {
      for (let i = 0; i < diff; i++) {
        const el = document.createElement('div');
        el.className = 'radar-blip';
        this.radarBlips.appendChild(el);
      }
    } else if (diff < 0) {
      for (let i = 0; i < -diff; i++) {
        this.radarBlips.removeChild(this.radarBlips.lastChild);
      }
    }

    for (let i = 0; i < liveBlips.length; i++) {
      const blip = liveBlips[i];
      const el = blipElements[i];

      const pctX = 50 + (blip.rX / 90) * 50;
      const pctY = 50 + (blip.rY / 90) * 50;
      el.style.left = `${pctX}%`;
      el.style.top  = `${pctY}%`;

      // Visual adjustments for jammed static vs normal blips
      if (this.isRadarJammed) {
        el.style.background = '#ff4400';
        el.style.boxShadow = '0 0 5px #ff4400';
      } else {
        el.style.background = '';
        el.style.boxShadow  = '';
      }
    }

    // Target lock brackets are permanently deactivated
    this.targetLock.classList.remove('active');
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

    // Load PBs from localStorage
    const pbTime = parseFloat(localStorage.getItem('pb_time') || '0');
    const pbKills = parseInt(localStorage.getItem('pb_kills') || '0');

    let isNewPB = false;
    if (stats.timeSurvived > pbTime) {
      localStorage.setItem('pb_time', stats.timeSurvived.toString());
      isNewPB = true;
    }
    if (stats.kills > pbKills) {
      localStorage.setItem('pb_kills', stats.kills.toString());
      isNewPB = true;
    }

    const currentPBTime = Math.max(stats.timeSurvived, pbTime);
    const currentPBKills = Math.max(stats.kills, pbKills);

    document.getElementById('pb-time').innerText = this._formatTime(currentPBTime);
    document.getElementById('pb-kills').innerText = currentPBKills;

    const newPbTag = document.getElementById('new-pb-tag');
    if (newPbTag) {
      newPbTag.style.display = isNewPB ? 'block' : 'none';
    }

    this.gameOverScreen.classList.add('active');

    // Generate tally marks
    const tallyEl = document.getElementById('go-tally');
    if (tallyEl) {
      tallyEl.innerHTML = this._generateTallyMarks(stats.kills);
    }
  }

  _generateTallyMarks(kills) {
    if (kills <= 0) return '';
    const fullGroups = Math.floor(kills / 5);
    const remainder = kills % 5;
    let html = '';

    for (let i = 0; i < fullGroups; i++) {
      html += '<span class="tally-group">||||<span class="tally-diagonal"></span></span> ';
    }
    if (remainder > 0) {
      html += `<span class="tally-remainder">${'|'.repeat(remainder)}</span>`;
    }
    return html.trim();
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
    if (this.altWarning) this.altWarning.classList.remove('active');
    this.activityFeed.innerHTML = '';
    this.enemyUiLayer.innerHTML = '';
    this.hpBars = {};
    this.sonarBlips = [];
    this.sonarTimer = 0;
    this.targetCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);
    this.currentCrosshairPos.set(window.innerWidth / 2, window.innerHeight / 2);

    // Clear crack overlay
    this.crackSeedOffset = Math.floor(Math.random() * 1000);
    this.cachedCracks = null;
    this.cachedCrackLevel = -1;
    if (this.crackCtx) {
      this.crackCtx.clearRect(0, 0, this.crackCanvas.width, this.crackCanvas.height);
    }
  }

  initSettings(inputController, audioManager, playerShip) {
    this.inputController = inputController;
    this.audioManager = audioManager;
    this.playerShip = playerShip;

    // Detect device type to show appropriate layout
    const settingsMenu = document.getElementById('settings-menu');
    if (settingsMenu) {
      if (this.isMobile) {
        settingsMenu.classList.add('mobile-device');
        settingsMenu.classList.remove('desktop-device');
      } else {
        settingsMenu.classList.add('desktop-device');
        settingsMenu.classList.remove('mobile-device');
      }
    }

    if (this.isMobile) return; // Skip desktop UI initialization on mobile

    // Load initial values to UI elements from settings
    const sensInput = document.getElementById('setting-mouse-sensitivity');
    const sensValText = document.getElementById('value-mouse-sensitivity');
    if (sensInput && sensValText) {
      sensInput.value = inputController.mouseSensitivity;
      sensValText.textContent = inputController.mouseSensitivity.toFixed(1);
      
      sensInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        inputController.mouseSensitivity = val;
        sensValText.textContent = val.toFixed(1);
        localStorage.setItem('setting_mouse_sensitivity', val.toString());
      });
    }

    const invertYInput = document.getElementById('setting-invert-y');
    if (invertYInput) {
      invertYInput.checked = inputController.invertY;
      invertYInput.addEventListener('change', (e) => {
        const checked = e.target.checked;
        inputController.invertY = checked;
        localStorage.setItem('setting_invert_y', checked ? 'true' : 'false');
      });
    }

    const scanlinesInput = document.getElementById('setting-scanlines');
    const crtScanlines = document.getElementById('crt-scanlines');
    if (scanlinesInput) {
      const scanlinesEnabled = localStorage.getItem('setting_scanlines') !== 'false';
      scanlinesInput.checked = scanlinesEnabled;
      if (crtScanlines) {
        crtScanlines.style.display = scanlinesEnabled ? 'block' : 'none';
      }

      scanlinesInput.addEventListener('change', (e) => {
        const checked = e.target.checked;
        localStorage.setItem('setting_scanlines', checked ? 'true' : 'false');
        if (crtScanlines) {
          crtScanlines.style.display = checked ? 'block' : 'none';
        }
      });
    }

    const shakeInput = document.getElementById('setting-shake');
    const shakeValText = document.getElementById('value-shake');
    if (shakeInput && shakeValText) {
      const savedShake = parseInt(localStorage.getItem('setting_shake') || '80');
      shakeInput.value = savedShake;
      shakeValText.textContent = savedShake + '%';
      playerShip.shakeIntensityScale = savedShake / 100;

      shakeInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        shakeValText.textContent = val + '%';
        playerShip.shakeIntensityScale = val / 100;
        localStorage.setItem('setting_shake', val.toString());
      });
    }

    const masterVolInput = document.getElementById('setting-master-volume');
    const masterVolValText = document.getElementById('value-master-volume');
    if (masterVolInput && masterVolValText) {
      const savedMasterVol = parseInt(localStorage.getItem('setting_master_volume') || '90');
      masterVolInput.value = savedMasterVol;
      masterVolValText.textContent = savedMasterVol + '%';
      audioManager.setMasterVolumeScale(savedMasterVol / 100);

      masterVolInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        masterVolValText.textContent = val + '%';
        audioManager.setMasterVolumeScale(val / 100);
        localStorage.setItem('setting_master_volume', val.toString());
      });
    }

    const engineHumInput = document.getElementById('setting-engine-hum');
    const engineHumValText = document.getElementById('value-engine-hum');
    if (engineHumInput && engineHumValText) {
      const savedEngineHum = parseInt(localStorage.getItem('setting_engine_hum') || '30');
      engineHumInput.value = savedEngineHum;
      engineHumValText.textContent = savedEngineHum + '%';
      audioManager.setEngineVolumeScale(savedEngineHum / 100);

      engineHumInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        engineHumValText.textContent = val + '%';
        audioManager.setEngineVolumeScale(val / 100);
        localStorage.setItem('setting_engine_hum', val.toString());
      });
    }

    // Keybindings Buttons Setup
    const keyActions = ['boost', 'fire', 'pitchDown', 'pitchUp', 'rollLeft', 'rollRight'];
    
    const formatKeyForDisplay = (key) => {
      if (key === ' ') return 'Space';
      if (key.length === 1) return key.toUpperCase();
      return key;
    };

    keyActions.forEach(action => {
      const btn = document.getElementById(`bind-${action}`);
      if (btn) {
        btn.textContent = formatKeyForDisplay(inputController.keymap[action]);
        
        btn.addEventListener('click', () => {
          if (audioManager) audioManager.playUIClick();

          // Set all buttons to inactive first, to prevent multiple waiting states
          keyActions.forEach(act => {
            const b = document.getElementById(`bind-${act}`);
            if (b) {
              b.classList.remove('waiting');
              b.textContent = formatKeyForDisplay(inputController.keymap[act]);
            }
          });

          btn.classList.add('waiting');
          btn.textContent = '[ PRESS KEY ]';

          inputController.startRebinding(action, (newKey) => {
            btn.classList.remove('waiting');
            btn.textContent = formatKeyForDisplay(newKey);
          });
        });
      }
    });
  }
}
