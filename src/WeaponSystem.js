import * as THREE from 'three';

export class WeaponSystem {
  constructor(scene, camera, enemyManager, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.enemyManager = enemyManager;
    this.uiManager = uiManager;


    // Charge system
    this.maxCharge = 100;
    this.charge = this.maxCharge;
    this.chargePerShot = 1.0;  // Was 2.5
    this.chargeRegenRate = 15; // Was 10
    this.chargeDepleted = false;

    // Targeting system
    this.projectileSpeed = 400; // Slower speed for better visibility
    this.fireRate = 0.12;
    this.lastFireTime = 0;
    this.lockedEnemy = null;

    // Object pool
    this.poolSize = 80; // Larger pool
    this.pool = [];

    const geom = new THREE.CapsuleGeometry(1.2, 15.0, 4, 8); // Length 15 as requested
    geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0xff6600, // Orange
      transparent: true,
      opacity: 1.0
    });

    for (let i = 0; i < this.poolSize; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      this.scene.add(mesh);

      // Add a small light to each projectile
      const light = new THREE.PointLight(0xff6600, 0, 80); // Intensity 0 initially
      this.scene.add(light);

      this.pool.push({
        mesh,
        light,
        active: false,
        velocity: new THREE.Vector3(),
        trackingTarget: null,
        age: 0,
        maxAge: 2.0
      });
    }

    this.raycaster = new THREE.Raycaster();
  }

  update(deltaTime, inputController, currentTime, playerVelocity) {
    // Charge regen
    if (!inputController.isFiring()) {
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * deltaTime);
    } else {
      // Slow regen even while firing
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * 0.3 * deltaTime);
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
        // Break lock if target is behind player
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

    // Update projectiles
    for (let i = 0; i < this.poolSize; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.age += deltaTime;
      if (p.age > p.maxAge) { this.deactivate(p); continue; }

      // Homing logic for locked shots
      if (p.trackingTarget && p.trackingTarget.active) {
        const targetDir = p.trackingTarget.mesh.position.clone().sub(p.mesh.position).normalize();
        // Snap to target for "all time" hit guarantee
        p.velocity.lerp(targetDir.multiplyScalar(this.projectileSpeed), 12 * deltaTime);
        p.mesh.lookAt(p.trackingTarget.mesh.position);
      }

      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.light.position.copy(p.mesh.position);
      this.checkCollisions(p);
    }
  }

  fire(playerVelocity) { // Accept player velocity
    const toSpawn = [];
    for (let i = 0; i < this.poolSize && toSpawn.length < 2; i++) {
      if (!this.pool[i].active) toSpawn.push(this.pool[i]);
    }
    if (toSpawn.length < 2) return;

    // Aim direction
    let aimDir;
    let target;

    if (this.lockedEnemy && this.lockedEnemy.active) {
      // Auto-aim at locked target
      target = this.lockedEnemy.mesh.position.clone();
      aimDir = target.clone().sub(this.camera.position).normalize();
    } else {
      // Standard crosshair aim
      const crosshairPos = this.uiManager.currentCrosshairPos;
      const ndcX = (crosshairPos.x / window.innerWidth) * 2 - 1;
      const ndcY = -(crosshairPos.y / window.innerHeight) * 2 + 1;
      
      this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
      aimDir = this.raycaster.ray.direction.clone();
      target = this.camera.position.clone().add(aimDir.clone().multiplyScalar(2000));
    }

    // Spawn positions offset from camera
    const offsetL = new THREE.Vector3(-6.0, -2.0, -5.0);
    const offsetR = new THREE.Vector3(6.0, -2.0, -5.0);
    offsetL.applyMatrix4(this.camera.matrixWorld);
    offsetR.applyMatrix4(this.camera.matrixWorld);

    // Initial muzzle velocity + Ship's current velocity
    const muzzleVel = aimDir.clone().multiplyScalar(this.projectileSpeed);
    const totalVel = muzzleVel.add(playerVelocity || new THREE.Vector3());

    // Left
    const pL = toSpawn[0];
    pL.active = true;
    pL.age = 0;
    pL.mesh.position.copy(offsetL);
    pL.mesh.visible = true;
    pL.velocity.copy(totalVel);
    pL.trackingTarget = this.lockedEnemy;
    pL.mesh.lookAt(target);
    pL.light.position.copy(offsetL);
    pL.light.intensity = 200;
    pL.light.distance = 150;

    // Right
    const pR = toSpawn[1];
    pR.active = true;
    pR.age = 0;
    pR.mesh.position.copy(offsetR);
    pR.mesh.visible = true;
    pR.velocity.copy(totalVel);
    pR.trackingTarget = this.lockedEnemy;
    pR.mesh.lookAt(target);
    pR.light.position.copy(offsetR);
    pR.light.intensity = 200;
    pR.light.distance = 150;
  }

  deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
    p.light.intensity = 0;
    p.trackingTarget = null;
  }

  checkCollisions(projectile) {
    const enemies = this.enemyManager.getEnemies();
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active) continue;
      const dist = projectile.mesh.position.distanceTo(enemy.mesh.position);
      if (dist < enemy.radius) {
        this.enemyManager.damageEnemy(enemy, 1);
        this.deactivate(projectile);
        return;
      }
    }
  }

  _attemptLock() {
    // Raycast from center of screen
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const enemies = this.enemyManager.getEnemies();
    
    let closestEnemy = null;
    let closestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy.active) continue;
      // Simple sphere intersection check for lock-on
      const distToShip = enemy.mesh.position.distanceTo(this.camera.position);
      if (distToShip > 1000) continue; // Too far to lock
      
      const sphere = new THREE.Sphere(enemy.mesh.position, enemy.radius * 3.0); // generous lock radius
      if (this.raycaster.ray.intersectsSphere(sphere)) {
        if (distToShip < closestDist) {
          closestDist = distToShip;
          closestEnemy = enemy;
        }
      }
    }

    if (closestEnemy) {
      if (this.lockedEnemy === closestEnemy) {
        this.lockedEnemy = null; // Toggle off if already locked
      } else {
        this.lockedEnemy = closestEnemy;
        this.uiManager.addLog('TARGET LOCKED');
      }
    } else {
      this.lockedEnemy = null; // Break lock if clicked empty space
    }
  }

  reset() {
    this.charge = this.maxCharge;
    this.chargeDepleted = false;
    this.lastFireTime = 0;
    this.lockedEnemy = null;
    for (const p of this.pool) this.deactivate(p);
  }

  getChargeState() {
    return {
      charge: this.charge,
      maxCharge: this.maxCharge,
      chargeDepleted: this.chargeDepleted
    };
  }
}
