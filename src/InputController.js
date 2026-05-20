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

    // Mobile state
    this.isMobile  = this._detectMobile();
    this.gyro = { beta: 0, gamma: 0, alpha: 0 };
    this.gyroCalibrated = false;
    this.gyroBaseBeta  = 0;
    this.gyroBaseGamma = 0;

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
      <div style="
        position:fixed; top:0; left:0; width:100vw; height:100vh;
        background:#000; color:#00ffaa; display:flex; flex-direction:column;
        align-items:center; justify-content:center; z-index:9999;
        font-family:'VT323',monospace; font-size:28px; text-align:center;
        padding:20px; text-shadow: 0 0 10px #00ffaa;
      ">
        <div style="font-size:60px; margin-bottom:20px;">📱↔️</div>
        <div>ROTATE DEVICE TO LANDSCAPE</div>
        <div style="font-size:18px; margin-top:10px; color:#ffb700;">
          FOR BEST DOGFIGHT EXPERIENCE
        </div>
      </div>
    `;
    document.body.appendChild(landscapeMsg);
    this.landscapePrompt = landscapeMsg;
    this._checkOrientation();
    window.addEventListener('orientationchange', () => this._checkOrientation());
    window.addEventListener('resize', () => this._checkOrientation());

    // Virtual HUD overlay
    const mobileHUD = document.createElement('div');
    mobileHUD.id = 'mobile-hud';
    mobileHUD.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 50; pointer-events: none;
    `;
    mobileHUD.innerHTML = `
      <!-- Left side: look joystick area -->
      <div id="mobile-look-zone" style="
        position:absolute; left:0; top:0; width:50%; height:100%;
        pointer-events:all;
      "></div>

      <!-- Shoot button: bottom right -->
      <div id="mobile-shoot-btn" style="
        position:absolute; right:30px; bottom:80px;
        width:90px; height:90px; border-radius:50%;
        background: radial-gradient(circle, rgba(255,100,0,0.4), rgba(255,50,0,0.15));
        border: 3px solid rgba(255,100,0,0.8);
        display:flex; align-items:center; justify-content:center;
        color:#ff6600; font-family:'VT323',monospace; font-size:22px;
        text-shadow: 0 0 10px #ff6600;
        box-shadow: 0 0 20px rgba(255,100,0,0.5);
        pointer-events:all; user-select:none;
      ">FIRE</div>

      <!-- Boost button: bottom right, above fire -->
      <div id="mobile-boost-btn" style="
        position:absolute; right:140px; bottom:80px;
        width:70px; height:70px; border-radius:50%;
        background: radial-gradient(circle, rgba(0,150,255,0.3), rgba(0,100,255,0.1));
        border: 2px solid rgba(0,150,255,0.7);
        display:flex; align-items:center; justify-content:center;
        color:#0088ff; font-family:'VT323',monospace; font-size:16px;
        text-shadow: 0 0 10px #0088ff;
        box-shadow: 0 0 15px rgba(0,150,255,0.4);
        pointer-events:all; user-select:none;
      ">BOOST</div>

      <!-- Gyro calibrate hint -->
      <div id="gyro-hint" style="
        position:absolute; top:55px; right:15px;
        color:rgba(255,183,0,0.6); font-family:'VT323',monospace; font-size:14px;
        text-align:right; line-height:1.4; pointer-events:none;
      ">
        TILT TO FLY<br>TAP LEFT TO AIM
      </div>

      <!-- Lock button: top-left area of look zone -->
      <div id="mobile-lock-btn" style="
        position:absolute; left:20px; top:20px;
        width:65px; height:65px; border-radius:8px;
        background: rgba(255,0,0,0.15);
        border: 2px solid rgba(255,0,0,0.6);
        display:flex; align-items:center; justify-content:center;
        color:#ff2200; font-family:'VT323',monospace; font-size:14px;
        text-shadow: 0 0 8px #ff2200;
        pointer-events:all; user-select:none;
      ">LOCK</div>
    `;
    document.body.appendChild(mobileHUD);
    this.mobileHUD = mobileHUD;

    // Wire up shoot button
    const shootBtn = document.getElementById('mobile-shoot-btn');
    shootBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.mobileShoot = true;
    }, { passive: false });
    shootBtn.addEventListener('touchend', (e) => {
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

    // Wire up lock button
    const lockBtn = document.getElementById('mobile-lock-btn');
    lockBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.mouse.clickPulse = true;
    }, { passive: false });

    // Look joystick (left half of screen)
    const lookZone = document.getElementById('mobile-look-zone');
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (!this.lookJoystick.active) {
          this.lookJoystick.active  = true;
          this.lookJoystick.touchId = t.identifier;
          this.lookJoystick.startX  = t.clientX;
          this.lookJoystick.startY  = t.clientY;
          this.lookJoystick.deltaX  = 0;
          this.lookJoystick.deltaY  = 0;
        }
      }
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookJoystick.touchId) {
          const dx = t.clientX - this.lookJoystick.startX;
          const dy = t.clientY - this.lookJoystick.startY;
          this.lookJoystick.deltaX = dx;
          this.lookJoystick.deltaY = dy;
          // Update mouse position so crosshair moves
          this.mouse.movementX += dx * 0.6;
          this.mouse.movementY += dy * 0.6;
          this.mouse.x = t.clientX;
          this.mouse.y = t.clientY;
          // Reset start for relative delta
          this.lookJoystick.startX = t.clientX;
          this.lookJoystick.startY = t.clientY;
        }
      }
    }, { passive: false });

    lookZone.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.lookJoystick.touchId) {
          this.lookJoystick.active  = false;
          this.lookJoystick.touchId = null;
          this.lookJoystick.deltaX  = 0;
          this.lookJoystick.deltaY  = 0;
        }
      }
    }, { passive: false });
  }

  _checkOrientation() {
    if (!this.landscapePrompt) return;
    const isPortrait = window.innerHeight > window.innerWidth;
    this.landscapePrompt.style.display = isPortrait ? 'flex' : 'none';
  }

  _initGyro() {
    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // Show a tap-to-enable banner
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
    if (!this.gyroCalibrated && e.beta !== null) {
      this.gyroBaseBeta  = e.beta;
      this.gyroBaseGamma = e.gamma;
      this.gyroCalibrated = true;
    }
    this.gyro.beta  = e.beta  || 0;
    this.gyro.gamma = e.gamma || 0;
    this.gyro.alpha = e.alpha || 0;

    // Map gyro to mouse movement deltas for flight control
    if (this.gyroCalibrated) {
      const pitchDelta = (this.gyro.beta  - this.gyroBaseBeta)  * 0.012;
      const yawDelta   = (this.gyro.gamma - this.gyroBaseGamma) * 0.012;
      // Gyro controls ship orientation via mouse movement simulation
      this.mouse.movementY += pitchDelta * 12;
      this.mouse.movementX += yawDelta   * 12;
    }
  }

  _initListeners() {
    window.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (Object.prototype.hasOwnProperty.call(this.keys, e.key)) {
        this.keys[e.key] = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (Object.prototype.hasOwnProperty.call(this.keys, e.key)) {
        this.keys[e.key] = false;
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.movementX = e.clientX - this.prevMouse.x;
      this.mouse.movementY = e.clientY - this.prevMouse.y;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.prevMouse.x = e.clientX;
      this.prevMouse.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.isDown = true; this.mouse.clickPulse = true; }
      if (e.button === 2) { this.mouse.rightDown = true; this.mouse.clickPulse = true; }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.isDown = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
  }

  clearDeltas() {
    this.mouse.movementX = 0;
    this.mouse.movementY = 0;
  }

  isForward()  { return this.keys.w || this.keys.ArrowUp; }
  isBackward() { return this.keys.s || this.keys.ArrowDown; }
  isLeft()     { return this.keys.a || this.keys.ArrowLeft; }
  isRight()    { return this.keys.d || this.keys.ArrowRight; }
  isBoosting() { return this.keys.Shift || this.mobileBoost; }
  isFiring()   { return this.keys[' '] || this.mouse.isDown || this.mobileShoot; }

  isLocking() {
    if (this.mouse.clickPulse) { this.mouse.clickPulse = false; return true; }
    return false;
  }
}
