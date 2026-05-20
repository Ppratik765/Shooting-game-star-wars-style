import * as THREE from 'three';

export class EnemyManager {
  constructor(scene, particleSystem, playerShip) {
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.playerShip = playerShip;
    this.terrain = null;

    this.enemies = [];
    this.maxEnemies = 20;

    // Build translucent red wireframe TIE variants
    this.tieMeshes = this._buildWireframeTIEVariants();

    for (let i = 0; i < this.maxEnemies; i++) {
      const variantIdx = i % 4;
      const mesh = this.tieMeshes[variantIdx].clone();
      mesh.visible = false;
      this.scene.add(mesh);
      this.enemies.push({
        mesh,
        active: false,
        dying: false,         // NEW: projectile-motion death state
        dyingTimer: 0,
        hp: 5,
        maxHp: 5,
        velocity: new THREE.Vector3(),
        angularVel: new THREE.Vector3(), // tumble rotation during death
        radius: 12.0,
        id: i,
        variant: variantIdx,
        fireTimer: 0,
        fireInterval: 2.0 + Math.random() * 2.0,
        // Formation data
        formationOffset: new THREE.Vector3(),
        formationLeader: null,
        isLeader: false,
        wingmanIndex: 0,
        // AI state
        strategy: 'chase',
        predictedTargetPos: new THREE.Vector3(),
        evasionTimer: 0,
        evasionDir: new THREE.Vector3()
      });
    }

    this.spawnTimer = 0;
    this.spawnRate = 4.0;
    this.onEnemyKilled = null;
    this.onPlayerHit = null;

    // Diamond death markers — persist for session
    this.deathMarkers = [];
    this.markerMat = new THREE.SpriteMaterial({
      color: 0xffdd00,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    // Enemy projectile pool
    this.enemyProjectiles = [];
    this.maxEnemyProjectiles = 60;
    // Green horizontal cylinder bolts with irregularities
    const bulletGeom = new THREE.CylinderGeometry(0.5, 0.5, 12, 6, 3);
    bulletGeom.rotateX(-Math.PI / 2);  // align along -Z for lookAt
    // Add vertex displacement for imperfections
    const bPos = bulletGeom.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i);
      const y = bPos.getY(i);
      const dist = Math.sqrt(x * x + y * y);
      if (dist > 0.01) {
        const noise = 1.0 + (Math.random() - 0.5) * 0.2;
        bPos.setX(i, x * noise);
        bPos.setY(i, y * noise);
      }
    }
    bPos.needsUpdate = true;
    bulletGeom.computeVertexNormals();

    const bulletMat = new THREE.MeshBasicMaterial({
      color: 0x00ff44,
      transparent: true,
      opacity: 0.9
    });

    for (let i = 0; i < this.maxEnemyProjectiles; i++) {
      const mesh = new THREE.Mesh(bulletGeom, bulletMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.enemyProjectiles.push({
        mesh,
        active: false,
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 3.5
      });
    }
  }

  // Build translucent red wireframe TIE fighter meshes — massively cheaper than solid
  _buildWireframeTIEVariants() {
    const wireOpts = {
      wireframe: true,
      transparent: true,
      opacity: 0.7,
      color: 0xff2200
    };
    const makeWireMat = () => new THREE.MeshBasicMaterial({ ...wireOpts });
    const makeGlowMat = () => new THREE.MeshBasicMaterial({
      ...wireOpts,
      color: 0xff4400,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });

    const variants = [];

    // --- Variant 0: Standard TIE Fighter ---
    const tie0 = new THREE.Group();
    const sphere0 = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), makeWireMat());
    const window0 = new THREE.Mesh(new THREE.CircleGeometry(2.5, 6), makeGlowMat());
    window0.position.z = 5.1;
    tie0.add(sphere0, window0);
    const wingGeom0 = new THREE.CylinderGeometry(9.5, 9.5, 0.4, 6);
    const lw0 = new THREE.Mesh(wingGeom0, makeWireMat());
    lw0.rotation.z = Math.PI / 2; lw0.position.x = -8;
    const rw0 = new THREE.Mesh(wingGeom0, makeWireMat());
    rw0.rotation.z = Math.PI / 2; rw0.position.x = 8;
    const strutGeom0 = new THREE.CylinderGeometry(0.6, 0.6, 16, 4);
    const ls0 = new THREE.Mesh(strutGeom0, makeWireMat());
    ls0.rotation.z = Math.PI / 2;
    tie0.add(lw0, rw0, ls0);
    variants.push(tie0);

