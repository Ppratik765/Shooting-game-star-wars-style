export class InputController {
  constructor() {
    this.keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      ArrowUp: false,
      ArrowLeft: false,
      ArrowDown: false,
      ArrowRight: false,
      Shift: false,
      ' ': false // Space
    };

    this.mouse = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      movementX: 0,
      movementY: 0,
      isDown: false,
      rightDown: false
    };

    // Keep track of previous mouse position for deltas if pointer lock isn't used
    this.prevMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    this._initListeners();
  }

  _initListeners() {
    window.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = true;
      }
      if (e.key === 'Shift') this.keys.Shift = true; // handle specific case
    });

    window.addEventListener('keyup', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = false;
      }
      if (e.key === 'Shift') this.keys.Shift = false;
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
      if (e.button === 0) {
        this.mouse.isDown = true;
        this.mouse.clickPulse = true;
      }
      if (e.button === 2) {
        this.mouse.rightDown = true;
        this.mouse.clickPulse = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.isDown = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
  }

  // Clear frame-specific inputs like movement deltas
  clearDeltas() {
    this.mouse.movementX = 0;
    this.mouse.movementY = 0;
  }

  isForward() {
    return this.keys.w || this.keys.ArrowUp;
  }

  isBackward() {
    return this.keys.s || this.keys.ArrowDown;
  }

  isLeft() {
    return this.keys.a || this.keys.ArrowLeft;
  }

  isRight() {
    return this.keys.d || this.keys.ArrowRight;
  }

  isBoosting() {
    return this.keys.Shift;
  }

  isFiring() {
    return this.keys[' '];
  }

  isLocking() {
    if (this.mouse.clickPulse) {
      this.mouse.clickPulse = false;
      return true;
    }
    return false;
  }

  // Clear frame-specific inputs like movement deltas
  clearDeltas() {
    this.mouse.movementX = 0;
    this.mouse.movementY = 0;
  }

  isForward() {
    return this.keys.w || this.keys.ArrowUp;
  }

  isBackward() {
    return this.keys.s || this.keys.ArrowDown;
  }

  isLeft() {
    return this.keys.a || this.keys.ArrowLeft;
  }

  isRight() {
    return this.keys.d || this.keys.ArrowRight;
  }

  isBoosting() {
    return this.keys.Shift;
  }

  isFiring() {
    return this.keys[' '] || this.mouse.isDown;
  }
}
