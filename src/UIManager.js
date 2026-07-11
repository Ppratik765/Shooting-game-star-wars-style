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
    this.shieldBubble  = document.getElementById('shield-bubble');
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

    // Powerup HUD caching
    this.powerupTimerContainer = document.getElementById('powerup-timer-container');
    this.powerupRingFill = document.getElementById('powerup-ring-fill');
    this.powerupTimerLabel = document.getElementById('powerup-timer-label');

    // Leaderboard HUD caching
    this.leaderboardBtn = document.getElementById('leaderboard-btn');
    this.leaderboardSubmitContainer = document.getElementById('leaderboard-submit-container');
    this.leaderboardAliasInput = document.getElementById('leaderboard-alias');
    this.btnSubmitScore = document.getElementById('btn-submit-score');
    this.leaderboardDisplayContainer = document.getElementById('leaderboard-display-container');
    this.leaderboardRows = document.getElementById('leaderboard-rows');
    this.btnCloseLeaderboard = document.getElementById('btn-close-leaderboard');

    this._setupLeaderboardEvents();

    // Reusable temp structures to avoid garbage collection
    this._tempV1 = new THREE.Vector3();
    this._tempV2 = new THREE.Vector3();
    this._tempV3 = new THREE.Vector3();
    this._tempV4 = new THREE.Vector3();
  }

  _setupLeaderboardEvents() {
    // 1. Mobile keyboard zoom prevention and positioning checks
    if (this.leaderboardAliasInput) {
      this.leaderboardAliasInput.addEventListener('focus', () => {
        // Prevent viewport scaling/zooming on mobile focus by programmatically resetting viewport scale
        const vpMeta = document.querySelector('meta[name="viewport"]');
        if (vpMeta) {
          vpMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
      });
    }

    // 2. Leaderboard Button: handles viewing high scores or callsign input
    if (this.leaderboardBtn) {
      this.leaderboardBtn.addEventListener('click', () => {
        if (this.inputController && this.inputController.isMobile) {
          // Play click
          if (this.audioManager) this.audioManager.playUIClick();
        }
        
        const text = this.leaderboardBtn.textContent;
        if (text.includes('SUBMIT')) {
          // Open callsign upload overlay
          this.leaderboardSubmitContainer.style.display = 'flex';
          this.leaderboardDisplayContainer.style.display = 'none';
          this.leaderboardAliasInput.value = '';
          this.leaderboardAliasInput.focus();
        } else {
          // Fetch and view ranks
          this.leaderboardSubmitContainer.style.display = 'none';
          this.leaderboardDisplayContainer.style.display = 'flex';
          this._fetchAndRenderLeaderboard();
        }
      });
    }

    // 3. Score Upload Button
    if (this.btnSubmitScore) {
      this.btnSubmitScore.addEventListener('click', async () => {
        const name = this.leaderboardAliasInput.value.trim().toUpperCase();
        if (!name) {
          this.showCustomAlert('WARNING', 'ENTER CALLSIGN');
          return;
        }

        const stats = this.gameOverStats || { kills: 0, timeSurvived: 0 };
        const deviceType = this._detectDevice();

        this.btnSubmitScore.disabled = true;
        const submitFn = async (confirmOverwrite = false) => {
          this.btnSubmitScore.disabled = true;
          this.btnSubmitScore.textContent = 'TRANSMITTING...';

          try {
            const response = await fetch('/api/submitScore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                score: stats.kills,
                time: stats.timeSurvived,
                device: deviceType,
                confirmOverwrite
              })
            });

            const data = await response.json();
            if (data.success) {
              // Save personal best to localStorage
              localStorage.setItem('pb_kills', stats.kills.toString());
              localStorage.setItem('pb_time', stats.timeSurvived.toString());
              localStorage.setItem('pb_submitted', stats.kills.toString());

              // Hide submission, show ranks
              this.leaderboardSubmitContainer.style.display = 'none';
              this.leaderboardDisplayContainer.style.display = 'flex';
              this._fetchAndRenderLeaderboard();

              // Toggle dynamic buttons
              this.leaderboardBtn.textContent = '[ VIEW LEADERBOARD ]';
              
              // Hide personal best glow effects
              const newPbTag = document.getElementById('new-pb-tag');
              if (newPbTag) newPbTag.style.display = 'none';
            } else if (data.code === 'RECORD_NOT_SUPERIOR') {
              this.showCustomAlert(
                '[ TRANSMISSION BLOCKED ]',
                `IMPERIAL DATABASE SHOWS CALLSIGN "${name}" IS ALREADY RESERVED BY A DECORATED PILOT WITH A SUPERIOR OR EQUAL RECORD (${data.existingScore} KILLS).\n\nIf you are a different pilot, please select a unique callsign to register your telemetry.`,
                () => {
                  if (this.leaderboardAliasInput) {
                    this.leaderboardAliasInput.focus();
                    this.leaderboardAliasInput.select();
                  }
                }
              );
            } else if (data.code === 'REQUIRES_OVERWRITE_CONFIRMATION') {
              const confirmMsg = `[ CALLSIGN COLLISION DETECTED ]\nATTENTION PILOT: Callsign "${name}" is already registered in the databanks with ${data.existingScore} kills.\n\n- Click OVERWRITE if this is your own record and you wish to overwrite it with your new personal best of ${stats.kills} kills.\n- Click CANCEL if you are a different pilot and want to choose a different callsign.`;
              this.showCustomConfirm(
                '[ CALLSIGN COLLISION DETECTED ]',
                confirmMsg,
                async () => {
                  await submitFn(true); // Resubmit with overwrite confirm
                },
                () => {
                  if (this.leaderboardAliasInput) {
                    this.leaderboardAliasInput.focus();
                    this.leaderboardAliasInput.select();
                  }
                },
                '[ OVERWRITE ]',
                '[ CANCEL ]'
              );
            } else {
              this.showCustomAlert('TRANSMISSION FAILED', data.error || 'UNABLE TO UPLOAD SCORE.');
            }
          } catch (err) {
            console.error(err);
            this.showCustomAlert('DATABASE CONNECTION ERROR', 'COULD NOT REACH LEADERBOARD TRANSCEIVER.');
          } finally {
            this.btnSubmitScore.disabled = false;
            this.btnSubmitScore.textContent = '[ UPLOAD DATA ]';
          }
        };

        await submitFn(false);
      });
    }

    // 4. Close Leaderboard Button
    if (this.btnCloseLeaderboard) {
      this.btnCloseLeaderboard.addEventListener('click', () => {
        this.leaderboardDisplayContainer.style.display = 'none';
      });
    }
  }

  async _fetchAndRenderLeaderboard() {
    if (!this.leaderboardRows) return;
    this.leaderboardRows.innerHTML = '<tr><td colspan="5" style="color: #00ffaa; text-shadow: 0 0 8px #00ffaa; text-align: center; padding: 20px;">ACQUIRING ENCRYPTED SATELLITE LINK...</td></tr>';

    try {
      const response = await fetch('/api/getLeaderboard');
      const data = await response.json();

      if (data.success && data.leaderboard) {
        this.leaderboardRows.innerHTML = '';
        if (data.leaderboard.length === 0) {
          this.leaderboardRows.innerHTML = '<tr><td colspan="5" style="color: rgba(0, 255, 170, 0.5); text-align: center; padding: 20px;">NO PILOTS LOGGED IN SECTOR</td></tr>';
          return;
        }

        data.leaderboard.forEach((entry, idx) => {
          const rank = idx + 1;
          const tr = document.createElement('tr');
          
          let rankClass = '';
          if (rank === 1) rankClass = 'row-top-1';
          else if (rank === 2) rankClass = 'row-top-2';
          else if (rank === 3) rankClass = 'row-top-3';

          // Device badge
          let badgeClass = 'badge-desktop';
          if (entry.device === 'Mobile') badgeClass = 'badge-mobile';
          else if (entry.device === 'Tablet') badgeClass = 'badge-tablet';

          // Format survival time
          const mins = Math.floor(entry.time / 60).toString().padStart(2, '0');
          const secs = Math.floor(entry.time % 60).toString().padStart(2, '0');
          const timeStr = `${mins}:${secs}`;

          tr.innerHTML = `
            <td class="${rankClass}">#${rank}</td>
            <td class="${rankClass}" style="letter-spacing: 2px;">${entry.name}</td>
            <td><span class="device-badge ${badgeClass}">${entry.device}</span></td>
            <td class="${rankClass}">${entry.kills}</td>
            <td>${timeStr}</td>
          `;
          this.leaderboardRows.appendChild(tr);
        });
      } else {
        this.leaderboardRows.innerHTML = '<tr><td colspan="5" style="color: #ff3300; text-align: center; padding: 20px;">LINK OFFLINE: ENCRYPTION FAIL</td></tr>';
      }
    } catch (err) {
      console.error(err);
      this.leaderboardRows.innerHTML = '<tr><td colspan="5" style="color: #ff3300; text-align: center; padding: 20px;">DATABASE OFFLINE: CONNECTION LOST</td></tr>';
    }
  }

  _detectDevice() {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return 'Tablet';
    }
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) {
      return 'Mobile';
    }
    if (navigator.maxTouchPoints > 1 && window.innerWidth < 1200) {
      return 'Tablet';
    }
    return 'Desktop';
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



  update(deltaTime, playerState, gameState, chargeState, camera, isRadarJammed, activePowerUp = null, powerUpTimeRemaining = 0.0) {
    this.isRadarJammed = !!isRadarJammed;

    // Shield overlay
    if (this.shieldBubble) {
      this.shieldBubble.classList.toggle('active', !!playerState.shieldActive);
    }

    // Power-up circular HUD animation
    if (activePowerUp && powerUpTimeRemaining > 0) {
      if (this.powerupTimerContainer) this.powerupTimerContainer.style.display = 'flex';
      if (this.powerupTimerLabel) this.powerupTimerLabel.textContent = `${powerUpTimeRemaining.toFixed(1)}s`;

      const pct = Math.max(0, Math.min(1, powerUpTimeRemaining / 10.0));
      const offset = 144.51 * (1.0 - pct);
      if (this.powerupRingFill) {
        this.powerupRingFill.style.strokeDashoffset = offset;
        this.powerupRingFill.style.stroke = activePowerUp === 'SHIELD' ? '#ffcc00' : '#00ff66';
      }
    } else {
      if (this.powerupTimerContainer) this.powerupTimerContainer.style.display = 'none';
    }

    // Toggle radar container jammed visual class
    const radarContainer = document.getElementById('radar-container');
    if (radarContainer) {
      radarContainer.classList.toggle('jammed', this.isRadarJammed);
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

  updateEnemyUI(camera, enemies, lockedEnemy, activePowerUps = []) {
    const hw = window.innerWidth  / 2;
    const hh = window.innerHeight / 2;

    const radarRadius = 85;
    const radarScale  = 0.08;

    const camDir = this._tempV1;
    camera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    const camRight = this._tempV2.set(camDir.z, 0, -camDir.x);

    const liveBlips = [];

    // Auto-Aim Magnetism
    let closestEnemyProj = null;
    let minDistance = Infinity;

    for (const enemy of enemies) {
      if (enemy.active && !enemy.dying) {
        const pos = this._tempV3.copy(enemy.mesh.position).project(camera);
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
          const toEnemy = this._tempV4.subVectors(enemy.mesh.position, camera.position);
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
          liveBlips.push({ rX, rY, isLocked: false, isPowerUp: false });
        }

      } else if (this.hpBars[enemy.id]) {
        this.hpBars[enemy.id].div.style.display = 'none';
      }
    }

    // Collect active powerups for radar (only when not jammed)
    if (!this.isRadarJammed && activePowerUps) {
      for (const item of activePowerUps) {
        const toPowerUp = this._tempV4.subVectors(item.group.position, camera.position);
        toPowerUp.y = 0;
        const distFwd   = toPowerUp.dot(camDir);
        const distRight = toPowerUp.dot(camRight);
        let rX = distRight * radarScale;
        let rY = -distFwd  * radarScale;
        const distRadar = Math.sqrt(rX * rX + rY * rY);
        if (distRadar > radarRadius) {
          rX = (rX / distRadar) * radarRadius;
          rY = (rY / distRadar) * radarRadius;
        }
        liveBlips.push({ rX, rY, isPowerUp: true, type: item.type });
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

      // Visual adjustments for jammed static vs normal blips vs power-ups
      if (this.isRadarJammed) {
        el.className = 'radar-blip';
        el.style.background = '#ff4400';
        el.style.boxShadow = '0 0 5px #ff4400';
      } else if (blip.isPowerUp) {
        if (blip.type === 'HULL') {
          el.className = 'radar-blip powerup-hull';
        } else {
          el.className = 'radar-blip powerup-shield';
        }
        el.style.background = '';
        el.style.boxShadow = '';
      } else {
        el.className = 'radar-blip';
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
    this.gameOverStats = stats; // Cache stats for upload

    this.goTime.innerText  = this._formatTime(stats.timeSurvived);
    this.goKills.innerText = stats.kills;

    // Load PBs from localStorage
    const pbTime = parseFloat(localStorage.getItem('pb_time') || '0');
    const pbKills = parseInt(localStorage.getItem('pb_kills') || '0');

    // Check if player beat their personal best
    let isNewPB = false;
    if (stats.kills > pbKills) {
      isNewPB = true;
    } else if (stats.kills === pbKills && stats.timeSurvived > pbTime) {
      isNewPB = true;
    }

    // Dynamic Leaderboard button
    if (this.leaderboardBtn) {
      if (isNewPB && stats.kills > 0) {
        this.leaderboardBtn.textContent = '[ SUBMIT SCORE ]';
      } else {
        this.leaderboardBtn.textContent = '[ VIEW LEADERBOARD ]';
      }
    }



    // Hide overlays by default
    if (this.leaderboardSubmitContainer) this.leaderboardSubmitContainer.style.display = 'none';
    if (this.leaderboardDisplayContainer) this.leaderboardDisplayContainer.style.display = 'none';

    const currentPBTime = isNewPB ? stats.timeSurvived : pbTime;
    const currentPBKills = isNewPB ? stats.kills : pbKills;

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
      const scanlinesEnabled = localStorage.getItem('setting_scanlines') === 'true'; // Default to false
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

  showCustomAlert(title, message, onOk = null, okLabel = '[ OK ]') {
    const overlay = document.getElementById('custom-dialog-overlay');
    const titleEl = document.getElementById('custom-dialog-title');
    const msgEl = document.getElementById('custom-dialog-message');
    const btnOk = document.getElementById('custom-dialog-btn-ok');
    const btnCancel = document.getElementById('custom-dialog-btn-cancel');

    if (!overlay) return;

    titleEl.innerText = title;
    msgEl.innerText = message;
    btnOk.innerText = okLabel;
    btnCancel.style.display = 'none';

    overlay.style.display = 'flex';

    const newBtnOk = btnOk.cloneNode(true);
    btnOk.parentNode.replaceChild(newBtnOk, btnOk);

    newBtnOk.addEventListener('click', () => {
      overlay.style.display = 'none';
      if (onOk) onOk();
    });
  }

  showCustomConfirm(title, message, onConfirm, onCancel = null, confirmLabel = '[ OK ]', cancelLabel = '[ CANCEL ]') {
    const overlay = document.getElementById('custom-dialog-overlay');
    const titleEl = document.getElementById('custom-dialog-title');
    const msgEl = document.getElementById('custom-dialog-message');
    const btnOk = document.getElementById('custom-dialog-btn-ok');
    const btnCancel = document.getElementById('custom-dialog-btn-cancel');

    if (!overlay) return;

    titleEl.innerText = title;
    msgEl.innerText = message;
    btnOk.innerText = confirmLabel;
    btnCancel.innerText = cancelLabel;
    btnCancel.style.display = 'inline-block';

    overlay.style.display = 'flex';

    const newBtnOk = btnOk.cloneNode(true);
    btnOk.parentNode.replaceChild(newBtnOk, btnOk);

    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    newBtnOk.addEventListener('click', () => {
      overlay.style.display = 'none';
      if (onConfirm) onConfirm();
    });

    newBtnCancel.addEventListener('click', () => {
      overlay.style.display = 'none';
      if (onCancel) onCancel();
    });
  }
}
