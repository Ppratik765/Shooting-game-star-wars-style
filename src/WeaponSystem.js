import * as THREE from 'three';

export class WeaponSystem {
  constructor(scene, camera, enemyManager, uiManager, isMobile = false, audioManager = null, terrain = null, particleSystem = null) {
    this.scene = scene;
    this.camera = camera;
    this.enemyManager = enemyManager;
    this.uiManager = uiManager;
    this.isMobile = isMobile;
    this.audioManager = audioManager;
    this.terrain = terrain;
    this.particleSystem = particleSystem;

    // Charge system
    this.maxCharge = 70;
    this.charge = this.maxCharge;
    this.chargePerShot = 1.2;
    this.chargeRegenRate = 14;
    this.chargeDepleted = false;
    this.weaponOverdriveActive = false;

    // Targeting system
    this.projectileSpeed = 1100;  // Slightly slower than hit-scan
    this.fireRate = 0.12;         // Adjusted fire rate
    this.lastFireTime = 0;
    this.lockedEnemy = null;

    // Object pool — smaller on mobile
    this.poolSize = isMobile ? 35 : 70;
    this.pool = [];

    // Laser bolt geometry: thin retro-futuristic CRT laser
    const segments = isMobile ? 5 : 8;
    const boltLength = 160;
    const boltRadius = isMobile ? 0.18 : 0.10;
    const geom = new THREE.CylinderGeometry(boltRadius, boltRadius, boltLength, segments, isMobile ? 1 : 6);
    geom.rotateX(-Math.PI / 2);
    this.boltGeom = geom;

    // Inner core geometry (smaller cylinder for hot plasma core)
    const coreGeom = new THREE.CylinderGeometry(boltRadius * 0.3, boltRadius * 0.3, boltLength, isMobile ? 4 : 6, 1);
    coreGeom.rotateX(-Math.PI / 2);
    this.coreGeom = coreGeom;

    // Glow cylinder mesh overlay for plasma effect — SKIP on mobile (expensive shader)
    let glowGeom = null;
    let glowMat = null;
    if (!isMobile) {
      glowGeom = new THREE.CylinderGeometry(boltRadius * 4.5, boltRadius * 4.5, boltLength * 1.05, 8, 1);
      glowGeom.rotateX(-Math.PI / 2);
      this.uniforms = { uTime: { value: 0 } };
      glowMat = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vLocalPos;
          void main() {
            vUv = uv;
            vLocalPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vLocalPos;
          void main() {
            float scanline = sin(vLocalPos.z * 1.5 - uTime * 30.0) * 0.5 + 0.5;
            vec3 baseColor = vec3(1.0, 0.55, 0.0);
            vec3 altColor = vec3(1.0, 0.75, 0.1);
            vec3 finalColor = mix(baseColor, altColor, scanline);
            float lengthFade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
            gl_FragColor = vec4(finalColor * 2.5, lengthFade * 0.9 * scanline);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
    } else {
      this.uniforms = { uTime: { value: 0 } };
      glowGeom = new THREE.CylinderGeometry(boltRadius * 3.5, boltRadius * 3.5, boltLength * 1.05, 4, 1);
      glowGeom.rotateX(-Math.PI / 2);
      glowMat = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
    }

    // Shared Materials for performance
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.5, 1.8, 0.0), // HDR Orange
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });

    for (let i = 0; i < this.poolSize; i++) {
      const mesh = new THREE.Mesh(this.boltGeom, mat);
      mesh.visible = false;
      this.scene.add(mesh);

      const coreMesh = new THREE.Mesh(this.coreGeom, coreMat);
      coreMesh.visible = false;
      this.scene.add(coreMesh);

      let glow = null;
      if (glowGeom && glowMat) {
        glow = new THREE.Mesh(glowGeom, glowMat);
        glow.visible = false;
        this.scene.add(glow);
      }

      this.pool.push({
        mesh, coreMesh, glow,
        active: false,
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        trackingTarget: null,
        age: 0,
        maxAge: 1.0
      });
    }

    this.raycaster = new THREE.Raycaster();

    // Reusable temp structures to avoid garbage collection
    this._tempV1 = new THREE.Vector3();
    this._tempV2 = new THREE.Vector3();
    this._tempV3 = new THREE.Vector3();
    this._tempV4 = new THREE.Vector3();
    this._tempV5 = new THREE.Vector3();