    // --- Variant 1: TIE Interceptor ---
    const tie1 = new THREE.Group();
    const hull1 = new THREE.Mesh(new THREE.SphereGeometry(4.5, 8, 6), makeWireMat());
    const win1 = new THREE.Mesh(new THREE.CircleGeometry(2, 6), makeGlowMat());
    win1.position.z = 4.6;
    tie1.add(hull1, win1);
    const wingShape1 = new THREE.Shape();
    wingShape1.moveTo(0, 10); wingShape1.lineTo(5, 0); wingShape1.lineTo(0, -10);
    wingShape1.lineTo(-5, 0); wingShape1.closePath();
    const wingGeomEx1 = new THREE.ExtrudeGeometry(wingShape1, { depth: 0.4, bevelEnabled: false });
    const lw1 = new THREE.Mesh(wingGeomEx1, makeWireMat());
    lw1.position.x = -7; lw1.rotation.y = Math.PI / 2;
    const rw1 = new THREE.Mesh(wingGeomEx1, makeWireMat());
    rw1.position.x = 7; rw1.rotation.y = Math.PI / 2;
    tie1.add(lw1, rw1);
    variants.push(tie1);

    // --- Variant 2: TIE Bomber (double hull) ---
    const tie2 = new THREE.Group();
    const hull2a = new THREE.Mesh(new THREE.SphereGeometry(4.5, 8, 6), makeWireMat());
    hull2a.position.x = -4;
    const hull2b = new THREE.Mesh(new THREE.CapsuleGeometry(3.5, 4, 6, 6), makeWireMat());
    hull2b.position.x = 5; hull2b.rotation.z = Math.PI / 2;
    const win2 = new THREE.Mesh(new THREE.CircleGeometry(1.8, 6), makeGlowMat());
    win2.position.set(-4, 0, 4.6);
    tie2.add(hull2a, hull2b, win2);
    const wingGeom2 = new THREE.CylinderGeometry(8.5, 8.5, 0.4, 6);
    const lw2 = new THREE.Mesh(wingGeom2, makeWireMat()); lw2.rotation.z = Math.PI / 2; lw2.position.x = -10;
    const rw2 = new THREE.Mesh(wingGeom2, makeWireMat()); rw2.rotation.z = Math.PI / 2; rw2.position.x = 12;
    tie2.add(lw2, rw2);
    variants.push(tie2);

