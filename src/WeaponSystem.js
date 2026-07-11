import * as THREE from 'three';
import { line_sphere_intersect } from './wasm.js';
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

    // Reusable temp structures to avoid garbage collection
    this._tempV1 = new THREE.Vector3();
    this._tempV2 = new THREE.Vector3();
    this._tempV3 = new THREE.Vector3();
    this._tempV4 = new THREE.Vector3();
    this._tempV5 = new THREE.Vector3();
    this._tempLine = new THREE.Line3();
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
          continue;
        }
      }

      this._checkCollisions(p);
    }
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

  _checkCollisions(projectile) {
    const enemies = this.enemyManager.getEnemies();

    // Create a line segment representing the bullet's volume this frame without allocating new Vector3s
    const tail = this._tempV1.copy(projectile.mesh.position).addScaledVector(projectile.direction, -160);
    const head = this._tempV2.copy(projectile.mesh.position).addScaledVector(projectile.direction, 100);
    this._tempLine.set(tail, head);
    const closestPoint = this._tempV3;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy.active || enemy.dying) continue;

      const threshold = enemy.radius + 8;
      
      const hit = line_sphere_intersect(
        tail.x, tail.y, tail.z,
        head.x, head.y, head.z,
        enemy.mesh.position.x, enemy.mesh.position.y, enemy.mesh.position.z,
        threshold
      );

      if (hit) {
        this.enemyManager.damageEnemy(enemy, 1);
        this._deactivate(projectile);
        return;
      }
    }
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
