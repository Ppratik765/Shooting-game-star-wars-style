import * as THREE from 'three';

export class WeaponSystem {
  constructor(scene, camera, enemyManager, uiManager, isMobile = false) {
    this.scene = scene;
    this.camera = camera;
    this.enemyManager = enemyManager;
    this.uiManager = uiManager;
    this.isMobile = isMobile;

    // Charge system
    this.maxCharge = 70;
    this.charge = this.maxCharge;
    this.chargePerShot = 1.2;
    this.chargeRegenRate = 14;
    this.chargeDepleted = false;

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
    const boltRadius = 0.10;
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
    }

    // Shared Materials for performance
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff9900,
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
      if (!isMobile && glowGeom && glowMat) {
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

    // Update projectiles
    for (let i = 0; i < this.poolSize; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.age += deltaTime;
      if (p.age > p.maxAge) { this._deactivate(p); continue; }

      // Pure straight-line movement
      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.coreMesh.position.copy(p.mesh.position);
      p.coreMesh.quaternion.copy(p.mesh.quaternion);
      if (p.glow) {
        p.glow.position.copy(p.mesh.position);
        p.glow.quaternion.copy(p.mesh.quaternion);
      }

      this._checkCollisions(p);
    }
  }

  fire(playerVelocity) {
    const toSpawn = [];
    for (let i = 0; i < this.poolSize && toSpawn.length < 2; i++) {
      if (!this.pool[i].active) toSpawn.push(this.pool[i]);
    }
    if (toSpawn.length < 2) return;

    let aimDir;
    if (this.lockedEnemy && this.lockedEnemy.active) {
      aimDir = this.lockedEnemy.mesh.position.clone().sub(this.camera.position).normalize();
    } else {
      const crosshairPos = this.uiManager.currentCrosshairPos;
      const ndcX = (crosshairPos.x / window.innerWidth) * 2 - 1;
      const ndcY = -(crosshairPos.y / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
      aimDir = this.raycaster.ray.direction.clone().normalize();
    }

    const laserVel = aimDir.clone().multiplyScalar(this.projectileSpeed);

    const near = 5.0;
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = window.innerWidth / window.innerHeight;
    const halfW = Math.tan(fovRad * 0.5) * aspect * near;

    const originL = this.camera.position.clone()
      .addScaledVector(camFwd, near)
      .addScaledVector(camRight, -halfW * 0.95);

    const originR = this.camera.position.clone()
      .addScaledVector(camFwd, near)
      .addScaledVector(camRight, halfW * 0.95);

    this._activateProjectile(toSpawn[0], originL, laserVel, aimDir);
    this._activateProjectile(toSpawn[1], originR, laserVel, aimDir);
  }

  _activateProjectile(p, origin, velocity, direction) {
    p.active = true;
    p.age = 0;

    p.mesh.position.copy(origin);
    p.mesh.visible = true;
    // Orient mesh: lookAt points local -Z at target — cylinder is pre-aligned along -Z
    const target = origin.clone().add(direction);
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

  _checkCollisions(projectile) {
    const enemies = this.enemyManager.getEnemies();

    // Create a line segment representing the bullet's volume this frame
    // Length is 160, plus we add a slight look-ahead for speed tunneling
    const tail = projectile.mesh.position.clone().addScaledVector(projectile.direction, -160);
    const head = projectile.mesh.position.clone().addScaledVector(projectile.direction, 100);
    const line = new THREE.Line3(tail, head);
    const closestPoint = new THREE.Vector3();

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active || enemy.dying) continue;

      line.closestPointToPoint(enemy.mesh.position, true, closestPoint);
      const dist = closestPoint.distanceTo(enemy.mesh.position);

      // Increased leeway for easier hitting and fast gameplay
      if (dist < enemy.radius + 8) {
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
      if (!enemy.active || enemy.dying) continue;
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
