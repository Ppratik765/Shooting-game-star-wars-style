export class InputController {
  constructor() {
    this.keys = {
      w: false, a: false, s: false, d: false,
      ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false,
      Shift: false, ' ': false
    };

    this.mouse = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      movementX: 0, movementY: 0,
      isDown: false, rightDown: false,
      clickPulse: false
    };

    this.prevMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    // Per-frame accumulated mouse movement (capped)
    this._frameMovementX = 0;
    this._frameMovementY = 0;
    this._maxDeltaPerFrame = 80; // cap to prevent huge spikes

    // Mobile state
    this.isMobile  = this._detectMobile();
    this.gyro = { beta: 0, gamma: 0, alpha: 0 };
    this.gyroCalibrated = false;
    this.gyroBaseBeta  = 0;
    this.gyroBaseGamma = 0;
    this.gyroPitchAmt = 0;
    this.gyroRollAmt = 0;

    // Virtual joystick (mobile crosshair look)
    this.lookJoystick = {
      active: false, touchId: null,
      startX: 0, startY: 0,
      deltaX: 0, deltaY: 0
    };

    // Shoot button state
    this.mobileShoot = false;
    this.mobileBoost = false;

    this._initListeners();
    if (this.isMobile) {
      this._initMobileUI();
      this._initGyro();
    }
  }

  _detectMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.innerWidth < 1200);
  }

  _initMobileUI() {
    // Landscape orientation prompt
    const landscapeMsg = document.createElement('div');
    landscapeMsg.id = 'landscape-prompt';
    landscapeMsg.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#00ffaa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;">
        <rect x="22" y="8" width="20" height="36" rx="3" transform="rotate(-30 32 26)" stroke-dasharray="2 2" opacity="0.5" />
        <rect x="14" y="22" width="36" height="20" rx="3" />
        <line x1="18" y1="26" x2="18" y2="38" />
        <circle cx="46" cy="32" r="1.5" fill="#00ffaa" />
        <path d="M 44 14 A 18 18 0 0 1 50 32 L 53 28 M 50 32 L 45 31" />
        <path d="M 20 50 A 18 18 0 0 1 14 32 L 11 36 M 14 32 L 19 33" />
      </svg>
      <div>ROTATE DEVICE TO LANDSCAPE</div>
      <div style="font-size:18px; margin-top:10px; color:#ffb700; text-transform:uppercase;">
        FOR BEST DOGFIGHT EXPERIENCE
      </div>
      <div style="font-size:15px; margin-top:12px; color:#88ffcc; text-transform:uppercase; letter-spacing:1px; opacity:0.8;">
        (OR USE A DESKTOP FOR THE BEST EXPERIENCE)
      </div>
    `;
    document.body.appendChild(landscapeMsg);

    // Virtual HUD overlay
    const mobileHUD = document.createElement('div');
    mobileHUD.id = 'mobile-hud';
    mobileHUD.innerHTML = `
      <div id="mobile-joystick">
        <div id="mobile-joystick-knob"></div>
      </div>
      <div id="mobile-shoot-btn" aria-label="Fire">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 100, 0, 0.9)" stroke-width="2.5" style="filter: drop-shadow(0 0 8px rgba(255,100,0,0.5));">
          <path d="M12 2C10 5 9 8 9 12v7c0 1.1.9 2 2 2h2c1.1 0 2-.9 2-2v-7c0-4-1-7-3-10z" fill="rgba(255, 100, 0, 0.15)"/>
          <line x1="9" y1="15" x2="15" y2="15" />
          <line x1="9" y1="18" x2="15" y2="18" />
        </svg>
      </div>
      <div id="mobile-boost-btn">BOOST</div>
    `;
    document.body.appendChild(mobileHUD);
    this.mobileHUD = mobileHUD;

    // Wire up virtual joystick
    const joystick = document.getElementById('mobile-joystick');
    this.joystick = {
      active: false,
      touchId: null,
      startX: 0,
      startY: 0,
      normX: 0,
      normY: 0
    };

    joystick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      for (const t of e.changedTouches) {
        if (!this.joystick.active) {
          this.joystick.active = true;
          this.joystick.touchId = t.identifier;
          this.joystick.startX = centerX;
          this.joystick.startY = centerY;
          this._updateJoystickPos(t.clientX, t.clientY, rect.width / 2);
        }
      }
    }, { passive: false });

    joystick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const rect = joystick.getBoundingClientRect();
      for (const t of e.changedTouches) {
        if (t.identifier === this.joystick.touchId) {
          this._updateJoystickPos(t.clientX, t.clientY, rect.width / 2);
        }
      }
    }, { passive: false });

    const resetJoystick = (e) => {
      if (!this.joystick.active) return;
      if (e) {
        for (const t of e.changedTouches) {
          if (t.identifier === this.joystick.touchId) {
            this._resetJoystickState();
          }
        }
      } else {
        this._resetJoystickState();
      }
    };

    joystick.addEventListener('touchend', resetJoystick, { passive: false });
    joystick.addEventListener('touchcancel', resetJoystick, { passive: false });

    // Wire up shoot button
    const shootBtn = document.getElementById('mobile-shoot-btn');
    shootBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.mobileShoot = true;
    }, { passive: false });
    shootBtn.addEventListener('touchend', (e) => {
      e.preventDefault(); this.mobileShoot = false;
    }, { passive: false });
    shootBtn.addEventListener('touchcancel', (e) => {
      e.preventDefault(); this.mobileShoot = false;
    }, { passive: false });

    // Wire up boost button
    const boostBtn = document.getElementById('mobile-boost-btn');
    boostBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.mobileBoost = true;
    }, { passive: false });
    boostBtn.addEventListener('touchend', (e) => {
      e.preventDefault(); this.mobileBoost = false;
    }, { passive: false });
    boostBtn.addEventListener('touchcancel', (e) => {
      e.preventDefault(); this.mobileBoost = false;
    }, { passive: false });
  }

  _updateJoystickPos(clientX, clientY, maxRadius) {
    const dx = clientX - this.joystick.startX;
    const dy = clientY - this.joystick.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    let limitX = dx;
    let limitY = dy;
    
    if (dist > maxRadius) {
      limitX = (dx / dist) * maxRadius;
      limitY = (dy / dist) * maxRadius;
    }
    
    const knob = document.getElementById('mobile-joystick-knob');
    if (knob) {
      knob.style.transform = `translate(-50%, -50%) translate(${limitX}px, ${limitY}px)`;
    }
    
    this.joystick.normX = limitX / maxRadius;
    this.joystick.normY = limitY / maxRadius;
  }

  _resetJoystickState() {
    this.joystick.active = false;
    this.joystick.touchId = null;
    this.joystick.normX = 0;
    this.joystick.normY = 0;
    const knob = document.getElementById('mobile-joystick-knob');
    if (knob) {
      knob.style.transform = 'translate(-50%, -50%) translate(0px, 0px)';
    }
  }

  _initGyro() {
    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const banner = document.createElement('div');
      banner.style.cssText = `
        position:fixed; bottom:200px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.8); color:#00ffaa;
        font-family:'VT323',monospace; font-size:20px;
        padding:12px 24px; border:1px solid #00ffaa;
        border-radius:8px; z-index:9999; pointer-events:all; cursor:pointer;
        text-shadow:0 0 8px #00ffaa;
      `;
      banner.textContent = '[ TAP TO ENABLE GYROSCOPE ]';
      document.body.appendChild(banner);
      banner.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission().then(res => {
          if (res === 'granted') {
            window.addEventListener('deviceorientation', (e) => this._onGyro(e));
          }
          banner.remove();
        });
      });
    } else {
      window.addEventListener('deviceorientation', (e) => this._onGyro(e));
    }
  }

  _onGyro(e) {
    if (e.beta === null || e.gamma === null) return;

    if (!this.gyroCalibrated) {
      this.gyroBaseBeta  = e.beta;
      this.gyroBaseGamma = e.gamma;
      this.gyroCalibrated = true;
    }

    this.gyro.beta  = e.beta  || 0;
    this.gyro.gamma = e.gamma || 0;
    this.gyro.alpha = e.alpha || 0;

    let diffBeta = e.beta - this.gyroBaseBeta;
    let diffGamma = e.gamma - this.gyroBaseGamma;

    if (diffBeta > 180) diffBeta -= 360;
    if (diffBeta < -180) diffBeta += 360;
    if (diffGamma > 180) diffGamma -= 360;
    if (diffGamma < -180) diffGamma += 360;

    const orientation = window.orientation || (screen.orientation && screen.orientation.angle) || 0;

    let tiltPitch = 0;
    let tiltRoll = 0;

    if (orientation === 90) {
      tiltPitch = -diffGamma;
      tiltRoll = -diffBeta;
    } else if (orientation === -90 || orientation === 270) {
      tiltPitch = diffGamma;
      tiltRoll = diffBeta;
    } else {
      tiltPitch = -diffGamma;
      tiltRoll = -diffBeta;
    }

    const threshold = 6;

    this.mobileForward = false;
    this.mobileBackward = false;
    this.mobileLeft = false;
    this.mobileRight = false;

    if (tiltPitch > threshold) {
      this.mobileForward = true;
    } else if (tiltPitch < -threshold) {
      this.mobileBackward = true;
    }

    if (tiltRoll > threshold) {
      this.mobileLeft = true;
    } else if (tiltRoll < -threshold) {
      this.mobileRight = true;
    }

    // Continuous analog values for fluid flight yoke style controls
    const deadzone = 1.8; // degrees
    const maxTilt = 22.0; // degrees for full saturation

    let pitchAmt = 0;
    if (Math.abs(tiltPitch) > deadzone) {
      const sign = Math.sign(tiltPitch);
      pitchAmt = sign * Math.min(1.0, (Math.abs(tiltPitch) - deadzone) / (maxTilt - deadzone));
    }

    let rollAmt = 0;
    if (Math.abs(tiltRoll) > deadzone) {
      const sign = Math.sign(tiltRoll);
      rollAmt = sign * Math.min(1.0, (Math.abs(tiltRoll) - deadzone) / (maxTilt - deadzone));
    }

    this.gyroPitchAmt = pitchAmt;
    this.gyroRollAmt = rollAmt;
  }

  _initListeners() {
    window.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (Object.prototype.hasOwnProperty.call(this.keys, k)) {
        this.keys[k] = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (Object.prototype.hasOwnProperty.call(this.keys, k)) {
        this.keys[k] = false;
      }
    });

    window.addEventListener('blur', () => {
      for (const k in this.keys) {
        this.keys[k] = false;
      }
      this.mouse.isDown = false;
      this.mouse.rightDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isMobile) return;
      // Accumulate raw movement per frame — will be capped in consumeMovement()
      this._frameMovementX += (e.clientX - this.prevMouse.x);
      this._frameMovementY += (e.clientY - this.prevMouse.y);
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.prevMouse.x = e.clientX;
      this.prevMouse.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isMobile) return;
      if (e.button === 0) { this.mouse.isDown = true; this.mouse.clickPulse = true; }
      if (e.button === 2) { this.mouse.rightDown = true; this.mouse.clickPulse = true; }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isMobile) return;
      if (e.button === 0) this.mouse.isDown = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });

    // Passive one-shot Fullscreen trigger on first mobile interaction
    const triggerFS = () => {
      if (!this.isMobile) return;
      const docEl = document.documentElement;
      const isCurrentlyFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
      if (!isCurrentlyFullscreen) {
        const requestFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
        if (requestFS) {
          requestFS.call(docEl)
            .then(() => {
              // Successfully entered fullscreen, clean up listeners
              window.removeEventListener('touchstart', triggerFS);
              window.removeEventListener('click', triggerFS);
            })
            .catch(() => {
              // Ignore failure (e.g. requires click gesture first)
            });
        }
      }
    };

    window.addEventListener('touchstart', triggerFS, { passive: true });
    window.addEventListener('click', triggerFS, { passive: true });
  }

  // Called once per frame by GameManager BEFORE physics — caps and transfers accumulated input
  consumeMovement() {
    if (this.isMobile) {
      if (this.joystick && this.joystick.active) {
        // Move crosshair relative to joystick direction
        const joystickSpeed = 16.0; // responsive crosshair speed
        this.mouse.x += this.joystick.normX * joystickSpeed;
        this.mouse.y += this.joystick.normY * joystickSpeed;

        // Clamp to screen bounds
        this.mouse.x = Math.max(50, Math.min(window.innerWidth - 50, this.mouse.x));
        this.mouse.y = Math.max(50, Math.min(window.innerHeight - 50, this.mouse.y));

        // Use movement deltas for active locking & aiming algorithms
        this.mouse.movementX = this.joystick.normX * joystickSpeed;
        this.mouse.movementY = this.joystick.normY * joystickSpeed;
      } else {
        // Smoothly return crosshair to the exact center of screen
        const targetX = window.innerWidth / 2;
        const targetY = window.innerHeight / 2;
        const prevX = this.mouse.x;
        const prevY = this.mouse.y;

        this.mouse.x = THREE.MathUtils.lerp(this.mouse.x, targetX, 0.15);
        this.mouse.y = THREE.MathUtils.lerp(this.mouse.y, targetY, 0.15);

        this.mouse.movementX = this.mouse.x - prevX;
        this.mouse.movementY = this.mouse.y - prevY;
      }
      this._frameMovementX = 0;
      this._frameMovementY = 0;
    } else {
      // Desktop caps and transfers
      const cap = this._maxDeltaPerFrame;
      this.mouse.movementX = Math.max(-cap, Math.min(cap, this._frameMovementX));
      this.mouse.movementY = Math.max(-cap, Math.min(cap, this._frameMovementY));
      this._frameMovementX = 0;
      this._frameMovementY = 0;
    }
  }

  clearDeltas() {
    this.mouse.movementX = 0;
    this.mouse.movementY = 0;
  }

  calibrateGyro() {
    this.gyroCalibrated = false;
  }

  isForward()  { return this.keys.w || this.keys.ArrowUp || this.mobileForward; }
  isBackward() { return this.keys.s || this.keys.ArrowDown || this.mobileBackward; }
  isLeft()     { return this.keys.a || this.keys.ArrowLeft || this.mobileLeft; }
  isRight()    { return this.keys.d || this.keys.ArrowRight || this.mobileRight; }
  isBoosting() { return this.keys.Shift || this.mobileBoost; }
  isFiring()   { return this.keys[' '] || this.mouse.isDown || this.mobileShoot; }

  isLocking() {
    if (this.mouse.clickPulse) { this.mouse.clickPulse = false; return true; }
    return false;
  }
}
