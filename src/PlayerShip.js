import * as THREE from 'three';

export class PlayerShip {
  constructor(camera) {
    this.camera = camera;

    this.pitch = -0.05;
    this.yaw = 0;
    this.roll = 0;

    this.velocity = new THREE.Vector3(0, 0, -140);
    const rx = (Math.random() - 0.5) * 10000;
    const rz = (Math.random() - 0.5) * 10000;
    this.camera.position.set(rx, 480, rz);
    this.isAboveMaxAlt = false;

    this.minThrottle = 60;
    this.maxThrottle = 260;
    // Base throttle — always applied on mobile so the game is always in motion
    this.throttle = 140;

    this.gravity = -12;
    this.turnSpeed = 1.5;

    // Stamina / boost
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

    // Stall
    this.stallPitchThreshold = 0.8;
    this.stallTimeRequired = 1.5;
    this.stallTimer = 0;
    this.isStalled = false;
    this.stallRecoveryPitch = -0.3;

    // Death state
    this.isDying = false;
    this.dieFromHigh = false;

    // Terrain
    this.terrainWarning = false;
    this.terrainCrashed = false;
    this.altitude = 0;

    // Camera shake
    this.shakeTimer = 0;
    this.shakeDuration = 0.22;
    this.shakeIntensity = 0.0;
  }

  triggerShake(intensity = 1.0) {
    this.shakeTimer = this.shakeDuration;
    this.shakeIntensity = intensity;
  }

  die() {
    if (this.isDying) return;
    this.isDying = true;
    this.dieFromHigh = this.altitude > 800;
    this.velocity.y -= this.dieFromHigh ? 250 : 80;
  }

  update(deltaTime, inputController, terrain, isIntro = false) {
    if (this.isDying) {
      const speedMult = this.dieFromHigh ? 3.5 : 1.2;
      this.pitch = THREE.MathUtils.lerp(this.pitch, -Math.PI / 2, 3.0 * speedMult * deltaTime);
      this.roll += 6.0 * speedMult * deltaTime;
      this.velocity.y -= 800 * speedMult * deltaTime;

      const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
      const targetVelocity = forward.clone().multiplyScalar(this.throttle * (this.dieFromHigh ? 3.0 : 1.5));
      this.velocity.lerp(targetVelocity, 3.5 * deltaTime);

      this.camera.position.addScaledVector(this.velocity, deltaTime);
      this._updateCamera(deltaTime);
      this._updateShake(deltaTime);
      this._checkTerrain(terrain, deltaTime);
      return;
    }

    if (this.terrainCrashed) return;

    if (isIntro) {
      this.pitch = THREE.MathUtils.lerp(this.pitch, 0, 2.0 * deltaTime);
      this.roll = THREE.MathUtils.lerp(this.roll, 0, 2.0 * deltaTime);
      // Always keep moving during intro
      this.throttle = inputController.isMobile ? 125 : 140;
      this.targetFOV = this.baseFOV;
      this._updateStamina(deltaTime);
      this._applyPhysics(deltaTime);
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, 350, 4.0 * deltaTime);
      this._updateCamera(deltaTime);
      return;
    }