    // --- Variant 3: TIE Advanced (bent wings) ---
    const tie3 = new THREE.Group();
    const hull3 = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), makeWireMat());
    const win3 = new THREE.Mesh(new THREE.CircleGeometry(2.5, 6), makeGlowMat());
    win3.position.z = 5.1;
    tie3.add(hull3, win3);
    const wingGeom3 = new THREE.BoxGeometry(0.4, 13, 6.5);
    const lw3 = new THREE.Mesh(wingGeom3, makeWireMat());
    lw3.position.set(-7, 0, 0); lw3.rotation.z = 0.3;
    const rw3 = new THREE.Mesh(wingGeom3, makeWireMat());
    rw3.position.set(7, 0, 0); rw3.rotation.z = -0.3;
    tie3.add(lw3, rw3);
    variants.push(tie3);

    return variants;
  }

  update(deltaTime) {
    this.spawnTimer += deltaTime;
    if (this.spawnTimer > this.spawnRate) {
      this._spawnFormation();
      this.spawnTimer = 0;
    }

    const playerPos  = this.playerShip.camera.position;
    const playerVel  = this.playerShip.velocity;
    const PREDICT_TIME = 2.5;

    for (let i = 0; i < this.maxEnemies; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      // === DYING STATE: projectile motion, tumble, crash ===
      if (enemy.dying) {
        enemy.dyingTimer += deltaTime;
        // Gravity pulls down hard so it crashes quickly
        enemy.velocity.y -= 250.0 * deltaTime;
        enemy.mesh.position.addScaledVector(enemy.velocity, deltaTime);
        // Tumble rotation
        enemy.mesh.rotation.x += enemy.angularVel.x * deltaTime;
        enemy.mesh.rotation.y += enemy.angularVel.y * deltaTime;
        enemy.mesh.rotation.z += enemy.angularVel.z * deltaTime;

        // Check terrain crash
        if (this.terrain) {
          const eH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
          if (enemy.mesh.position.y <= eH + 2) {
            // Crash into terrain!
            enemy.mesh.position.y = eH;
            this._crashEnemy(enemy);
            continue;
          }
        }
        // Timeout after 8 seconds
        if (enemy.dyingTimer > 8.0) {
          this._crashEnemy(enemy);
        }
        continue; // skip normal AI
      }

      // --- Predictive interception ---
      const distToPlayer = enemy.mesh.position.distanceTo(playerPos);
      const predictedPos = playerPos.clone().addScaledVector(playerVel, PREDICT_TIME);

      let targetPos = predictedPos.clone();

      if (enemy.formationLeader && enemy.formationLeader.active && !enemy.formationLeader.dying) {
        const leaderPos = enemy.formationLeader.mesh.position;
        const leaderFwd = new THREE.Vector3();
        enemy.formationLeader.mesh.getWorldDirection(leaderFwd);
        const leaderRight = new THREE.Vector3().crossVectors(leaderFwd, new THREE.Vector3(0, 1, 0)).normalize();
        targetPos = leaderPos.clone()
          .addScaledVector(leaderRight, enemy.formationOffset.x)
          .addScaledVector(new THREE.Vector3(0, 1, 0), enemy.formationOffset.y)
          .addScaledVector(leaderFwd, enemy.formationOffset.z);
      } else {
        if (enemy.strategy === 'high_alt') {
          targetPos.y = playerPos.y + 130;
        } else if (enemy.strategy === 'trench' && this.terrain) {
          const eH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
          targetPos.y = eH + 22;
        } else if (enemy.strategy === 'flanker') {
          const angle = Date.now() * 0.0008 + i * 1.3;
          targetPos.x += Math.sin(angle) * 120;
          targetPos.z += Math.cos(angle) * 120;
          targetPos.y = playerPos.y + 20;
        }
      }

      // Overshoot / Fly-by maneuver: if close and charging at the player, lock a straight trajectory to zoom past
      if (enemy.overshootTimer === undefined) {
        enemy.overshootTimer = 0;
        enemy.overshootDir = new THREE.Vector3();
      }

      if (distToPlayer < 250 && enemy.overshootTimer <= 0) {
        const toPlayer = new THREE.Vector3().subVectors(playerPos, enemy.mesh.position).normalize();
        const enemyFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.mesh.quaternion);
        if (enemyFwd.dot(toPlayer) > 0.3) {
          enemy.overshootTimer = 1.6 + Math.random() * 0.8; // Fly straight past for 1.6 to 2.4s
          enemy.overshootDir.copy(enemyFwd);
        }
      }

      if (enemy.overshootTimer > 0) {
        enemy.overshootTimer -= deltaTime;
        targetPos.copy(enemy.mesh.position).addScaledVector(enemy.overshootDir, 500);
      }

      // Terrain avoidance
      const lookAheadDist = 50;
      if (this.terrain) {
        const lookDir = targetPos.clone().sub(enemy.mesh.position).normalize();
        const lookAhead = enemy.mesh.position.clone().addScaledVector(lookDir, lookAheadDist);
        const terrainAhead = this.terrain.getHeightAt(lookAhead.x, lookAhead.z);
        if (lookAhead.y < terrainAhead + 30) {
          targetPos.y += 80;
        }
      }

      const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();

      // Evasion maneuver
      enemy.evasionTimer -= deltaTime;
      if (enemy.evasionTimer <= 0) {
        enemy.evasionTimer = 1.5 + Math.random() * 2.0;
        enemy.evasionDir.set(
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 1.5
        );
      }



      let baseSpeed = 150 + i * 1.5;
      if (enemy.strategy === 'interceptor') baseSpeed = 220;
      if (enemy.strategy === 'flanker')     baseSpeed = 180;

      const targetVelocity = dir.clone().multiplyScalar(baseSpeed);
      targetVelocity.addScaledVector(enemy.evasionDir, 12);
      enemy.velocity.lerp(targetVelocity, 2.5 * deltaTime);

      enemy.mesh.position.addScaledVector(enemy.velocity, deltaTime);
      if (enemy.velocity.lengthSq() > 0.01) {
        const lookTarget = enemy.mesh.position.clone().add(enemy.velocity.clone().normalize());
        enemy.mesh.lookAt(lookTarget);
      }

      // Terrain collision
      if (this.terrain) {
        const eH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
        if (enemy.mesh.position.y < eH + 3) {
          this.killEnemy(enemy, true);
          continue;
        }
      }

      // Despawn if too far
      if (distToPlayer > 1800) {
        enemy.active = false;
        enemy.mesh.visible = false;
        continue;
      }

      // Enemy shooting
      if (distToPlayer < 350) {
        enemy.fireTimer += deltaTime;
        if (enemy.fireTimer >= enemy.fireInterval) {
          enemy.fireTimer = 0;
          enemy.fireInterval = 1.5 + Math.random() * 2.5;
          this._enemyFire(enemy, playerPos, playerVel);
        }
      }
    }

    this._updateEnemyProjectiles(deltaTime);
  }

  _enemyFire(enemy, playerPos, playerVel) {
    const proj = this.enemyProjectiles.find(p => !p.active);
    if (!proj) return;

    proj.active = true;
    proj.age = 0;
    proj.mesh.position.copy(enemy.mesh.position);
    proj.mesh.visible = true;

    const bulletSpeed = 380;  // Faster enemy bullets
    const leadTime = enemy.mesh.position.distanceTo(playerPos) / bulletSpeed;
    const predictedPlayerPos = playerPos.clone().addScaledVector(playerVel, leadTime * 0.6);

    const aimDir = new THREE.Vector3().subVectors(predictedPlayerPos, enemy.mesh.position).normalize();

    const spread = 0.07; // Much more accurate than 0.22, but still misses sometimes
    aimDir.x += (Math.random() - 0.5) * spread;
    aimDir.y += (Math.random() - 0.5) * spread;
    aimDir.z += (Math.random() - 0.5) * spread;
    aimDir.normalize();

    proj.velocity.copy(aimDir).multiplyScalar(bulletSpeed);
    proj.mesh.lookAt(proj.mesh.position.clone().add(aimDir));
  }

  _updateEnemyProjectiles(deltaTime) {
    const playerPos = this.playerShip.camera.position;
    for (let i = 0; i < this.maxEnemyProjectiles; i++) {
      const p = this.enemyProjectiles[i];
      if (!p.active) continue;
      p.age += deltaTime;
      if (p.age > p.maxAge) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.velocity, deltaTime);

      const dist = p.mesh.position.distanceTo(playerPos);
      if (dist < 12) {
        p.active = false;
        p.mesh.visible = false;
        this.playerShip.hp -= 8;
        if (this.onPlayerHit) this.onPlayerHit();
      }
    }
  }

  _spawnFormation() {
    const playerPos  = this.playerShip.camera.position;
    const playerFwd  = new THREE.Vector3();
    this.playerShip.camera.getWorldDirection(playerFwd);

    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnRadius = 500 + Math.random() * 200;
    const spawnDir = new THREE.Vector3(
      Math.sin(spawnAngle),
      0,
      Math.cos(spawnAngle)
    );

    const basePos = playerPos.clone().addScaledVector(spawnDir, spawnRadius);
    basePos.y = playerPos.y + (Math.random() - 0.5) * 100 + 50;

    const formations = ['v_form', 'line', 'diamond', 'swarm'];
    const formType = formations[Math.floor(Math.random() * formations.length)];
    const count = 2 + Math.floor(Math.random() * 3);

    const freeEnemies = this.enemies.filter(e => !e.active).slice(0, count);
    if (freeEnemies.length === 0) return;

    const formOffsets = this._getFormationOffsets(formType, freeEnemies.length);

    const strategies = ['chase', 'high_alt', 'trench', 'flanker', 'interceptor'];
    const groupStrategy = strategies[Math.floor(Math.random() * strategies.length)];

    freeEnemies.forEach((enemy, s) => {
      const offset = formOffsets[s] || new THREE.Vector3();
      enemy.mesh.position.copy(basePos).add(offset);

      if (this.terrain) {
        const tH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
        enemy.mesh.position.y = Math.max(enemy.mesh.position.y, tH + 60);
      }

      enemy.hp = 5;
      enemy.maxHp = 5;
      enemy.active = true;
      enemy.dying = false;
      enemy.dyingTimer = 0;
      enemy.mesh.visible = true;
      enemy.fireTimer = Math.random() * 2;
      enemy.strategy = groupStrategy;
      enemy.evasionTimer = Math.random() * 2;
      enemy.velocity.set(0, 0, 0);
      enemy.angularVel.set(0, 0, 0);

      if (s === 0) {
        enemy.isLeader = true;
        enemy.formationLeader = null;
        enemy.formationOffset.set(0, 0, 0);
      } else {
        enemy.isLeader = false;
        enemy.formationLeader = freeEnemies[0];
        enemy.formationOffset.copy(formOffsets[s]);
      }
    });
  }

  _getFormationOffsets(formType, count) {
    const offsets = [new THREE.Vector3(0, 0, 0)];
    if (formType === 'v_form') {
      for (let i = 1; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        offsets.push(new THREE.Vector3(side * i * 25, -10 * i, 20 * i));
      }
    } else if (formType === 'line') {
      for (let i = 1; i < count; i++) {
        offsets.push(new THREE.Vector3(0, 0, i * 40));
      }
    } else if (formType === 'diamond') {
      const dOffsets = [
        new THREE.Vector3(35, 0, 20),
        new THREE.Vector3(-35, 0, 20),
        new THREE.Vector3(0, 0, 40)
      ];
      for (let i = 1; i < count; i++) offsets.push(dOffsets[i - 1] || new THREE.Vector3(i * 30, 0, 0));
    } else { // swarm
      for (let i = 1; i < count; i++) {
        offsets.push(new THREE.Vector3(
          (Math.random() - 0.5) * 120,
          (Math.random() - 0.5) * 60,
          (Math.random() - 0.5) * 120
        ));
      }
    }
    return offsets;
  }

  damageEnemy(enemy, amount) {
    if (!enemy.active || enemy.dying) return;
    enemy.hp -= amount;
    if (enemy.hp <= 0) this.killEnemy(enemy, false);
  }

  killEnemy(enemy, crashedIntoTerrain) {
    // Orphan any wingmen following this enemy
    for (const e of this.enemies) {
      if (e.formationLeader === enemy) {
        e.formationLeader = null;
        e.formationOffset.set(0, 0, 0);
      }
    }

    if (crashedIntoTerrain) {
      // Already at terrain — immediate crash
      this._crashEnemy(enemy);
    } else {
      // Enter dying state — projectile motion fall
      enemy.dying = true;
      enemy.dyingTimer = 0;
      // Throw the enemy forward faster than the player so the crash is visible
      const playerFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.playerShip.camera.quaternion);
      const pushSpeed = this.playerShip.velocity.length() + 150; // Fly ahead
      enemy.velocity.copy(playerFwd).multiplyScalar(pushSpeed);
      enemy.velocity.y -= 40; // Slight downward nudge to start falling
      // Random tumble angular velocity
      enemy.angularVel.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 4
      );
    }

    if (this.onEnemyKilled) this.onEnemyKilled();
  }

  _crashEnemy(enemy) {
    const crashPos = enemy.mesh.position.clone();

    // Deactivate
    enemy.active = false;
    enemy.dying = false;
    enemy.mesh.visible = false;

    // Ground explosion + shockwave
    this.particleSystem.spawnGroundExplosion(crashPos);
    this.particleSystem.spawnShockwave(crashPos, this.terrain);

    // Place diamond death marker
    this._placeDeathMarker(crashPos);
  }

  _placeDeathMarker(position) {
    // Create a small diamond sprite at crash location
    const sprite = new THREE.Sprite(this.markerMat.clone());
    sprite.position.copy(position);
    sprite.position.y += 3; // slightly above terrain
    sprite.scale.set(4, 4, 1);
    this.scene.add(sprite);
    this.deathMarkers.push(sprite);
  }

  getEnemies() { return this.enemies; }

  reset() {
    for (const e of this.enemies) {
      e.active = false;
      e.dying = false;
      e.dyingTimer = 0;
      e.mesh.visible = false;
      e.hp = 5;
      e.fireTimer = 0;
      e.formationLeader = null;
      e.velocity.set(0, 0, 0);
      e.angularVel.set(0, 0, 0);
    }
    for (const p of this.enemyProjectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
    // Clear death markers
    for (const marker of this.deathMarkers) {
      this.scene.remove(marker);
      marker.material.dispose();
    }
    this.deathMarkers.length = 0;
    this.spawnTimer = 0;
  }
}
