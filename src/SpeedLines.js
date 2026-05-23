import * as THREE from 'three';

export class SpeedLines {
  constructor(camera, count = 60) {
    this.camera = camera;
    this.count = count;
    this.opacity = 0;

    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 2 * 3);

    this.lineData = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 180;
      const y = (Math.random() - 0.5) * 180;
      const z = -450 + Math.random() * 450;
      const length = 20 + Math.random() * 30;

      this.lineData.push({ x, y, z, length });

      // Start
      this.positions[i * 6] = x;
      this.positions[i * 6 + 1] = y;
      this.positions[i * 6 + 2] = z;

      // End
      this.positions[i * 6 + 3] = x;
      this.positions[i * 6 + 4] = y;
      this.positions[i * 6 + 5] = z + length;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.material = new THREE.LineBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 1.5 // note: linewidth > 1 usually ignored by WebGL, but good practice
    });

    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.camera.add(this.mesh);
  }

  update(deltaTime, isBoosting) {
    if (isBoosting) {
      this.opacity = THREE.MathUtils.lerp(this.opacity, 0.85, 6.0 * deltaTime);
    } else {
      this.opacity = THREE.MathUtils.lerp(this.opacity, 0.0, 8.0 * deltaTime);
    }

    this.material.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.01;

    if (!this.mesh.visible) return;

    const speed = 1100; // fast forward speed lines
    const posAttr = this.geometry.attributes.position;

    for (let i = 0; i < this.count; i++) {
      const data = this.lineData[i];
      data.z += speed * deltaTime;

      if (data.z > 50) {
        data.z = -450 - Math.random() * 100;
        data.x = (Math.random() - 0.5) * 180;
        data.y = (Math.random() - 0.5) * 180;
        data.length = 20 + Math.random() * 30;
      }

      posAttr.setXYZ(i * 2, data.x, data.y, data.z);
      // Elongate lines more during speed
      posAttr.setXYZ(i * 2 + 1, data.x, data.y, data.z + data.length * 1.5);
    }

    posAttr.needsUpdate = true;
  }

  destroy() {
    this.camera.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
