import * as THREE from 'three';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;

    this.maxParticles = 4000;  // Reduced for perf
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.instancedMesh);

    this.particles = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0,
        life: 0,
        color: new THREE.Color()
      });
    }

    this.dummy = new THREE.Object3D();
    this.debrisPool = [];

    // === Shockwave system ===
    this.shockwaves = [];
  }

  update(deltaTime, terrain) {
    let count = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.age += deltaTime;
      if (p.age >= p.life) { p.active = false; continue; }

      p.velocity.y -= 25.0 * deltaTime;
      p.position.addScaledVector(p.velocity, deltaTime);

      this.dummy.position.copy(p.position);
      const scale = Math.max(0, 1.0 - (p.age / p.life));
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(count, this.dummy.matrix);
      this.instancedMesh.setColorAt(count, p.color);
      count++;
    }

    this.instancedMesh.count = count;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    // Update falling debris
    for (let i = this.debrisPool.length - 1; i >= 0; i--) {
      const d = this.debrisPool[i];
      d.velocity.y -= 35.0 * deltaTime;
      d.position.addScaledVector(d.velocity, deltaTime);

      if (terrain) {
        const tH = terrain.getHeightAt(d.position.x, d.position.z);
        if (d.position.y <= tH) {
          this.spawnGroundExplosion(d.position);
          this.debrisPool.splice(i, 1);
        }
      }

      d.age = (d.age || 0) + deltaTime;
      if (d.age > 5) {
        this.debrisPool.splice(i, 1);
      }
    }

    // Update shockwaves
    this._updateShockwaves(deltaTime);
  }

  spawnAirburst(position) {
    for (let i = 0; i < 120; i++) {
      const p = this._getFree();
      if (!p) break;
      p.active = true;
      p.position.copy(position);
      p.velocity.set(
        (Math.random() - 0.5) * 140,
        (Math.random() - 0.5) * 140,
        (Math.random() - 0.5) * 140
      );
      p.age = 0;
      p.life = 0.3 + Math.random() * 0.7;
      const r = Math.random();
      if (r > 0.8) p.color.setHex(0xffffff);
      else if (r > 0.4) p.color.setHex(0xffaa00);
      else p.color.setHex(0xff0000);
    }

    // Debris that falls to ground
    this.debrisPool.push({
      position: position.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        Math.random() * 15,
        (Math.random() - 0.5) * 15
      ),
      age: 0
    });
  }

  spawnGroundExplosion(position) {
    for (let i = 0; i < 80; i++) {
      const p = this._getFree();
      if (!p) break;
      p.active = true;
      p.position.copy(position);
      p.velocity.set(
        (Math.random() - 0.5) * 100,
        Math.random() * 50,
        (Math.random() - 0.5) * 100
      );
      p.age = 0;
      p.life = 0.8 + Math.random() * 1.2;
      p.color.setHex(Math.random() > 0.5 ? 0xff0000 : 0xff6600);
    }
  }

  // === SHOCKWAVE: expanding yellow ring that follows terrain ===
  spawnShockwave(position, terrain) {
    const config = [
      { maxRadius: 150, maxAge: 1.5, opacity: 0.9 },
      { maxRadius: 240, maxAge: 2.2, opacity: 0.7 },
      { maxRadius: 330, maxAge: 2.9, opacity: 0.5 }
    ];

    for (const c of config) {
      // Create a ring mesh that expands from crash point
      const ringGeom = new THREE.RingGeometry(0.5, 3.0, 32);
      ringGeom.rotateX(-Math.PI / 2); // lay flat on XZ plane

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffdd00,
        transparent: true,
        opacity: c.opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.copy(position);
      this.scene.add(ring);

      this.shockwaves.push({
        mesh: ring,
        origin: position.clone(),
        age: 0,
        maxAge: c.maxAge,
        maxRadius: c.maxRadius,
        startOpacity: c.opacity,
        terrain: terrain
      });
    }
  }

  _updateShockwaves(deltaTime) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.age += deltaTime;

      if (sw.age >= sw.maxAge) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mesh.material.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }

      const t = sw.age / sw.maxAge;
      const currentRadius = sw.maxRadius * t;
      const innerRadius = Math.max(0.5, currentRadius - 6);
      const outerRadius = currentRadius;

      // Rebuild ring geometry at current radius
      sw.mesh.geometry.dispose();
      const newGeom = new THREE.RingGeometry(innerRadius, outerRadius, 32);
      newGeom.rotateX(-Math.PI / 2);

      // Displace ring vertices to follow terrain
      if (sw.terrain) {
        const pos = newGeom.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          const wx = pos.getX(v) + sw.origin.x;
          const wz = pos.getZ(v) + sw.origin.z;
          const terrainH = sw.terrain.getHeightAt(wx, wz);
          pos.setY(v, terrainH - sw.origin.y + 2); // offset relative to origin
        }
        pos.needsUpdate = true;
      }

      sw.mesh.geometry = newGeom;

      // Fade out
      sw.mesh.material.opacity = sw.startOpacity * (1.0 - t * t);

      // Color shift: bright yellow → orange as it fades
      const color = new THREE.Color();
      color.lerpColors(new THREE.Color(0xffdd00), new THREE.Color(0xff6600), t);
      sw.mesh.material.color.copy(color);
    }
  }

  _getFree() {
    for (let i = 0; i < this.maxParticles; i++) {
      if (!this.particles[i].active) return this.particles[i];
    }
    return null;
  }

  reset() {
    for (const p of this.particles) p.active = false;
    this.debrisPool.length = 0;
    this.instancedMesh.count = 0;
    // Clean up shockwaves
    for (const sw of this.shockwaves) {
      this.scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
    }
    this.shockwaves.length = 0;
  }
}
