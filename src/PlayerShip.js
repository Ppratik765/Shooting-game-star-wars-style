import * as THREE from 'three';
import init, { GameEngine, InputState } from '../pkg/core_engine.js';

// Top-level await for WASM initialization (supported by Vite via vite-plugin-top-level-await)
const wasm = await init();
const memory = wasm.memory;

export class PlayerShip {
  constructor(camera) {
    this.camera = camera;

    const rx = (Math.random() - 0.5) * 10000;
    const rz = (Math.random() - 0.5) * 10000;
    this.camera.position.set(rx, 500, rz);

    // Instantiate Rust GameEngine
    this.engine = new GameEngine(rx, rz);

    // Create Float32Array views into Wasm memory (Zero-overhead bridge)
    this.transformBuf = new Float32Array(memory.buffer, this.engine.get_transform_ptr(), 7);
    this.stateBuf = new Float32Array(memory.buffer, this.engine.get_state_ptr(), 18);
    this.velocityBuf = new Float32Array(memory.buffer, this.engine.get_velocity_ptr(), 3);

    // Input state object that we populate every frame
    this.inputState = new InputState();

    // Temporary object to maintain compatibility with GameManager.js which reads this.velocity
    this.velocity = new THREE.Vector3(0, 0, -140);
  }

  // --- Getters to read from Wasm shared memory (zero-overhead) ---
  
  // Transform Buf
  // 0=x, 1=y, 2=z, 3=pitch, 4=yaw, 5=roll, 6=targetFOV
  get pitch() { return this.transformBuf[3]; }
  get yaw() { return this.transformBuf[4]; }
  get roll() { return this.transformBuf[5]; }
  get targetFOV() { return this.transformBuf[6]; }

  // State Buf
  get hp() { return this.stateBuf[0]; }
  get maxHp() { return this.stateBuf[1]; }
  get stamina() { return this.stateBuf[2]; }
  get maxStamina() { return this.stateBuf[3]; }
  get isStalled() { return this.stateBuf[4] > 0; }
  get altitude() { return this.stateBuf[5]; }
  get speed() { return this.stateBuf[6]; }
  get isBoosting() { return this.stateBuf[7] > 0; }
  get staminaDepleted() { return this.stateBuf[8] > 0; }
  get terrainWarning() { return this.stateBuf[9] > 0; }
  get terrainCrashed() { return this.stateBuf[10] > 0; }
  get shieldActive() { return this.stateBuf[11] > 0; }
  get stallRecoveryProgress() { return this.stateBuf[12]; }
  get isAboveMaxAlt() { return this.stateBuf[13] > 0; }
  // 14=shakeAmplitude, 15=shakeProgress
  get isDying() { return this.stateBuf[16] > 0; }
  get throttle() { return this.stateBuf[17]; }

  // --- Setters to write to Wasm via proxy methods ---
  set hp(value) { this.engine.set_hp(value); }
  set shieldActive(value) { this.engine.set_shield_active(value); }
  set infiniteEnginesActive(value) { this.engine.set_infinite_engines_active(value); }
  set stallTimer(value) { this.engine.set_stall_timer(value); }
  set isStalled(value) { this.engine.set_is_stalled(value); }
  set yaw(value) { this.engine.set_yaw(value); }
  set pitch(value) { this.engine.set_pitch(value); }
  set roll(value) { this.engine.set_roll(value); }

  triggerShake(intensity = 1.0) {
    this.engine.trigger_shake(intensity);
  }

  die() {
    this.engine.die();
  }

  reset() {
    this.engine.reset();
    const rx = (Math.random() - 0.5) * 10000;
    const rz = (Math.random() - 0.5) * 10000;
    this.engine.set_pos(rx, 480, rz);
    this.camera.position.set(rx, 480, rz);
  }

  update(deltaTime, inputController, terrain, isIntro = false) {
    // Populate InputState
    this.inputState.is_mobile = inputController.isMobile;
    this.inputState.is_boosting = inputController.isBoosting();
    this.inputState.is_forward = inputController.isForward();
    this.inputState.is_backward = inputController.isBackward();
    this.inputState.is_left = inputController.isLeft();
    this.inputState.is_right = inputController.isRight();
    this.inputState.mouse_movement_x = inputController.mouse.movementX;
    this.inputState.mouse_movement_y = inputController.mouse.movementY;
    this.inputState.gyro_pitch_amt = inputController.gyroPitchAmt || 0;
    this.inputState.gyro_roll_amt = inputController.gyroRollAmt || 0;
    this.inputState.is_stalled_recovery_key = !!(inputController.keys && inputController.keys.Control);

    const terrainHeight = terrain ? terrain.getHeightAt(this.camera.position.x, this.camera.position.z) : 0;

    // Tick Wasm engine
    const shakeTriggered = this.engine.tick(deltaTime, this.inputState, terrainHeight, isIntro);

    // Sync back to Three.js camera/velocity
    this.camera.position.set(this.transformBuf[0], this.transformBuf[1], this.transformBuf[2]);
    this.velocity.set(this.velocityBuf[0], this.velocityBuf[1], this.velocityBuf[2]);
    
    // Update Camera rotation
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
    
    // Apply Shake
    const shakeAmplitude = this.stateBuf[14];
    if (shakeAmplitude > 0) {
      const shakeEuler = new THREE.Euler(
        (Math.random() - 0.5) * shakeAmplitude,
        (Math.random() - 0.5) * shakeAmplitude,
        (Math.random() - 0.5) * shakeAmplitude * 0.5,
        'YXZ'
      );
      this.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(shakeEuler));
    }

    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFOV, 8 * deltaTime);
    this.camera.updateProjectionMatrix();
  }

  getState() {
    return {
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      stamina: this.stamina, maxStamina: this.maxStamina,
      isBoosting: this.isBoosting, staminaDepleted: this.staminaDepleted,
      speed: this.speed,
      hp: this.hp, maxHp: this.maxHp,
      isStalled: this.isStalled,
      shieldActive: this.shieldActive,
      stallRecoveryProgress: this.stallRecoveryProgress,
      terrainWarning: this.terrainWarning, terrainCrashed: this.terrainCrashed,
      altitude: this.altitude, isAboveMaxAlt: this.isAboveMaxAlt
    };
  }
}