import * as THREE from 'three';

export class WeaponSystem {
  constructor(scene, camera, enemyManager, uiManager) {
    this.scene = scene;
    this.camera = camera;
    this.enemyManager = enemyManager;
    this.uiManager = uiManager;

    this.projectileSpeed = 500;
    this.fireRate = 0.12;
    this.lastFireTime = 0;

    // Charge system
    this.maxCharge = 100;
    this.charge = this.maxCharge;
    this.chargePerShot = 2.5;
    this.chargeRegenRate = 10;
    this.chargeDepleted = false;

    // Object pool
    this.poolSize = 50;
    this.pool = [];

    const geom = new THREE.CapsuleGeometry(0.8, 10.0, 4, 8);
    geom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    for (let i = 0; i < this.poolSize; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.pool.push({
        mesh,
        active: false,
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 2.5
      });
    }

    this.raycaster = new THREE.Raycaster();
  }

  update(deltaTime, inputController, currentTime) {
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

    // Firing
    const canFire = !this.chargeDepleted && this.charge > 0;
    if (inputController.isFiring() && canFire && currentTime - this.lastFireTime > this.fireRate) {
      this.fire();
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
      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      this.checkCollisions(p);
    }
  }

  fire() {
    const toSpawn = [];
    for (let i = 0; i < this.poolSize && toSpawn.length < 2; i++) {
      if (!this.pool[i].active) toSpawn.push(this.pool[i]);
    }
    if (toSpawn.length < 2) return;

    // Get aim direction from crosshair screen position
    const crosshairPos = this.uiManager.currentCrosshairPos;
    const ndcX = (crosshairPos.x / window.innerWidth) * 2 - 1;
    const ndcY = -(crosshairPos.y / window.innerHeight) * 2 + 1;

    // Unproject to get aim direction
    const aimTarget = new THREE.Vector3(ndcX, ndcY, 0.5);
    aimTarget.unproject(this.camera);
    const aimDir = aimTarget.sub(this.camera.position).normalize();
    const target = this.camera.position.clone().add(aimDir.clone().multiplyScalar(1000));

    // Spawn positions offset from camera
    const offsetL = new THREE.Vector3(-10.0, -2.5, -4.0);
    const offsetR = new THREE.Vector3(10.0, -2.5, -4.0);
    offsetL.applyMatrix4(this.camera.matrixWorld);
    offsetR.applyMatrix4(this.camera.matrixWorld);

    // Left
    const pL = toSpawn[0];
    pL.active = true;
    pL.age = 0;
    pL.mesh.position.copy(offsetL);
    pL.mesh.visible = true;
    pL.velocity.subVectors(target, offsetL).normalize().multiplyScalar(this.projectileSpeed);
    pL.mesh.lookAt(target);

    // Right
    const pR = toSpawn[1];
    pR.active = true;
    pR.age = 0;
    pR.mesh.position.copy(offsetR);
    pR.mesh.visible = true;
    pR.velocity.subVectors(target, offsetR).normalize().multiplyScalar(this.projectileSpeed);
    pR.mesh.lookAt(target);
  }

  deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
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

  reset() {
    this.charge = this.maxCharge;
    this.chargeDepleted = false;
    this.lastFireTime = 0;
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
