import * as THREE from 'three';
import { ParticleEngine, wasm } from './wasm.js';

const memory = wasm.memory;

export class ParticleSystem {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;


    this.maxParticles = isMobile ? 1500 : 4000;
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00,
      blending: isMobile ? THREE.AdditiveBlending : THREE.NormalBlending,
      transparent: isMobile ? true : false,
      depthWrite: !isMobile
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.instancedMesh);

    // Instantiate the Rust particle engine
    this.engine = new ParticleEngine(this.maxParticles, isMobile);

    // Create Float32Array views into Wasm memory for zero-copy buffer reads
    this._refreshBufferViews();

    this.debrisPool = [];

    // === Shockwave system (stays in JS — manipulates Three.js geometry) ===
    this.shockwaves = [];
  }

  /// Re-create buffer views. Must be called after any Wasm memory growth.
  _refreshBufferViews() {
    this.matrixView = new Float32Array(memory.buffer, this.engine.get_matrix_ptr(), this.maxParticles * 16);
    this.colorView = new Float32Array(memory.buffer, this.engine.get_color_ptr(), this.maxParticles * 3);
  }

  update(deltaTime, terrain) {
    // Tick the Rust particle engine
    const activeCount = this.engine.update(deltaTime);

    // Refresh views in case Wasm memory was resized (rare but safe)
    if (this.matrixView.buffer !== memory.buffer) {
      this._refreshBufferViews();
    }

    // Map Wasm matrix buffer directly to InstancedMesh
    if (activeCount > 0) {
      const matArr = this.instancedMesh.instanceMatrix.array;
      const needed = activeCount * 16;
      // Copy from Wasm buffer into Three.js instanceMatrix array
      matArr.set(this.matrixView.subarray(0, needed));

      // Map Wasm color buffer to instanceColor
      // Three.js creates instanceColor lazily on first setColorAt,
      // so we may need to initialize it
      if (!this.instancedMesh.instanceColor) {
        // Force-create instanceColor by setting color at index 0
        this.instancedMesh.setColorAt(0, new THREE.Color(1, 1, 1));
      }
      const colArr = this.instancedMesh.instanceColor.array;
      const colNeeded = activeCount * 3;
      colArr.set(this.colorView.subarray(0, colNeeded));
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    this.instancedMesh.count = activeCount;
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Update falling debris (stays in JS — small array, uses terrain.getHeightAt)
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

    // Update shockwaves (stays in JS — manipulates Three.js RingGeometry)
    this._updateShockwaves(deltaTime);
  }

  spawnAirburst(position) {
    const burstCount = this.isMobile ? 50 : 120;
    this.engine.spawn_airburst(position.x, position.y, position.z, burstCount);

    // Debris that falls to ground (stays in JS)
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
    const groundCount = this.isMobile ? 30 : 80;
    this.engine.spawn_ground_explosion(position.x, position.y, position.z, groundCount);
  }

  spawnLaserImpact(position) {
    const count = this.isMobile ? 8 : 20;
    this.engine.spawn_laser_impact(position.x, position.y, position.z, count);
  }

  // === SHOCKWAVE: expanding yellow ring that follows terrain ===
  // Stays entirely in JS — creates/destroys Three.js geometry
  spawnShockwave(position, terrain = null) {
    const config = [
      { maxRadius: 250, maxAge: 1.2, opacity: this.isMobile ? 1.0 : 0.8 },
      { maxRadius: 400, maxAge: 1.6, opacity: this.isMobile ? 0.8 : 0.5 }
    ];

    const segments = this.isMobile ? 16 : 32;

    for (const c of config) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: c.opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      // Create a reusable dynamic geometry
      const ringGeom = new THREE.BufferGeometry();
      const vertices = new Float32Array((segments + 1) * 2 * 3);
      const indices = [];
      for (let i = 0; i < segments; i++) {
        const inner = i;
        const outer = i + segments + 1;
        const nextInner = i + 1;
        const nextOuter = i + segments + 2;
        indices.push(inner, outer, nextInner);
        indices.push(nextInner, outer, nextOuter);
      }
      ringGeom.setIndex(indices);
      ringGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.copy(position);
      this.scene.add(ring);

      this.shockwaves.push({
        mesh: ring,
        origin: this._tempV1 ? this._tempV1.copy(position).clone() : position.clone(),
        age: 0,
        maxAge: c.maxAge,
        maxRadius: c.maxRadius,
        startOpacity: c.opacity,
        terrain: terrain,
        segments: segments
      });
    }
  }

  _updateShockwaves(deltaTime) {
    if (!this._tempColor) this._tempColor = new THREE.Color();
    
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
      
      const pos = sw.mesh.geometry.attributes.position;
      const segments = sw.segments;
      
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        
        // Inner vertex
        const ix = cosT * innerRadius;
        const iz = sinT * innerRadius;
        const iy = sw.terrain ? (sw.terrain.getHeightAt(ix + sw.origin.x, iz + sw.origin.z) - sw.origin.y + 2) : 0;
        pos.setXYZ(s, ix, iy, iz);
        
        // Outer vertex
        const ox = cosT * outerRadius;
        const oz = sinT * outerRadius;
        const oy = sw.terrain ? (sw.terrain.getHeightAt(ox + sw.origin.x, oz + sw.origin.z) - sw.origin.y + 2) : 0;
        pos.setXYZ(s + segments + 1, ox, oy, oz);
      }
      
      pos.needsUpdate = true;

      sw.mesh.material.opacity = sw.startOpacity * (1.0 - t * t);
      this._tempColor.lerpColors(new THREE.Color(0xffdd00), new THREE.Color(0xff6600), t);
      sw.mesh.material.color.copy(this._tempColor);
    }
  }

  /// GameManager.js calls _getFree() to get a particle slot for death smoke.
  /// Returns a proxy object that mimics the old particle format so
  /// GameManager doesn't need to change.
  _getFree() {
    const idx = this.engine.get_free();
    if (idx < 0) return null;

    const engine = this.engine;
    // Return a thin proxy object matching the old API:
    // { active, position: {copy, set}, velocity: {set}, age, life, color: {setHex} }
    const proxy = {
      _idx: idx,
      _engine: engine,
      set active(val) {
        if (val) {
          // Will be activated via activate() when all properties are set
        }
      },
      get active() { return true; },
      position: {
        _x: 0, _y: 0, _z: 0,
        copy(v) { this._x = v.x; this._y = v.y; this._z = v.z; return this; },
        set(x, y, z) { this._x = x; this._y = y; this._z = z; return this; },
        get x() { return this._x; },
        get y() { return this._y; },
        get z() { return this._z; }
      },
      velocity: {
        _x: 0, _y: 0, _z: 0,
        set(x, y, z) { this._x = x; this._y = y; this._z = z; return this; },
        get x() { return this._x; },
        get y() { return this._y; },
        get z() { return this._z; }
      },
      age: 0,
      life: 0,
      color: {
        _r: 1, _g: 1, _b: 1,
        setHex(hex) {
          this._r = ((hex >> 16) & 0xFF) / 255;
          this._g = ((hex >> 8) & 0xFF) / 255;
          this._b = (hex & 0xFF) / 255;
          // Trigger the flush since this is the last property set by GameManager
          this._parent._commit();
          return this;
        }
      },
      // Flush: commit this proxy particle into the Rust engine.
      _commit() {
        engine.activate(
          idx,
          this.position._x, this.position._y, this.position._z,
          this.velocity._x, this.velocity._y, this.velocity._z,
          this.life,
          this.color._r, this.color._g, this.color._b
        );
      }
    };
    proxy.color._parent = proxy;
    return proxy;
  }

  reset() {
    this.engine.reset();
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
