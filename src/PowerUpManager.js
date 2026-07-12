import * as THREE from 'three';

export class PowerUpManager {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.isMobile = isMobile;
    this.activePowerUps = [];
    this.pool = [];
    this.maxPowerUps = isMobile ? 8 : 15;

    this.types = {
      HULL: 'HULL',             // Green Octahedron
      SHIELD: 'SHIELD',         // Blue Icosahedron (Shield)
      ENGINES: 'ENGINES'        // Yellow Icosahedron
    };

    // Geometries (scaled up to be much larger and highly visible in flight)
    this.octaGeom = new THREE.OctahedronGeometry(25);
    this.pyramidGeom = new THREE.ConeGeometry(22, 40, 4);
    this.icoGeom = new THREE.IcosahedronGeometry(22);

    // Materials with highly emissive, wireframe parameters (fully opaque)
    // Using values above 1.0 (HDR) to trigger UnrealBloomPass glow without real PointLights
    this.hullMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.0, 3.5, 1.2),
      wireframe: true
    });

    this.shieldMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.0, 2.5, 4.0),
      wireframe: true
    });

    this.enginesMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.0, 2.0, 0.0),
      wireframe: true
    });

    this._initPool();
  }

  _initPool() {
    for (let i = 0; i < this.maxPowerUps; i++) {
      const group = new THREE.Group();

      const container = {
        group,
        mesh: null,
        glowMesh: null,
        textSprite: null,
        active: false,
        type: null,
        bobOffset: Math.random() * Math.PI * 2,
        spawnTime: 0
      };

      this.scene.add(group);
      group.visible = false;
      this.pool.push(container);
    }
  }

  _createTextSprite(text, colorStr) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 36px VT323, monospace';
    ctx.fillStyle = colorStr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Neon glow effect on text canvas
    ctx.shadowColor = colorStr;
    ctx.shadowBlur = 10;
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(65, 18, 1);
    return sprite;
  }

  spawnPowerUp(x, z, terrainHeight) {
    const item = this.pool.find(p => !p.active);
    if (!item) return;

    // Pick random type (HULL or SHIELD only, 50/50 chance)
    const r = Math.random();
    let type = this.types.HULL;
    let mat = this.hullMat;
    let geom = this.octaGeom;

    if (r > 0.50) {
      type = this.types.SHIELD;
      mat = this.shieldMat;
      geom = this.icoGeom; // Blue has the same shape as yellow (Icosahedron)
    }

    // Clean old mesh
    if (item.mesh) {
      item.group.remove(item.mesh);
    }
    if (item.glowMesh) {
      item.group.remove(item.glowMesh);
      item.glowMesh.material.dispose();
      item.glowMesh = null;
    }
    if (item.textSprite) {
      item.group.remove(item.textSprite);
      item.textSprite.material.map.dispose();
      item.textSprite.material.dispose();
      item.textSprite = null;
    }

    // Mesh
    const mesh = new THREE.Mesh(geom, mat);
    item.mesh = mesh;
    item.group.add(mesh);

    if (this.isMobile) {
      const glowMat = mat.clone();
      glowMat.transparent = true;
      glowMat.opacity = 0.65;
      glowMat.blending = THREE.AdditiveBlending;
      glowMat.depthWrite = false;
      const glowMesh = new THREE.Mesh(geom, glowMat);
      glowMesh.scale.setScalar(1.35); // increased glow size for better visibility
      item.glowMesh = glowMesh;
      item.group.add(glowMesh);
    }

    // No floating text label anymore (removed per user request)
    item.textSprite = null;

    item.active = true;
    item.type = type;
    item.spawnTime = performance.now() / 1000;
    item.bobOffset = Math.random() * Math.PI * 2;

    // Set height to terrainHeight + 160 (pushed down 50 units from +210)
    item.group.position.set(x, terrainHeight + 160, z);
    item.group.visible = true;
  }

  update(deltaTime) {
    const time = performance.now() / 1000;

    for (const item of this.pool) {
      if (!item.active) continue;

      // Bobbing and rotation logic
      const elapsed = time - item.spawnTime;
      const bob = Math.sin(elapsed * 2.0 + item.bobOffset) * 6;
      item.mesh.position.y = bob;
      if (item.textSprite) {
        item.textSprite.position.y = bob + 36; // keep label floating relative to bobbing mesh
      }

      // Spin
      item.mesh.rotation.y += 1.2 * deltaTime;
      item.mesh.rotation.x += 0.5 * deltaTime;
    }
  }

  collect(item) {
    item.active = false;
    item.group.visible = false;
    if (item.mesh) {
      item.group.remove(item.mesh);
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.mesh = null;
    }
    if (item.textSprite) {
      item.group.remove(item.textSprite);
      item.textSprite.material.map.dispose();
      item.textSprite.material.dispose();
      item.textSprite = null;
    }
  }

  reset() {
    for (const item of this.pool) {
      item.active = false;
      item.group.visible = false;
      if (item.mesh) {
        item.group.remove(item.mesh);
        item.mesh.geometry.dispose();
        item.mesh.material.dispose();
        item.mesh = null;
      }
      if (item.textSprite) {
        item.group.remove(item.textSprite);
        item.textSprite.material.map.dispose();
        item.textSprite.material.dispose();
        item.textSprite = null;
      }
    }
    this.activePowerUps = [];
  }
}
