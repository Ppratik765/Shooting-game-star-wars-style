import * as THREE from 'three';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;

    this.maxParticles = 6000;
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

      // Timeout debris after 5 seconds
      d.age = (d.age || 0) + deltaTime;
      if (d.age > 5) {
        this.debrisPool.splice(i, 1);
      }
    }
  }

  spawnAirburst(position) {
    // Large "Violent" explosion - more particles and higher speed
    for (let i = 0; i < 180; i++) {
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
      // High-contrast mix: white hot center, orange/red edges
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
    for (let i = 0; i < 120; i++) {
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
  }
}