    // Data-oriented bulk processing buffers
    this.enemyBuffer = new Float32Array(this.enemyManager.maxEnemies * 4);
    this.laserBuffer = new Float32Array(this.poolSize * 6);
  }

  update(deltaTime, inputController, currentTime, playerVelocity) {
    if (this.uniforms) {
      this.uniforms.uTime.value += deltaTime;
    }

    // Charge regen
    if (!inputController.isFiring()) {
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * deltaTime);
    } else {
      this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegenRate * 0.25 * deltaTime);
    }

    if (this.chargeDepleted && this.charge > this.maxCharge * 0.25) {
      this.chargeDepleted = false;
    }

    this.lockedEnemy = null;

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
      if (p.age > p.maxAge) { this._deactivate(p); continue; }

      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.coreMesh.position.copy(p.mesh.position);
      p.coreMesh.quaternion.copy(p.mesh.quaternion);
      if (p.glow) {
        p.glow.position.copy(p.mesh.position);
        p.glow.quaternion.copy(p.mesh.quaternion);
      }

      // Terrain collision — laser hits ground
      if (this.terrain) {
        const tH = this.terrain.getHeightAt(p.mesh.position.x, p.mesh.position.z);
        if (p.mesh.position.y <= tH + 2) {
          if (this.particleSystem) {
            const impactPos = this._tempV4.copy(p.mesh.position);
            impactPos.y = tH;
            this.particleSystem.spawnLaserImpact(impactPos);
          }
          this._deactivate(p);
        }
      }
    }

    this._bulkCheckCollisions();
  }

  fire(playerVelocity) {
    const isOverdrive = this.weaponOverdriveActive;
    const requiredProjectiles = isOverdrive ? 4 : 2;

    const toSpawn = [];
    for (let i = 0; i < this.poolSize && toSpawn.length < requiredProjectiles; i++) {
      if (!this.pool[i].active) toSpawn.push(this.pool[i]);
    }
    if (toSpawn.length < requiredProjectiles) return;

    // Play laser sound effect
    if (this.audioManager) this.audioManager.playLaser();

    const crosshairPos = this.uiManager.currentCrosshairPos;
    const ndcX = (crosshairPos.x / window.innerWidth) * 2 - 1;
    const ndcY = -(crosshairPos.y / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const aimDir = this._tempV1.copy(this.raycaster.ray.direction).normalize();
    const laserVel = this._tempV2.copy(aimDir).multiplyScalar(this.projectileSpeed);

    const near = 5.0;
    const camRight = this._tempV3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const camFwd = this._tempV4.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = window.innerWidth / window.innerHeight;
    const halfW = Math.tan(fovRad * 0.5) * aspect * near;
    
    // We can reuse this._tempV5 for origin calculation since _activateProjectile copies the value immediately
    const origin = this._tempV5;

    if (isOverdrive) {
      // Fire 4 spread lasers (X offset: -8, -4, 4, 8)
      const scale = halfW * 0.45;
      
      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, -scale * 2.0);
      this._activateProjectile(toSpawn[0], origin, laserVel, aimDir);
      
      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, -scale * 1.0);
      this._activateProjectile(toSpawn[1], origin, laserVel, aimDir);
      
      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, scale * 1.0);
      this._activateProjectile(toSpawn[2], origin, laserVel, aimDir);
      
      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, scale * 2.0);
      this._activateProjectile(toSpawn[3], origin, laserVel, aimDir);
    } else {
      // Standard L/R 2 lasers
      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, -halfW * 0.95);
      this._activateProjectile(toSpawn[0], origin, laserVel, aimDir);

      origin.copy(this.camera.position).addScaledVector(camFwd, near).addScaledVector(camRight, halfW * 0.95);
      this._activateProjectile(toSpawn[1], origin, laserVel, aimDir);
    }
  }

  _activateProjectile(p, origin, velocity, direction) {
    p.active = true;
    p.age = 0;

    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    // Orient mesh: lookAt points local -Z at target — cylinder is pre-aligned along -Z
    const target = this._tempV5.copy(origin).add(direction);
    p.mesh.lookAt(target);

    p.coreMesh.position.copy(origin);
    p.coreMesh.visible = true;
    p.coreMesh.quaternion.copy(p.mesh.quaternion);

    if (p.glow) {
      p.glow.position.copy(origin);
      p.glow.quaternion.copy(p.mesh.quaternion);
      p.glow.visible = true;
    }

    p.velocity.copy(velocity);
    p.direction.copy(direction);
    p.trackingTarget = null;
  }

  _deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
    p.coreMesh.visible = false;
    if (p.glow) p.glow.visible = false;
    p.trackingTarget = null;
  }

  _bulkCheckCollisions() {
    const enemies = this.enemyManager.getEnemies();
    let enemyCount = 0;
    const enemyMap = []; // Maps local buffer index back to actual enemy reference

    // 1. Pack active enemies
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.dying) continue;
      const base = enemyCount * 4;
      this.enemyBuffer[base] = e.mesh.position.x;
      this.enemyBuffer[base + 1] = e.mesh.position.y;
      this.enemyBuffer[base + 2] = e.mesh.position.z;
      this.enemyBuffer[base + 3] = e.radius + 8; // threshold
      enemyMap.push(e);
      enemyCount++;
    }

    if (enemyCount === 0) return;

    let laserCount = 0;
    const laserMap = []; // Maps local buffer index back to actual laser reference

    // 2. Pack active lasers
    for (let i = 0; i < this.poolSize; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      
      const tail = this._tempV1.copy(p.mesh.position).addScaledVector(p.direction, -160);
      const head = this._tempV2.copy(p.mesh.position).addScaledVector(p.direction, 100);
      
      const base = laserCount * 6;
      this.laserBuffer[base] = tail.x;
      this.laserBuffer[base + 1] = tail.y;
      this.laserBuffer[base + 2] = tail.z;
      this.laserBuffer[base + 3] = head.x;
      this.laserBuffer[base + 4] = head.y;
      this.laserBuffer[base + 5] = head.z;
      laserMap.push(p);
      laserCount++;
    }

    if (laserCount === 0) return;

    // 3. Write arrays to Wasm memory
    import('./wasm.js').then(m => {
      const wasm = m.wasm;
      // Allocate in Wasm
      const enemyMemPtr = wasm.engine_memory_alloc(enemyCount * 4 * 4);
      const laserMemPtr = wasm.engine_memory_alloc(laserCount * 6 * 4);
      
      // Copy JS buffer to Wasm memory
      const wasmMemory = new Float32Array(wasm.memory.buffer);
      wasmMemory.set(this.enemyBuffer.subarray(0, enemyCount * 4), enemyMemPtr / 4);
      wasmMemory.set(this.laserBuffer.subarray(0, laserCount * 6), laserMemPtr / 4);

      // Execute bulk check
      wasm.check_bulk_laser_hits(enemyMemPtr, enemyCount, laserMemPtr, laserCount);

      // Read back hits
      const hitLen = wasm.get_hit_results_len();
      if (hitLen > 0) {
        const hitPtr = wasm.get_hit_results_ptr() / 4; // Int32 array pointer
        const hitData = new Int32Array(wasm.memory.buffer, hitPtr * 4, hitLen);
        
        // hitData is [enemy_idx, laser_idx, enemy_idx, laser_idx, ...]
        for (let i = 0; i < hitLen; i += 2) {
          const eIdx = hitData[i];
          const lIdx = hitData[i + 1];
          const hitEnemy = enemyMap[eIdx];
          const hitLaser = laserMap[lIdx];
          
          if (hitEnemy && hitEnemy.active && !hitEnemy.dying && hitLaser && hitLaser.active) {
            this.enemyManager.damageEnemy(hitEnemy, 1);
            this._deactivate(hitLaser);
          }
        }
      }

      // Free Wasm memory
      wasm.engine_memory_free(enemyMemPtr, enemyCount * 4 * 4);
      wasm.engine_memory_free(laserMemPtr, laserCount * 6 * 4);
    }).catch(e => console.error(e));
  }

  _attemptLock() {
    this.lockedEnemy = null;
  }

  reset() {
    this.charge = this.maxCharge;
    this.chargeDepleted = false;
    this.lastFireTime = 0;
    this.lockedEnemy = null;
    this.weaponOverdriveActive = false;
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