    this._handleInput(deltaTime, inputController);
    this._updateStamina(deltaTime);
    this._updateStall(deltaTime);
    this._applyPhysics(deltaTime);
    this._updateCamera(deltaTime);
    this._updateShake(deltaTime);
    this._checkTerrain(terrain, deltaTime);
  }

  _handleInput(deltaTime, input) {
    if (input.isMobile) {
      // ── MOBILE FLIGHT ──────────────────────────────────────────────
      // Gyro controls pitch and roll/yaw when available.
      // When no gyro is active (gyroPitchAmt === 0, gyroRollAmt === 0)
      // the ship flies perfectly straight — it does NOT stall or stop.

      const gyroPitchSpeed = 1.35;
      const gyroYawSpeed = 1.25;
      const gyroRollSpeed = 3.5;

      // Pitch: gyro tilt or keyboard (if somehow connected)
      const pitchInput = input.gyroPitchAmt || 0;
      this.pitch += pitchInput * gyroPitchSpeed * deltaTime;

      // Roll & Yaw: gyro tilt
      const rollInput = input.gyroRollAmt || 0;
      if (Math.abs(rollInput) > 0.02) {
        this.roll = THREE.MathUtils.lerp(this.roll, rollInput * 1.1, gyroRollSpeed * deltaTime);
        this.yaw += rollInput * gyroYawSpeed * deltaTime;
      } else {
        // No tilt: smoothly level out
        this.roll = THREE.MathUtils.lerp(this.roll, 0, 3.0 * deltaTime);
      }

      // ── THROTTLE: always set, never zero ──────────────────────────
      // The ship ALWAYS moves forward at base throttle on mobile.
      // Boost doubles it. Nothing can set throttle to 0.
      this.throttle = 125; // base — always applied
      if (input.isBoosting() && !this.staminaDepleted) {
        this.isBoosting = true;
        this.targetFOV = this.baseFOV + 20;
        this.throttle = 310;
      } else {
        this.isBoosting = false;
        this.targetFOV = this.baseFOV;
      }

    } else {
      // ── DESKTOP FLIGHT ─────────────────────────────────────────────
      const mouseSensitivity = 0.0028;

      this.pitch -= input.mouse.movementY * mouseSensitivity;
      if (input.isForward()) this.pitch += 1.2 * deltaTime;
      if (input.isBackward()) this.pitch -= 1.2 * deltaTime;

      this.yaw -= input.mouse.movementX * mouseSensitivity;

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

      this.throttle = 140;
      if (input.isBoosting() && !this.staminaDepleted) {
        this.isBoosting = true;
        this.targetFOV = this.baseFOV + 20;
        this.throttle = 360;
      } else {
        this.isBoosting = false;
        this.targetFOV = this.baseFOV;
      }
    }

    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.4, 1.4);
  }

  _updateStall(deltaTime) {
    if (this.pitch > this.stallPitchThreshold) {
      this.stallTimer += deltaTime;
      if (this.stallTimer >= this.stallTimeRequired) this.isStalled = true;
    } else {
      this.stallTimer = Math.max(0, this.stallTimer - deltaTime * 2);
      if (this.pitch < 0.3) this.isStalled = false;
    }
    if (this.isStalled) {
      this.pitch = THREE.MathUtils.lerp(this.pitch, this.stallRecoveryPitch, 1.5 * deltaTime);
    }
  }

  _applyPhysics(deltaTime) {
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    const targetVelocity = forward.clone().multiplyScalar(this.throttle);
    this.velocity.lerp(targetVelocity, 6.0 * deltaTime);
    this.velocity.y += this.gravity * deltaTime;
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

  _updateShake(deltaTime) {
    if (this.shakeTimer > 0) {
      this.shakeTimer -= deltaTime;
      const progress = this.shakeTimer / this.shakeDuration;
      const amplitude = this.shakeIntensity * progress * 0.04;
      const shakeEuler = new THREE.Euler(
        (Math.random() - 0.5) * amplitude,
        (Math.random() - 0.5) * amplitude,
        (Math.random() - 0.5) * amplitude * 0.5,
        'YXZ'
      );
      this.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(shakeEuler));
    }
  }

  _checkTerrain(terrain, deltaTime) {
    if (!terrain) return;
    const terrainHeight = terrain.getHeightAt(this.camera.position.x, this.camera.position.z);
    this.altitude = this.camera.position.y - terrainHeight;
    this.terrainWarning = this.altitude < 60;
    this.isAboveMaxAlt = this.camera.position.y > 1500;
    if (this.isAboveMaxAlt) this.hp -= 5 * deltaTime;
    if (this.altitude < 2) this.terrainCrashed = true;
  }

  reset() {
    const rx = (Math.random() - 0.5) * 10000;
    const rz = (Math.random() - 0.5) * 10000;
    this.camera.position.set(rx, 480, rz);
    this.pitch = 0; this.yaw = 0; this.roll = 0;
    this.velocity.set(0, 0, -140); // start with forward momentum on reset too
    this.throttle = 140;
    this.stamina = this.maxStamina;
    this.staminaDepleted = false;
    this.isBoosting = false;
    this.isStalled = false;
    this.isDying = false;
    this.dieFromHigh = false;
    this.stallTimer = 0;
    this.terrainWarning = false;
    this.terrainCrashed = false;
    this.hp = this.maxHp;
    this.targetFOV = this.baseFOV;
    this.altitude = 200;
    this.shakeTimer = 0;
  }

  getState() {
    return {
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      stamina: this.stamina, maxStamina: this.maxStamina,
      isBoosting: this.isBoosting, staminaDepleted: this.staminaDepleted,
      speed: this.velocity.length(),
      hp: this.hp, maxHp: this.maxHp,
      isStalled: this.isStalled,
      terrainWarning: this.terrainWarning, terrainCrashed: this.terrainCrashed,
      altitude: this.altitude, isAboveMaxAlt: this.isAboveMaxAlt
    };
  }
}