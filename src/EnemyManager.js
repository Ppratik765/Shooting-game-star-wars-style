import * as THREE from 'three';

export class EnemyManager {
  constructor(scene, particleSystem, playerShip, isMobile = false) {
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.playerShip = playerShip;
    this.terrain = null;
    this.isMobile = isMobile;

    this.enemies = [];
    this.maxEnemies = isMobile ? 12 : 20;

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
        evasionDir: new THREE.Vector3(),
        // Spatial flyby state machine
        flybyState: 'approach',
        flybyOffset: new THREE.Vector3(),
        turnTimer: 0,
        retreatTarget: new THREE.Vector3(),
        turnTarget: new THREE.Vector3()
      });
    }

    this.spawnTimer = 0;
    this.spawnRate = 4.0;
    this.onEnemyKilled = null;
    this.onEnemyCrashed = null;
    this.onPlayerHit = null;

    // Diamond death markers — persist for session
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.lineTo(64, 32);
    ctx.lineTo(32, 64);
    ctx.lineTo(0, 32);
    ctx.closePath();
    ctx.fill();
    const markerTex = new THREE.CanvasTexture(canvas);

    this.deathMarkers = [];
    this.markerMat = new THREE.SpriteMaterial({
      map: markerTex,
      color: 0xffdd00,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    // Enemy projectile pool
    this.enemyProjectiles = [];
    this.maxEnemyProjectiles = isMobile ? 30 : 60;
    // Green horizontal cylinder bolts with irregularities
    const bulletSegs = isMobile ? 4 : 6;
    const bulletGeom = new THREE.CylinderGeometry(0.5, 0.5, 12, bulletSegs, isMobile ? 1 : 3);
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
      color: 0xff6600,
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

      // --- Flyby AI State Machine (runs spatial sweeps, avoids collisions) ---
      const distToPlayer = enemy.mesh.position.distanceTo(playerPos);
      let targetPos = new THREE.Vector3();

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
        // Spatial flyby state transitions
        if (!enemy.flybyState) {
          enemy.flybyState = 'approach';
        }

        if (enemy.flybyState === 'approach') {
          // Check if we passed the player or are very close and starting to move away
          const toPlayerVec = playerPos.clone().sub(enemy.mesh.position);
          const toPlayerDir = toPlayerVec.clone().normalize();
          const movingAway = enemy.velocity.dot(toPlayerDir) < -10;

          if (distToPlayer < 90 || (distToPlayer < 180 && movingAway)) {
            enemy.flybyState = 'retreat';
            // Fly straight past and way away
            const heading = enemy.velocity.clone().normalize();
            if (heading.lengthSq() < 0.1) {
              enemy.mesh.getWorldDirection(heading);
            }
            enemy.retreatTarget.copy(enemy.mesh.position).addScaledVector(heading, 800);
          }
        } else if (enemy.flybyState === 'retreat') {
          if (distToPlayer > 600) {
            enemy.flybyState = 'turn';
            enemy.turnTimer = 2.0 + Math.random() * 1.5;

            // Wide sweep target towards the player direction but offset to circle
            const toPlayerVec = playerPos.clone().sub(enemy.mesh.position);
            const perp = new THREE.Vector3(0, 1, 0).cross(toPlayerVec).normalize();
            enemy.turnTarget.copy(enemy.mesh.position)
              .addScaledVector(perp, 250)
              .addScaledVector(toPlayerVec.normalize(), 200);
          }
        } else if (enemy.flybyState === 'turn') {
          enemy.turnTimer -= deltaTime;
          if (enemy.turnTimer <= 0) {
            enemy.flybyState = 'approach';
            // Compute a safe perpendicular offset of 55-85 units to avoid contact
            const toPlayerVec = playerPos.clone().sub(enemy.mesh.position);
            const toPlayerDir = toPlayerVec.clone().normalize();
            let perp = new THREE.Vector3(0, 1, 0).cross(toPlayerDir).normalize();
            if (perp.lengthSq() < 0.01) {
              perp = new THREE.Vector3(1, 0, 0).cross(toPlayerDir).normalize();
            }
            const angle = Math.random() * Math.PI * 2;
            perp.applyAxisAngle(toPlayerDir, angle);
            const offsetRadius = 55 + Math.random() * 30;
            enemy.flybyOffset.copy(perp).multiplyScalar(offsetRadius);
          }
        }

        // Apply Target Positions
        if (enemy.flybyState === 'approach') {
          if (enemy.flybyOffset.lengthSq() === 0) {
            const toPlayerVec = playerPos.clone().sub(enemy.mesh.position);
            const toPlayerDir = toPlayerVec.clone().normalize();
            let perp = new THREE.Vector3(0, 1, 0).cross(toPlayerDir).normalize();
            if (perp.lengthSq() < 0.01) {
              perp = new THREE.Vector3(1, 0, 0).cross(toPlayerDir).normalize();
            }
            const angle = Math.random() * Math.PI * 2;
            perp.applyAxisAngle(toPlayerDir, angle);
            const offsetRadius = 55 + Math.random() * 30;
            enemy.flybyOffset.copy(perp).multiplyScalar(offsetRadius);
          }
          targetPos.copy(playerPos).add(enemy.flybyOffset);
        } else if (enemy.flybyState === 'retreat') {
          targetPos.copy(enemy.retreatTarget);
        } else if (enemy.flybyState === 'turn') {
          targetPos.copy(enemy.turnTarget);
        }
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



      let baseSpeed = 145 + i * 1.5; // High energy flyby speeds
      if (this.isMobile) {
        baseSpeed *= 0.85;
      }

      const targetVelocity = dir.clone().multiplyScalar(baseSpeed);
      targetVelocity.addScaledVector(enemy.evasionDir, 12);
      enemy.velocity.lerp(targetVelocity, 1.4 * deltaTime);

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
      if (distToPlayer < 700) {
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

    const spread = 0.16; // Stormtrooper aim: cinematic misses (worsened slightly)
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

    // Bias spawns to be in front of the player (within FOV)
    const isForwardSpawn = Math.random() < 0.85; // 85% in front, 15% anywhere
    let spawnDir = new THREE.Vector3();
    if (isForwardSpawn) {
      const playerFwdH = new THREE.Vector3(playerFwd.x, 0, playerFwd.z).normalize();
      const offsetAngle = (Math.random() - 0.5) * (140 * Math.PI / 180); // +/- 70 degrees offset
      spawnDir.copy(playerFwdH).applyAxisAngle(new THREE.Vector3(0, 1, 0), offsetAngle).normalize();
    } else {
      const spawnAngle = Math.random() * Math.PI * 2;
      spawnDir.set(Math.sin(spawnAngle), 0, Math.cos(spawnAngle));
    }

    const spawnRadius = 500 + Math.random() * 200;
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
      
      enemy.flybyState = 'approach';
      enemy.flybyOffset.set(0, 0, 0);
      enemy.turnTimer = 0;

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

    // Trigger ground contact crash explosion sound
    if (this.onEnemyCrashed) this.onEnemyCrashed(crashPos);

    // Place diamond death marker
    this._placeDeathMarker(crashPos);
  }

  _placeDeathMarker(position) {
    // Create a large diamond sprite at crash location
    const sprite = new THREE.Sprite(this.markerMat.clone());
    sprite.position.copy(position);
    sprite.position.y += 10; // slightly above terrain
    sprite.scale.set(12, 12, 1);
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
      e.flybyState = 'approach';
      e.flybyOffset.set(0, 0, 0);
      e.turnTimer = 0;
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
