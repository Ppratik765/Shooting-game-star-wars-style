import * as THREE from 'three';

export class EnemyManager {
  constructor(scene, particleSystem, playerShip) {
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.playerShip = playerShip;
    this.terrain = null;

    this.enemies = [];
    this.maxEnemies = 20;

    // Build 4 TIE variant geometries
    this.tieGeometries = this._buildTIEVariants();

    for (let i = 0; i < this.maxEnemies; i++) {
      const variantIdx = i % 4;
      const mesh = this.tieGeometries[variantIdx].clone();
      mesh.visible = false;
      this.scene.add(mesh);
      this.enemies.push({
        mesh,
        active: false,
        hp: 5,
        maxHp: 5,
        velocity: new THREE.Vector3(),
        radius: 12.0,
        id: i,
        variant: variantIdx,
        fireTimer: 0,
        fireInterval: 2.0 + Math.random() * 2.0 // 2-4 seconds between shots
      });
    }

    this.spawnTimer = 0;
    this.spawnRate = 4.5;
    this.onEnemyKilled = null;

    // === Enemy Projectile Pool ===
    this.enemyProjectiles = [];
    this.maxEnemyProjectiles = 60;
    const bulletGeom = new THREE.SphereGeometry(0.6, 6, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green bolts

    for (let i = 0; i < this.maxEnemyProjectiles; i++) {
      const mesh = new THREE.Mesh(bulletGeom, bulletMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.enemyProjectiles.push({
        mesh,
        active: false,
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 3.0
      });
    }
  }

  _buildTIEVariants() {
    const mat = new THREE.LineBasicMaterial({ color: 0xaa0000 });
    const variants = [];

    // 0: Standard TIE Fighter
    const tie0 = new THREE.Group();
    tie0.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(5, 8, 8)), mat));
    const w0 = new THREE.EdgesGeometry(new THREE.CylinderGeometry(10, 10, 0.5, 8));
    const lw0 = new THREE.LineSegments(w0, mat); lw0.rotation.z = Math.PI / 2; lw0.position.x = -8;
    const rw0 = new THREE.LineSegments(w0, mat); rw0.rotation.z = Math.PI / 2; rw0.position.x = 8;
    const arm0 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.8, 0.8, 16, 4)), mat);
    arm0.rotation.z = Math.PI / 2;
    tie0.add(lw0, rw0, arm0);
    variants.push(tie0);

    // 1: TIE Interceptor — pointed wings
    const tie1 = new THREE.Group();
    tie1.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(4.5, 8, 8)), mat));
    const wingShape1 = new THREE.BufferGeometry();
    const v1 = new Float32Array([0,10,0, 5,0,2.5, 0,-10,0, -5,0,2.5, 0,10,0, -5,0,2.5, 0,-10,0, 5,0,2.5, 0,10,0, 0,-10,0, 5,0,2.5, -5,0,2.5]);
    wingShape1.setAttribute('position', new THREE.BufferAttribute(v1, 3));
    const lw1 = new THREE.LineSegments(wingShape1, mat); lw1.position.x = -7;
    const rw1 = new THREE.LineSegments(wingShape1, mat); rw1.position.x = 7;
    const arm1 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.8, 0.8, 14, 4)), mat);
    arm1.rotation.z = Math.PI / 2;
    tie1.add(lw1, rw1, arm1);
    variants.push(tie1);

    // 2: TIE Bomber — double hull
    const tie2 = new THREE.Group();
    const hull2a = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(5, 8, 8)), mat);
    hull2a.position.x = -4;
    const hull2b = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(6, 7, 7)), mat);
    hull2b.position.x = 4;
    const w2 = new THREE.EdgesGeometry(new THREE.CylinderGeometry(9, 9, 0.5, 8));
    const lw2 = new THREE.LineSegments(w2, mat); lw2.rotation.z = Math.PI / 2; lw2.position.x = -10;
    const rw2 = new THREE.LineSegments(w2, mat); rw2.rotation.z = Math.PI / 2; rw2.position.x = 12;
    tie2.add(hull2a, hull2b, lw2, rw2);
    variants.push(tie2);

    // 3: TIE Advanced — bent wings
    const tie3 = new THREE.Group();
    tie3.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(5, 10, 8)), mat));
    const w3 = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 14, 7));
    const lw3 = new THREE.LineSegments(w3, mat); lw3.position.set(-7, 0, 0); lw3.rotation.z = 0.3;
    const rw3 = new THREE.LineSegments(w3, mat); rw3.position.set(7, 0, 0); rw3.rotation.z = -0.3;
    const arm3 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.8, 0.8, 14, 4)), mat);
    arm3.rotation.z = Math.PI / 2;
    tie3.add(lw3, rw3, arm3);
    variants.push(tie3);

    return variants;
  }

  update(deltaTime) {
    this.spawnTimer += deltaTime;
    if (this.spawnTimer > this.spawnRate) {
      this._spawnSwarm();
      this.spawnTimer = 0;
    }

    const playerPos = this.playerShip.camera.position;

    for (let i = 0; i < this.maxEnemies; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      // AI behaviors
      let targetY = playerPos.y;
      if (enemy.strategy === 'high_alt') targetY = playerPos.y + 120;
      else if (enemy.strategy === 'trench' && this.terrain) {
        const eH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
        targetY = eH + 25; // Hug the ground
      }

      const targetPos = new THREE.Vector3(playerPos.x, targetY, playerPos.z);
      const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();
      
      const speed = 40 + Math.sin(Date.now() * 0.001 + i) * 10;
      enemy.velocity.copy(dir).multiplyScalar(speed);
      
      // Wobble
      enemy.velocity.x += Math.sin(Date.now() * 0.002 + i * 1.7) * 20;
      enemy.velocity.y += Math.cos(Date.now() * 0.0015 + i * 2.3) * 10;
      
      enemy.mesh.position.addScaledVector(enemy.velocity, deltaTime);
      enemy.mesh.lookAt(playerPos);

      // Terrain collision check for enemies
      if (this.terrain) {
        const eH = this.terrain.getHeightAt(
          enemy.mesh.position.x,
          enemy.mesh.position.z
        );
        if (enemy.mesh.position.y < eH + 3) {
          this.killEnemy(enemy, true);
          continue;
        }
      }

      // Despawn if too far from player
      const distToPlayer = enemy.mesh.position.distanceTo(playerPos);
      if (distToPlayer > 1500) {
        enemy.active = false;
        enemy.mesh.visible = false;
      }

      // === Enemy Shooting (Stormtrooper Aim) ===
      if (distToPlayer < 300) {
        enemy.fireTimer += deltaTime;
        if (enemy.fireTimer >= enemy.fireInterval) {
          enemy.fireTimer = 0;
          enemy.fireInterval = 1.5 + Math.random() * 2.5;
          this._enemyFire(enemy, playerPos);
        }
      }
    }

    // Update enemy projectiles
    this._updateEnemyProjectiles(deltaTime);
  }

  _enemyFire(enemy, playerPos) {
    // Find a free projectile
    const proj = this.enemyProjectiles.find(p => !p.active);
    if (!proj) return;

    proj.active = true;
    proj.age = 0;
    proj.mesh.position.copy(enemy.mesh.position);
    proj.mesh.visible = true;

    // Aim at player... but with terrible accuracy (stormtrooper style)
    const aimDir = new THREE.Vector3().subVectors(playerPos, enemy.mesh.position).normalize();

    // Add massive random spread — miss most of the time
    const spread = 0.35; // Higher = worse aim
    aimDir.x += (Math.random() - 0.5) * spread;
    aimDir.y += (Math.random() - 0.5) * spread;
    aimDir.z += (Math.random() - 0.5) * spread;
    aimDir.normalize();

    const bulletSpeed = 250;
    proj.velocity.copy(aimDir).multiplyScalar(bulletSpeed);
  }

  _updateEnemyProjectiles(deltaTime) {
    const playerPos = this.playerShip.camera.position;

    for (let i = 0; i < this.maxEnemyProjectiles; i++) {
      const p = this.enemyProjectiles[i];
      if (!p.active) continue;

      p.age += deltaTime;
      if (p.age > p.maxAge) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      p.mesh.position.addScaledVector(p.velocity, deltaTime);

      // Check if it hit the player (proximity)
      const dist = p.mesh.position.distanceTo(playerPos);
      if (dist < 8) {
        // Hit!
        p.active = false;
        p.mesh.visible = false;
        this.playerShip.hp -= 8;
        if (this.onPlayerHit) this.onPlayerHit();
      }
    }
  }

  _spawnSwarm() {
    const count = 2 + Math.floor(Math.random() * 2);
    const forward = new THREE.Vector3();
    this.playerShip.camera.getWorldDirection(forward);
    const basePos = this.playerShip.camera.position.clone()
      .add(forward.clone().multiplyScalar(450));

    for (let s = 0; s < count; s++) {
      const enemy = this.enemies.find(e => !e.active);
      if (!enemy) return;

      // Much wider spread
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 300 + s * 50,
        (Math.random() - 0.5) * 150 + 60,
        (Math.random() - 0.5) * 100
      );
      enemy.mesh.position.copy(basePos).add(offset);

      if (this.terrain) {
        const tH = this.terrain.getHeightAt(
          enemy.mesh.position.x,
          enemy.mesh.position.z
        );
        enemy.mesh.position.y = Math.max(enemy.mesh.position.y, tH + 40);
      }

      enemy.hp = 5;
      enemy.maxHp = 5;
      enemy.active = true;
      enemy.mesh.visible = true;
      enemy.fireTimer = 0;
      const strategies = ['chase', 'high_alt', 'trench'];
      enemy.strategy = strategies[Math.floor(Math.random() * strategies.length)];
    }
  }

  damageEnemy(enemy, amount) {
    if (!enemy.active) return;
    enemy.hp -= amount;
    if (enemy.hp <= 0) this.killEnemy(enemy, false);
  }

  killEnemy(enemy, crashedIntoTerrain) {
    enemy.active = false;
    enemy.mesh.visible = false;
    if (crashedIntoTerrain) {
      this.particleSystem.spawnGroundExplosion(enemy.mesh.position);
    } else {
      this.particleSystem.spawnAirburst(enemy.mesh.position);
    }
    if (this.onEnemyKilled) this.onEnemyKilled();
  }

  getEnemies() { return this.enemies; }

  reset() {
    for (const e of this.enemies) {
      e.active = false;
      e.mesh.visible = false;
      e.hp = 5;
      e.fireTimer = 0;
    }
    for (const p of this.enemyProjectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.spawnTimer = 0;
  }
}
