import * as THREE from 'three';

export class WeaponSystem {
  constructor(scene, camera, enemyManager, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.enemyManager = enemyManager;
    this.uiManager = uiManager;

    // Charge system
    this.maxCharge = 80;   // Slightly less max capacity as requested
    this.charge = this.maxCharge;
    this.chargePerShot = 1.2;
    this.chargeRegenRate = 14;
    this.chargeDepleted = false;

    // Targeting system
    this.projectileSpeed = 900;  // Lasers are light — very fast and perfectly straight
    this.fireRate = 0.10;
    this.lastFireTime = 0;
    this.lockedEnemy = null;

    // Object pool
    this.poolSize = 80;
    this.pool = [];

    // Laser bolt geometry: long thin cylinder (energy bolt look)
    const geom = new THREE.CylinderGeometry(0.35, 0.35, 28, 6, 1);
    geom.rotateX(Math.PI / 2); // align along Z axis

    // Each projectile gets its own material for per-projectile glow
    for (let i = 0; i < this.poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      this.scene.add(mesh);

      // Glow sprite overlay for bolt
      const glowMat = new THREE.SpriteMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(3, 30, 1);
      glow.visible = false;
      this.scene.add(glow);

      const light = new THREE.PointLight(0xff5500, 0, 60);
      this.scene.add(light);

      this.pool.push({
        mesh, glow, light,
        active: false,
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        trackingTarget: null,
        age: 0,
        maxAge: 2.5
      });
    }

    this.raycaster = new THREE.Raycaster();
  }

  update(deltaTime, inputController, currentTime, playerVelocity) {
    // Charge regen
    if (!inputController.isFiring()) {
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * deltaTime);
    } else {
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * 0.25 * deltaTime);
    }

    if (this.chargeDepleted && this.charge > this.maxCharge * 0.25) {
      this.chargeDepleted = false;
    }

    // Target Locking
    if (inputController.isLocking()) {
      this._attemptLock();
    }

    // Verify lock is still valid
    if (this.lockedEnemy) {
      if (!this.lockedEnemy.active) {
        this.lockedEnemy = null;
      } else {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const toEnemy = this.lockedEnemy.mesh.position.clone().sub(this.camera.position).normalize();
        if (toEnemy.dot(forward) < 0) {
          this.lockedEnemy = null;
          this.uiManager.addLog('LOCK LOST - TARGET OUT OF VIEW', 'warning');
        }
      }
    }

    // Firing
    const canFire = !this.chargeDepleted && this.charge > 0;
    if (inputController.isFiring() && canFire && currentTime - this.lastFireTime > this.fireRate) {
      this.fire(playerVelocity);
      this.lastFireTime = currentTime;
      this.charge -= this.chargePerShot;
      if (this.charge <= 0) {
        this.charge = 0;
        this.chargeDepleted = true;
      }
    }

    // Update projectiles — perfectly straight, no homing (lasers = light)
    for (let i = 0; i < this.poolSize; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.age += deltaTime;
      if (p.age > p.maxAge) { this._deactivate(p); continue; }

      // Pure straight-line movement — lasers don't curve
      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.glow.position.copy(p.mesh.position);
      p.light.position.copy(p.mesh.position);

      this._checkCollisions(p);
    }
  }

  fire(playerVelocity) {
    // Find two free projectiles
    const toSpawn = [];
    for (let i = 0; i < this.poolSize && toSpawn.length < 2; i++) {
      if (!this.pool[i].active) toSpawn.push(this.pool[i]);
    }
    if (toSpawn.length < 2) return;

    // Aim direction — always perfectly straight from camera center
    let aimDir;

    if (this.lockedEnemy && this.lockedEnemy.active) {
      aimDir = this.lockedEnemy.mesh.position.clone().sub(this.camera.position).normalize();
    } else {
      // Use crosshair NDC position
      const crosshairPos = this.uiManager.currentCrosshairPos;
      const ndcX = (crosshairPos.x / window.innerWidth) * 2 - 1;
      const ndcY = -(crosshairPos.y / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
      aimDir = this.raycaster.ray.direction.clone().normalize();
    }

    // Laser velocity: straight line, no player velocity added (lasers = pure light speed)
    const laserVel = aimDir.clone().multiplyScalar(this.projectileSpeed);

    // Spawn from extreme left/right edges of the screen in world space
    // Project screen-edge points into world space at a near distance
    const near = 5.0; // distance from camera for spawn
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const camUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camFwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Extreme left/right: push to screen edge using FOV math
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = window.innerWidth / window.innerHeight;
    const halfW  = Math.tan(fovRad * 0.5) * aspect * near;
    const halfH  = Math.tan(fovRad * 0.5) * near * 0.05; // Slightly below center

    // Left laser origin: left edge of screen, slight below center
    const originL = this.camera.position.clone()
      .addScaledVector(camFwd, near)
      .addScaledVector(camRight, -halfW)
      .addScaledVector(camUp, -halfH);

    // Right laser origin: right edge of screen, slight below center
    const originR = this.camera.position.clone()
      .addScaledVector(camFwd, near)
      .addScaledVector(camRight, halfW)
      .addScaledVector(camUp, -halfH);

    this._activateProjectile(toSpawn[0], originL, laserVel, aimDir);
    this._activateProjectile(toSpawn[1], originR, laserVel, aimDir);
  }

  _activateProjectile(p, origin, velocity, direction) {
    p.active = true;
    p.age = 0;

    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    // Orient mesh along travel direction
    const target = origin.clone().add(direction);
    p.mesh.lookAt(target);
    p.mesh.rotateX(Math.PI / 2); // re-align cylinder

    p.glow.position.copy(origin);
    p.glow.visible = true;

    p.velocity.copy(velocity);
    p.direction.copy(direction);
    p.trackingTarget = null;

    p.light.position.copy(origin);
    p.light.intensity = 120;
    p.light.distance = 80;
  }

  _deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
    p.glow.visible = false;
    p.light.intensity = 0;
    p.trackingTarget = null;
  }

  _checkCollisions(projectile) {
    const enemies = this.enemyManager.getEnemies();
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active) continue;
      const dist = projectile.mesh.position.distanceTo(enemy.mesh.position);
      if (dist < enemy.radius) {
        this.enemyManager.damageEnemy(enemy, 1);
        this._deactivate(projectile);
        return;
      }
    }
  }

  _attemptLock() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const enemies = this.enemyManager.getEnemies();
    let closestEnemy = null;
    let closestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy.active) continue;
      const distToShip = enemy.mesh.position.distanceTo(this.camera.position);
      if (distToShip > 1000) continue;
      const sphere = new THREE.Sphere(enemy.mesh.position, enemy.radius * 3.0);
      if (this.raycaster.ray.intersectsSphere(sphere)) {
        if (distToShip < closestDist) {
          closestDist = distToShip;
          closestEnemy = enemy;
        }
      }
    }

    if (closestEnemy) {
      if (this.lockedEnemy === closestEnemy) {
        this.lockedEnemy = null;
      } else {
        this.lockedEnemy = closestEnemy;
        this.uiManager.addLog('TARGET LOCKED');
      }
    } else {
      this.lockedEnemy = null;
    }
  }

  reset() {
    this.charge = this.maxCharge;
    this.chargeDepleted = false;
    this.lastFireTime = 0;
    this.lockedEnemy = null;
    for (const p of this.pool) this._deactivate(p);
  }

  getChargeState() {
    return {
      charge: this.charge,
      maxCharge: this.maxCharge,
      chargeDepleted: this.chargeDepleted
    };
  }
}
