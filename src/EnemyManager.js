import * as THREE from 'three';

export class EnemyManager {
  constructor(scene, particleSystem, playerShip) {
    this.scene = scene;
    this.particleSystem = particleSystem;
    this.playerShip = playerShip;
    this.terrain = null;

    this.enemies = [];
    this.maxEnemies = 20;

    // Build opaque/solid TIE variant meshes (not wireframe)
    this.tieMeshes = this._buildSolidTIEVariants();

    for (let i = 0; i < this.maxEnemies; i++) {
      const variantIdx = i % 4;
      const mesh = this.tieMeshes[variantIdx].clone();
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

    // Enemy projectile pool
    this.enemyProjectiles = [];
    this.maxEnemyProjectiles = 60;
    // Slightly larger, glowing green bolts
    const bulletGeom = new THREE.CylinderGeometry(0.5, 0.5, 8, 5);
    bulletGeom.rotateX(Math.PI / 2);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });

    for (let i = 0; i < this.maxEnemyProjectiles; i++) {
      const mesh = new THREE.Mesh(bulletGeom, bulletMat);
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

  // Build solid (opaque) TIE fighter meshes instead of wireframes
  _buildSolidTIEVariants() {
    const hullMat = new THREE.MeshPhongMaterial({
      color: 0x333355,
      emissive: 0x110022,
      shininess: 60,
      side: THREE.FrontSide
    });
    const wingMat = new THREE.MeshPhongMaterial({
      color: 0x222244,
      emissive: 0x0a0018,
      shininess: 40,
      transparent: true,
      opacity: 0.90,
      side: THREE.DoubleSide
    });
    const panelMat = new THREE.MeshPhongMaterial({
      color: 0x112233,
      emissive: 0x001122,
      shininess: 80,
      side: THREE.DoubleSide
    });

    const variants = [];

    // Add ambient light for the solid meshes (do this once here, not per mesh)
    const ambLight = new THREE.AmbientLight(0x333366, 1.0);
    this.scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0x6688ff, 1.5);
    dirLight.position.set(0, 1, 0.5);
    this.scene.add(dirLight);

    // --- Variant 0: Standard TIE Fighter ---
    const tie0 = new THREE.Group();
    const sphere0 = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 10), hullMat.clone());
    // Hexagonal cockpit window glow
    const windowMat0 = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.7 });
    const window0 = new THREE.Mesh(new THREE.CircleGeometry(2.5, 6), windowMat0);
    window0.position.z = 5.1;
    tie0.add(sphere0, window0);

    // Wings: flat panels
    const wingGeom0 = new THREE.CylinderGeometry(9.5, 9.5, 0.4, 8);
    const lw0 = new THREE.Mesh(wingGeom0, wingMat.clone());
    lw0.rotation.z = Math.PI / 2; lw0.position.x = -8;
    const rw0 = new THREE.Mesh(wingGeom0, wingMat.clone());
    rw0.rotation.z = Math.PI / 2; rw0.position.x = 8;
    // Wing struts
    const strutGeom0 = new THREE.CylinderGeometry(0.6, 0.6, 16, 5);
    const ls0 = new THREE.Mesh(strutGeom0, panelMat.clone());
    ls0.rotation.z = Math.PI / 2;
    tie0.add(lw0, rw0, ls0);

    // Panel grid lines as thin boxes on wings
    for (let r = 0; r < 3; r++) {
      const lineGeom = new THREE.BoxGeometry(0.2, 0.5, 16);
      const lineL = new THREE.Mesh(lineGeom, new THREE.MeshBasicMaterial({ color: 0x4466aa }));
      lineL.position.set(-8, (r - 1) * 3.2, 0);
      const lineR = lineL.clone(); lineR.position.x = 8;
      tie0.add(lineL, lineR);
    }
    variants.push(tie0);

    // --- Variant 1: TIE Interceptor ---
    const tie1 = new THREE.Group();
    const hull1 = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 10), hullMat.clone());
    const win1 = new THREE.Mesh(new THREE.CircleGeometry(2, 6), new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 }));
    win1.position.z = 4.6;
    tie1.add(hull1, win1);

    // Swept delta wings
    const wingShape1 = new THREE.Shape();
    wingShape1.moveTo(0, 10); wingShape1.lineTo(5, 0); wingShape1.lineTo(0, -10);
    wingShape1.lineTo(-5, 0); wingShape1.closePath();
    const extSettings1 = { depth: 0.4, bevelEnabled: false };
    const wingGeomEx1 = new THREE.ExtrudeGeometry(wingShape1, extSettings1);
    const lw1 = new THREE.Mesh(wingGeomEx1, wingMat.clone());
    lw1.position.x = -7; lw1.rotation.y = Math.PI / 2;
    const rw1 = new THREE.Mesh(wingGeomEx1, wingMat.clone());
    rw1.position.x = 7; rw1.rotation.y = Math.PI / 2;
    tie1.add(lw1, rw1);
    variants.push(tie1);

    // --- Variant 2: TIE Bomber (double hull) ---
    const tie2 = new THREE.Group();
    const hull2a = new THREE.Mesh(new THREE.SphereGeometry(4.5, 10, 8), hullMat.clone());
    hull2a.position.x = -4;
    const hull2b = new THREE.Mesh(new THREE.CapsuleGeometry(3.5, 4, 8, 10), hullMat.clone());
    hull2b.position.x = 5; hull2b.rotation.z = Math.PI / 2;
    const win2 = new THREE.Mesh(new THREE.CircleGeometry(1.8, 6), new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.7 }));
    win2.position.set(-4, 0, 4.6);
    tie2.add(hull2a, hull2b, win2);
    const wingGeom2 = new THREE.CylinderGeometry(8.5, 8.5, 0.4, 8);
    const lw2 = new THREE.Mesh(wingGeom2, wingMat.clone()); lw2.rotation.z = Math.PI / 2; lw2.position.x = -10;
    const rw2 = new THREE.Mesh(wingGeom2, wingMat.clone()); rw2.rotation.z = Math.PI / 2; rw2.position.x = 12;
    tie2.add(lw2, rw2);
    variants.push(tie2);

    // --- Variant 3: TIE Advanced (bent wings) ---
    const tie3 = new THREE.Group();
    const hull3 = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 10), hullMat.clone());
    const win3 = new THREE.Mesh(new THREE.CircleGeometry(2.5, 8), new THREE.MeshBasicMaterial({ color: 0xff0044, transparent: true, opacity: 0.85 }));
    win3.position.z = 5.1;
    tie3.add(hull3, win3);
    // Angled panel wings
    const wingGeom3 = new THREE.BoxGeometry(0.4, 13, 6.5);
    const lw3 = new THREE.Mesh(wingGeom3, wingMat.clone());
    lw3.position.set(-7, 0, 0); lw3.rotation.z = 0.3;
    const rw3 = new THREE.Mesh(wingGeom3, wingMat.clone());
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
    // Predict where player will be in ~2.5 seconds
    const PREDICT_TIME = 2.5;

    for (let i = 0; i < this.maxEnemies; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      // --- Predictive interception ---
      const predictedPos = playerPos.clone().addScaledVector(playerVel, PREDICT_TIME);

      // If in formation and following a leader, adjust target
      let targetPos = predictedPos.clone();

      if (enemy.formationLeader && enemy.formationLeader.active) {
        // Offset from leader in world space
        const leaderPos = enemy.formationLeader.mesh.position;
        const leaderFwd = new THREE.Vector3();
        enemy.formationLeader.mesh.getWorldDirection(leaderFwd);
        const leaderRight = new THREE.Vector3().crossVectors(leaderFwd, new THREE.Vector3(0, 1, 0)).normalize();
        targetPos = leaderPos.clone()
          .addScaledVector(leaderRight, enemy.formationOffset.x)
          .addScaledVector(new THREE.Vector3(0, 1, 0), enemy.formationOffset.y)
          .addScaledVector(leaderFwd, enemy.formationOffset.z);
      } else {
        // Strategy modifiers
        if (enemy.strategy === 'high_alt') {
          targetPos.y = playerPos.y + 130;
        } else if (enemy.strategy === 'trench' && this.terrain) {
          const eH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
          targetPos.y = eH + 22;
        } else if (enemy.strategy === 'flanker') {
          // Circle around to the side of the player
          const angle = Date.now() * 0.0008 + i * 1.3;
          targetPos.x += Math.sin(angle) * 120;
          targetPos.z += Math.cos(angle) * 120;
          targetPos.y = playerPos.y + 20;
        }
      }

      // --- Terrain avoidance (look ahead) ---
      const lookAheadDist = 50;
      if (this.terrain) {
        const lookDir = targetPos.clone().sub(enemy.mesh.position).normalize();
        const lookAhead = enemy.mesh.position.clone().addScaledVector(lookDir, lookAheadDist);
        const terrainAhead = this.terrain.getHeightAt(lookAhead.x, lookAhead.z);
        if (lookAhead.y < terrainAhead + 30) {
          // Pull up hard to avoid terrain
          targetPos.y += 80;
        }
      }

      const dir = new THREE.Vector3().subVectors(targetPos, enemy.mesh.position).normalize();

      // Evasion maneuver (random weave)
      enemy.evasionTimer -= deltaTime;
      if (enemy.evasionTimer <= 0) {
        enemy.evasionTimer = 1.5 + Math.random() * 2.0;
        enemy.evasionDir.set(
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 1.5
        );
      }

      const distToPlayer = enemy.mesh.position.distanceTo(playerPos);

      // Speed varies by strategy
      let baseSpeed = 45 + i * 0.5;
      if (enemy.strategy === 'interceptor') baseSpeed = 70;
      if (enemy.strategy === 'flanker')     baseSpeed = 55;

      const targetVelocity = dir.clone().multiplyScalar(baseSpeed);
      targetVelocity.addScaledVector(enemy.evasionDir, 12);
      // Smooth velocity change (momentum)
      enemy.velocity.lerp(targetVelocity, 2.5 * deltaTime);

      enemy.mesh.position.addScaledVector(enemy.velocity, deltaTime);
      // Smoothly face movement direction
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

      // Enemy shooting with predictive aim
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

    const bulletSpeed = 220;
    // Predictive lead: aim where player will be
    const leadTime = enemy.mesh.position.distanceTo(playerPos) / bulletSpeed;
    const predictedPlayerPos = playerPos.clone().addScaledVector(playerVel, leadTime * 0.6);

    const aimDir = new THREE.Vector3().subVectors(predictedPlayerPos, enemy.mesh.position).normalize();

    // Stormtrooper miss spread, but slightly better than random
    const spread = 0.22;
    aimDir.x += (Math.random() - 0.5) * spread;
    aimDir.y += (Math.random() - 0.5) * spread;
    aimDir.z += (Math.random() - 0.5) * spread;
    aimDir.normalize();

    proj.velocity.copy(aimDir).multiplyScalar(bulletSpeed);
    proj.mesh.lookAt(proj.mesh.position.clone().add(aimDir));
    proj.mesh.rotateX(Math.PI / 2);
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
      if (dist < 8) {
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

    // Pick a random spawn direction (not just straight ahead)
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnRadius = 500 + Math.random() * 200;
    const spawnDir = new THREE.Vector3(
      Math.sin(spawnAngle),
      0,
      Math.cos(spawnAngle)
    );

    const basePos = playerPos.clone().addScaledVector(spawnDir, spawnRadius);
    basePos.y = playerPos.y + (Math.random() - 0.5) * 100 + 50;

    // Formation types
    const formations = ['v_form', 'line', 'diamond', 'swarm'];
    const formType = formations[Math.floor(Math.random() * formations.length)];
    const count = 2 + Math.floor(Math.random() * 3);

    const freeEnemies = this.enemies.filter(e => !e.active).slice(0, count);
    if (freeEnemies.length === 0) return;

    // Formation offsets
    const formOffsets = this._getFormationOffsets(formType, freeEnemies.length);

    const strategies = ['chase', 'high_alt', 'trench', 'flanker', 'interceptor'];
    const groupStrategy = strategies[Math.floor(Math.random() * strategies.length)];

    freeEnemies.forEach((enemy, s) => {
      const offset = formOffsets[s] || new THREE.Vector3();
      enemy.mesh.position.copy(basePos).add(offset);

      if (this.terrain) {
        const tH = this.terrain.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z);
        enemy.mesh.position.y = Math.max(enemy.mesh.position.y, tH + 40);
      }

      enemy.hp = 5;
      enemy.maxHp = 5;
      enemy.active = true;
      enemy.mesh.visible = true;
      enemy.fireTimer = Math.random() * 2;
      enemy.strategy = groupStrategy;
      enemy.evasionTimer = Math.random() * 2;
      enemy.velocity.set(0, 0, 0);

      // Formation leadership
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
    if (!enemy.active) return;
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
      e.formationLeader = null;
      e.velocity.set(0, 0, 0);
    }
    for (const p of this.enemyProjectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
    this.spawnTimer = 0;
  }
}
