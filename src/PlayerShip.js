import * as THREE from 'three';

export class PlayerShip {
  constructor(camera) {
    this.camera = camera;

    // Rotation
    this.pitch = 0;  // radians, positive = nose up
    this.yaw = 0;
    this.roll = 0;

    // Position & velocity
    this.velocityY = 0;
    this.camera.position.set(0, 300, 0);

    // Forward speed (simulated via terrain scroll)
    this.baseSpeed = 60;
    this.boostSpeed = 140;
    this.currentSpeed = this.baseSpeed;
    this.distanceTraveled = 0;

    // Physics constants
    this.gravity = -18;
    this.liftForce = 80;      // W key lift — strong enough to climb
    this.nosediveForce = -25;  // S key push down
    this.strafeSpeed = 90;     // A/D lateral speed

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
    this._checkTerrain(terrain);
  }

  _handleInput(deltaTime, input) {
    // Mouse controls camera yaw and pitch
    const mouseSensitivity = 0.002;
    this.yaw -= input.mouse.movementX * mouseSensitivity;
    this.pitch -= input.mouse.movementY * mouseSensitivity;

    // Clamp pitch to prevent full flips
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.2, 1.2);

    // A/D: Roll visual + lateral strafe
    let rollTarget = 0;
    if (input.isLeft()) rollTarget = 0.5;
    if (input.isRight()) rollTarget = -0.5;
    this.roll = THREE.MathUtils.lerp(this.roll, rollTarget, 5 * deltaTime);

    // Boost
    if (input.isBoosting() && !this.staminaDepleted) {
      this.isBoosting = true;
      this.targetFOV = this.boostFOV;
      this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, this.boostSpeed, 5 * deltaTime);
    } else {
      this.isBoosting = false;
      this.targetFOV = this.baseFOV;
      this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, this.baseSpeed, 5 * deltaTime);
    }
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
    // Gravity always pulls down
    this.velocityY += this.gravity * deltaTime;

    // W = Lift (only if not stalled)
    if (input.isForward() && !this.isStalled) {
      this.velocityY += this.liftForce * deltaTime;
    }

    // S = Nosedive
    if (input.isBackward()) {
      this.velocityY += this.nosediveForce * deltaTime;
    }

    // Dampen vertical velocity slightly for stability
    this.velocityY *= 0.98;

    // Apply vertical movement
    this.camera.position.y += this.velocityY * deltaTime;

    // A/D: Lateral strafe
    if (input.isLeft()) {
      this.camera.position.x -= this.strafeSpeed * deltaTime;
    }
    if (input.isRight()) {
      this.camera.position.x += this.strafeSpeed * deltaTime;
    }

    // Forward distance (terrain scroll)
    this.distanceTraveled += this.currentSpeed * deltaTime;
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

  _checkTerrain(terrain) {
    if (!terrain) return;
    const terrainHeight = terrain.getHeightAt(
      this.camera.position.x,
      this.camera.position.z,
      this.distanceTraveled
    );
    this.altitude = this.camera.position.y - terrainHeight;
    this.terrainWarning = this.altitude < 40;
    if (this.altitude < 2) {
      this.terrainCrashed = true;
    }
  }

  reset() {
    this.camera.position.set(0, 300, 0);
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;
    this.velocityY = 0;
    this.currentSpeed = this.baseSpeed;
    this.distanceTraveled = 0;
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
      speed: this.currentSpeed,
      hp: this.hp,
      maxHp: this.maxHp,
      isStalled: this.isStalled,
      terrainWarning: this.terrainWarning,
      terrainCrashed: this.terrainCrashed,
      altitude: this.altitude
    };
  }
}
