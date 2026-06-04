export class InputController {
  constructor(isAutoplay = false) {
    this.isAutoplay = isAutoplay;
    this.keys = {};

    // Load settings from localStorage
    this.mouseSensitivity = parseFloat(localStorage.getItem('setting_mouse_sensitivity') || '1.0');
    this.invertY = localStorage.getItem('setting_invert_y') === 'true';

    this.keymap = {
      boost: 'Shift',
      fire: ' ',
      pitchDown: 'w',
      pitchUp: 's',
      rollLeft: 'a',
      rollRight: 'd'
    };

    const savedKeymap = localStorage.getItem('setting_keymap');
    if (savedKeymap) {
      try {
        const parsed = JSON.parse(savedKeymap);
        Object.assign(this.keymap, parsed);
      } catch (e) {
        console.warn('Failed to parse keymap settings', e);
      }
    }

    this.isRebinding = false;

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
    this._maxDeltaPerFrame = 80;

    // Mobile state
    this.isMobile = this._detectMobile();
    this.gyro = { beta: 0, gamma: 0, alpha: 0 };
    this.gyroCalibrated = false;
    this.gyroBaseBeta = 0;
    this.gyroBaseGamma = 0;

    // Analog gyro outputs — always initialized to 0, updated by gyro events
    this.gyroPitchAmt = 0;
    this.gyroRollAmt = 0;

    // Discrete gyro direction flags — always initialized to false
    this.mobileForward = false;
    this.mobileBackward = false;
    this.mobileLeft = false;
    this.mobileRight = false;

    // Virtual joystick state
    this.joystick = {
      active: false, touchId: null,
      startX: 0, startY: 0,
      normX: 0, normY: 0
    };

    // Action button states
    this.mobileShoot = false;
    this.mobileBoost = false;

    this._initListeners();
    if (this.isMobile && !this.isAutoplay) {
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
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 100, 0, 0.9)" stroke-width="2.5" style="filter: drop-shadow(0 0 8px rgba(255,100,0,0.5)); transform: rotate(-45deg);">
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

    // Shoot button
    const shootBtn = document.getElementById('mobile-shoot-btn');
    shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileShoot = true; }, { passive: false });
    shootBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.mobileShoot = false; }, { passive: false });
    shootBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); this.mobileShoot = false; }, { passive: false });

    // Boost button
    const boostBtn = document.getElementById('mobile-boost-btn');
    boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.mobileBoost = true; }, { passive: false });
    boostBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.mobileBoost = false; }, { passive: false });
    boostBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); this.mobileBoost = false; }, { passive: false });
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
    if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ permission banner
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
      this.gyroBaseBeta = e.beta;
      this.gyroBaseGamma = e.gamma;
      this.gyroCalibrated = true;
    }

    this.gyro.beta = e.beta || 0;
    this.gyro.gamma = e.gamma || 0;
    this.gyro.alpha = e.alpha || 0;

    let diffBeta = e.beta - this.gyroBaseBeta;
    let diffGamma = e.gamma - this.gyroBaseGamma;

    if (diffBeta > 180) diffBeta -= 360;
    if (diffBeta < -180) diffBeta += 360;
    if (diffGamma > 180) diffGamma -= 360;
    if (diffGamma < -180) diffGamma += 360;

    const orientation = window.orientation
      || (screen.orientation && screen.orientation.angle) || 0;

    let tiltPitch = 0;
    let tiltRoll = 0;

    if (orientation === 90) {
      tiltPitch = -diffGamma;
      tiltRoll = -diffBeta;
    } else if (orientation === -90 || orientation === 270) {
      tiltPitch = diffGamma;
      tiltRoll = diffBeta;
    } else if (orientation === 0 || orientation === 180) {
      tiltPitch = diffBeta;
      tiltRoll = -diffGamma;
    } else {
      tiltPitch = -diffGamma;
      tiltRoll = -diffBeta;
    }

    const threshold = 6;
    this.mobileForward = tiltPitch > threshold;
    this.mobileBackward = tiltPitch < -threshold;
    this.mobileLeft = tiltRoll > threshold;
    this.mobileRight = tiltRoll < -threshold;

    const deadzone = 1.8;
    const maxTilt = 22.0;

    const calcAmt = (val) => {
      if (Math.abs(val) <= deadzone) return 0;
      return Math.sign(val) * Math.min(1.0, (Math.abs(val) - deadzone) / (maxTilt - deadzone));
    };

    this.gyroPitchAmt = calcAmt(tiltPitch);
    this.gyroRollAmt = calcAmt(tiltRoll);
  }

  _initListeners() {
    window.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.isRebinding) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys[k] = true;
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys[k] = false;
    });

    window.addEventListener('blur', () => {
      for (const k in this.keys) this.keys[k] = false;
      this.mouse.isDown = false;
      this.mouse.rightDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isMobile) return;
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

    // One-shot fullscreen on first mobile interaction
    const triggerFS = () => {
      if (!this.isMobile || this.isAutoplay) return;
      window.removeEventListener('touchstart', triggerFS);
      window.removeEventListener('click', triggerFS);
      const docEl = document.documentElement;
      const already = document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement;
      if (!already) {
        const req = docEl.requestFullscreen
          || docEl.webkitRequestFullscreen
          || docEl.mozRequestFullScreen
          || docEl.msRequestFullscreen;
        if (req) req.call(docEl).catch(() => { });
      }
    };
    if (!this.isAutoplay) {
      window.addEventListener('touchstart', triggerFS, { passive: true });
      window.addEventListener('click', triggerFS, { passive: true });
    }
  }

  /**
   * Called once per frame by GameManager BEFORE physics.
   * On mobile: drives mouse.movementX/Y from the joystick if active,
   * otherwise zeroes them out — critically does NOT freeze anything.
   * The ship always has throttle; it never needs touch input to keep moving.
   */
  consumeMovement() {
    if (this.isMobile) {
      if (this.joystick.active) {
        const speed = 16.0;
        const newX = this.mouse.x + this.joystick.normX * speed;
        const newY = this.mouse.y + this.joystick.normY * speed;

        // Clamp to screen
        const clampedX = Math.max(50, Math.min(window.innerWidth - 50, newX));
        const clampedY = Math.max(50, Math.min(window.innerHeight - 50, newY));

        this.mouse.movementX = clampedX - this.mouse.x;
        this.mouse.movementY = clampedY - this.mouse.y;
        this.mouse.x = clampedX;
        this.mouse.y = clampedY;
      } else {
        // No joystick touch — crosshair stays put, NO movement delta
        // This is the key fix: we don't return 0 mouse pos, we just have 0 delta
        this.mouse.movementX = 0;
        this.mouse.movementY = 0;
        // Gently drift crosshair back to screen center (purely cosmetic)
        const targetX = window.innerWidth / 2;
        const targetY = window.innerHeight / 2;
        const lerpRate = 0.04; // very gentle — doesn't affect ship aim
        this.mouse.x += (targetX - this.mouse.x) * lerpRate;
        this.mouse.y += (targetY - this.mouse.y) * lerpRate;
      }
      // Reset accumulated frame deltas (not used on mobile)
      this._frameMovementX = 0;
      this._frameMovementY = 0;
    } else {
      // Desktop: cap and transfer accumulated raw mouse delta
      const cap = this._maxDeltaPerFrame;
      const ySign = this.invertY ? -1 : 1;
      this.mouse.movementX = Math.max(-cap, Math.min(cap, this._frameMovementX)) * this.mouseSensitivity;
      this.mouse.movementY = Math.max(-cap, Math.min(cap, this._frameMovementY)) * this.mouseSensitivity * ySign;
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

  startRebinding(action, onBindCallback) {
    this.isRebinding = true;

    const handleKey = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      this.keymap[action] = k;
      localStorage.setItem('setting_keymap', JSON.stringify(this.keymap));

      this.isRebinding = false;
      window.removeEventListener('keydown', handleKey, true);

      if (onBindCallback) onBindCallback(k);
    };

    window.addEventListener('keydown', handleKey, true);
  }

  // On mobile, keyboard keys are always false; gyro flags drive movement instead.
  // The ship always has a base throttle regardless — see PlayerShip._handleInput.
  isForward() {
    const bind = this.keymap.pitchDown;
    return this.keys[bind] || this.keys.ArrowUp || (this.isMobile && this.mobileForward);
  }
  isBackward() {
    const bind = this.keymap.pitchUp;
    return this.keys[bind] || this.keys.ArrowDown || (this.isMobile && this.mobileBackward);
  }
  isLeft() {
    const bind = this.keymap.rollLeft;
    return this.keys[bind] || this.keys.ArrowLeft || (this.isMobile && this.mobileLeft);
  }
  isRight() {
    const bind = this.keymap.rollRight;
    return this.keys[bind] || this.keys.ArrowRight || (this.isMobile && this.mobileRight);
  }
  isBoosting() {
    const bind = this.keymap.boost;
    return this.keys[bind] || this.mobileBoost;
  }
  isFiring() {
    const bind = this.keymap.fire;
    return this.keys[bind] || this.mouse.isDown || this.mobileShoot;
  }

  isLocking() {
    if (this.mouse.clickPulse) { this.mouse.clickPulse = false; return true; }
    return false;
  }
}