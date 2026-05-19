import * as THREE from 'three';

export class PlayerShip {
  constructor(camera) {
    this.camera = camera;

    // Rotation
    this.pitch = 0;  // radians, positive = nose up
    this.yaw = 0;
    this.roll = 0;

    // Position & velocity
    this.velocity = new THREE.Vector3();
    this.camera.position.set(0, 110, 0); 
    this.isAboveMaxAlt = false;

    // Throttle & Speed
    this.minThrottle = 40;
    this.maxThrottle = 175; // Slightly slower as requested
    this.throttle = 100;

    // Physics constants
    this.gravity = -12; // Much lighter gravity
    this.turnSpeed = 1.5;

    // Stamina & Boost
    this.maxStamina = 100;
    this.stamina = this.maxStamina;
    this.staminaDrainRate = 30;
    this.staminaRegenRate = 15;
    this.isBoosting = false;
    this.staminaDepleted = false;

    // FOV
    this.baseFOV = 90;
    this.boostFOV = 120;
    this.targetFOV = this.baseFOV;

    // HP
    this.maxHp = 100;
    this.hp = this.maxHp;

    // Stall mechanic
    this.stallPitchThreshold = 0.8; // radians (~45 degrees)
    this.stallTimeRequired = 1.5;   // seconds above threshold
    this.stallTimer = 0;
    this.isStalled = false;
    this.stallRecoveryPitch = -0.3;

    // Terrain warnings
    this.terrainWarning = false;
    this.terrainCrashed = false;
    this.altitude = 0; // above terrain
  }

  update(deltaTime, inputController, terrain) {
    if (this.terrainCrashed) return;

    this._handleInput(deltaTime, inputController);
    this._updateStamina(deltaTime);
    this._updateStall(deltaTime);
    this._applyPhysics(deltaTime, inputController);
    this._updateCamera(deltaTime);
    this._checkTerrain(terrain, deltaTime);
  }

  _handleInput(deltaTime, input) {
    // Controls: W/S or Arrows for Pitch (Climb/Dive), Mouse for Aiming, A/D for Banking
    const mouseSensitivity = 0.0028; // Reduced slightly as requested
    
    // Pitch (up/down)
    this.pitch -= input.mouse.movementY * mouseSensitivity;
    if (input.isForward() || input.keys['ArrowUp']) {
        this.pitch += 1.2 * deltaTime; // Reduced slightly from 1.5
    }
    if (input.isBackward() || input.keys['ArrowDown']) {
        this.pitch -= 1.2 * deltaTime;
    }

    // Yaw (left/right) - Mouse X
    this.yaw -= input.mouse.movementX * mouseSensitivity;

    // Roll (banking) - A/D
    const rollSpeed = 2.5;
    if (input.isLeft()) {
      this.roll = THREE.MathUtils.lerp(this.roll, 1.0, rollSpeed * deltaTime);
      this.yaw += 0.8 * deltaTime;
    } else if (input.isRight()) {
      this.roll = THREE.MathUtils.lerp(this.roll, -1.0, rollSpeed * deltaTime);
      this.yaw -= 0.8 * deltaTime;
    } else {
      this.roll = THREE.MathUtils.lerp(this.roll, 0, 2.0 * deltaTime);
    }

    // Constant forward throttle (since W/S are now Pitch)
    this.throttle = 110; // Slower base speed as requested
    if (input.isBoosting() && !this.staminaDepleted) {
      this.isBoosting = true;
      this.targetFOV = this.boostFOV;
      this.throttle = 220;
    } else {
      this.isBoosting = false;
      this.targetFOV = this.baseFOV;
    }

    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.4, 1.4);
  }

  _updateStall(deltaTime) {
    if (this.pitch > this.stallPitchThreshold) {
      this.stallTimer += deltaTime;
      if (this.stallTimer >= this.stallTimeRequired) {
        this.isStalled = true;
      }
    } else {
      this.stallTimer = Math.max(0, this.stallTimer - deltaTime * 2);
      if (this.pitch < 0.3) {
        this.isStalled = false;
      }
    }

    // During stall: force nose down
    if (this.isStalled) {
      this.pitch = THREE.MathUtils.lerp(this.pitch, this.stallRecoveryPitch, 1.5 * deltaTime);
    }
  }

  _applyPhysics(deltaTime, input) {
    // Calculate forward vector from current orientation
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);

    // Aerodynamic flight model: velocity naturally wants to align with the nose
    const targetVelocity = forward.clone().multiplyScalar(this.throttle);

    // Snappy air grip (6.0) allows for rapid climbing and loops
    this.velocity.lerp(targetVelocity, 6.0 * deltaTime);

    // Gravity constantly pulls down
    this.velocity.y += this.gravity * deltaTime;

    // Apply movement
    this.camera.position.addScaledVector(this.velocity, deltaTime);
  }

  _updateStamina(deltaTime) {
    if (this.isBoosting) {
      this.stamina -= this.staminaDrainRate * deltaTime;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.staminaDepleted = true;
        this.isBoosting = false;
      }
    } else {
      this.stamina += this.staminaRegenRate * deltaTime;
      if (this.stamina >= this.maxStamina) this.stamina = this.maxStamina;
      if (this.staminaDepleted && this.stamina > this.maxStamina * 0.2) {
        this.staminaDepleted = false;
      }
    }
  }

  _updateCamera(deltaTime) {
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFOV, 8 * deltaTime);
    this.camera.updateProjectionMatrix();
  }

  _checkTerrain(terrain, deltaTime) {
    if (!terrain) return;
    const terrainHeight = terrain.getHeightAt(
      this.camera.position.x,
      this.camera.position.z
    );
    this.altitude = this.camera.position.y - terrainHeight;
    this.terrainWarning = this.altitude < 40;

    // Max altitude penalty
    this.isAboveMaxAlt = this.camera.position.y > 500;
    if (this.isAboveMaxAlt) {
      this.hp -= 5 * deltaTime; // Take damage above 500 altitude
    }

    if (this.altitude < 2) {
      this.terrainCrashed = true;
    }
  }

  reset() {
    this.camera.position.set(0, 110, 0);
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
    this.velocity.set(0, 0, 0);
    this.throttle = 100;
    this.stamina = this.maxStamina;
    this.staminaDepleted = false;
    this.isBoosting = false;
    this.isStalled = false;
    this.stallTimer = 0;
    this.terrainWarning = false;
    this.terrainCrashed = false;
    this.hp = this.maxHp;
    this.targetFOV = this.baseFOV;
    this.altitude = 200;
  }

  getState() {
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      stamina: this.stamina,
      maxStamina: this.maxStamina,
      isBoosting: this.isBoosting,
      staminaDepleted: this.staminaDepleted,
      speed: this.velocity.length(),
      hp: this.hp,
      maxHp: this.maxHp,
      isStalled: this.isStalled,
      terrainWarning: this.terrainWarning,
      terrainCrashed: this.terrainCrashed,
      altitude: this.altitude,
      isAboveMaxAlt: this.isAboveMaxAlt
    };
  }
}
