import * as THREE from 'three';

// === JS port of the GLSL Ashima Arts simplex noise (must match shader exactly) ===
function mod289_2(x0, x1) {
  return [x0 - Math.floor(x0 / 289.0) * 289.0, x1 - Math.floor(x1 / 289.0) * 289.0];
}
function mod289_3(x0, x1, x2) {
  return [
    x0 - Math.floor(x0 / 289.0) * 289.0,
    x1 - Math.floor(x1 / 289.0) * 289.0,
    x2 - Math.floor(x2 / 289.0) * 289.0
  ];
}
function permute3(x0, x1, x2) {
  return mod289_3(
    ((x0 * 34.0) + 1.0) * x0,
    ((x1 * 34.0) + 1.0) * x1,
    ((x2 * 34.0) + 1.0) * x2
  );
}
function snoise2D(vx, vy) {
  const Cx = 0.211324865405187, Cy = 0.366025403784439, Cz = -0.577350269189626, Cw = 0.024390243902439;
  const dotVCyy = vx * Cy + vy * Cy;
  let ix = Math.floor(vx + dotVCyy);
  let iy = Math.floor(vy + dotVCyy);
  const dotICxx = ix * Cx + iy * Cx;
  const x0x = vx - ix + dotICxx;
  const x0y = vy - iy + dotICxx;
  const i1x = (x0x > x0y) ? 1.0 : 0.0;
  const i1y = (x0x > x0y) ? 0.0 : 1.0;
  let x12_0 = x0x + Cx - i1x;
  let x12_1 = x0y + Cx - i1y;
  let x12_2 = x0x + Cz;
  let x12_3 = x0y + Cz;
  [ix, iy] = mod289_2(ix, iy);
  const inner = permute3(iy, iy + i1y, iy + 1.0);
  const p = permute3(inner[0] + ix, inner[1] + ix + i1x, inner[2] + ix + 1.0);
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0.0);
  let m1 = Math.max(0.5 - (x12_0 * x12_0 + x12_1 * x12_1), 0.0);
  let m2 = Math.max(0.5 - (x12_2 * x12_2 + x12_3 * x12_3), 0.0);
  m0 *= m0; m0 *= m0;
  m1 *= m1; m1 *= m1;
  m2 *= m2; m2 *= m2;
  const fract = (v) => v - Math.floor(v);
  const xx0 = 2.0 * fract(p[0] * Cw) - 1.0;
  const xx1 = 2.0 * fract(p[1] * Cw) - 1.0;
  const xx2 = 2.0 * fract(p[2] * Cw) - 1.0;
  const h0 = Math.abs(xx0) - 0.5, h1 = Math.abs(xx1) - 0.5, h2 = Math.abs(xx2) - 0.5;
  const ox0 = Math.floor(xx0 + 0.5), ox1 = Math.floor(xx1 + 0.5), ox2 = Math.floor(xx2 + 0.5);
  const a0 = xx0 - ox0, a1 = xx1 - ox1, a2 = xx2 - ox2;
  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2);
  const gx = a0 * x0x + h0 * x0y;
  const gy = a1 * x12_0 + h1 * x12_1;
  const gz = a2 * x12_2 + h2 * x12_3;
  return 130.0 * (m0 * gx + m1 * gy + m2 * gz);
}

// JS elevation: MUST mirror the shader logic exactly
function computeElevation(worldX, noiseZ, ns, hs) {
  // Ridged noise: abs() creates mountain ridges instead of symmetric waves
  const n1 = Math.abs(snoise2D(worldX * ns, noiseZ * ns));
  const n2 = Math.abs(snoise2D(worldX * ns * 3.0, noiseZ * ns * 3.0));
  const n3 = Math.abs(snoise2D(worldX * ns * 7.0, noiseZ * ns * 7.0));
  // Base terrain floor + mountains rising from it
  let elevation = n1 * hs + n2 * (hs * 0.25) + n3 * (hs * 0.08);
  // Slight floor so valleys aren't at zero
  elevation = Math.max(elevation, 3.0);
  return elevation;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.gridSize = 370;   // 1.5x the original 300
    this.gridSpacing = 5;
    this.ns = 0.003;
    this.hs = 140.0;
    this.speed = 30.0;
    this._createMesh();
  }

  _createMesh() {
    const geometry = new THREE.BufferGeometry();
    const totalPoints = this.gridSize * this.gridSize;
    const positions = new Float32Array(totalPoints * 3);
    let i = 0;
    const offset = (this.gridSize * this.gridSpacing) / 2;
    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        positions[i * 3] = x * this.gridSpacing - offset;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z * this.gridSpacing - offset;
        i++;
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: this.speed },
        uNoiseScale: { value: this.ns },
        uHeightScale: { value: this.hs },
        uCamX: { value: 0 }
      },
      vertexShader: /* glsl */`
        uniform float uTime, uSpeed, uNoiseScale, uHeightScale, uCamX;
        vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}
        float snoise(vec2 v){
          const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
          vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
          vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
          vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod289(i);
          vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
          vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
          m=m*m;m=m*m;
          vec3 x_=2.0*fract(p*C.www)-1.0;vec3 h=abs(x_)-0.5;
          vec3 ox=floor(x_+0.5);vec3 a0=x_-ox;
          m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
          vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
          return 130.0*dot(m,g);
        }
        varying float vElevation;
        void main(){
          float worldX = position.x + uCamX;
          float noiseZ = position.z - uTime * uSpeed;
          // Ridged noise: abs() creates mountain ridges, not symmetric waves
          float n1 = abs(snoise(vec2(worldX * uNoiseScale, noiseZ * uNoiseScale)));
          float n2 = abs(snoise(vec2(worldX * uNoiseScale * 3.0, noiseZ * uNoiseScale * 3.0)));
          float n3 = abs(snoise(vec2(worldX * uNoiseScale * 7.0, noiseZ * uNoiseScale * 7.0)));
          float elevation = n1 * uHeightScale + n2 * (uHeightScale * 0.25) + n3 * (uHeightScale * 0.08);
          elevation = max(elevation, 3.0);
          vec3 newPos = position;
          newPos.y = elevation;
          vElevation = elevation;
          vec4 mvPos = modelViewMatrix * vec4(newPos, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = max(100.0 / -mvPos.z, 1.5);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vElevation;
        uniform float uHeightScale;
        void main(){
          // Normalize: terrain goes from ~3 to ~hs. Map to 0..1
          float t = clamp(vElevation / uHeightScale, 0.0, 1.0);
          vec3 deepBlue = vec3(0.0, 0.05, 0.3);
          vec3 medBlue  = vec3(0.0, 0.3, 0.6);
          vec3 cyan     = vec3(0.0, 0.7, 1.0);
          vec3 white    = vec3(0.95, 0.98, 1.0);
          // Gradient: deep blue valleys -> blue -> cyan slopes -> white peaks
          vec3 col = deepBlue;
          if(t < 0.25) col = mix(deepBlue, medBlue, t * 4.0);
          else if(t < 0.5) col = mix(medBlue, cyan, (t - 0.25) * 4.0);
          else col = mix(cyan, white, (t - 0.5) * 2.0);
          vec2 c = 2.0 * gl_PointCoord - 1.0;
          if(dot(c, c) > 1.0) discard;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true
    });

    this.points = new THREE.Points(geometry, this.material);
    this.scene.add(this.points);
  }

  update(deltaTime, distanceTraveled, cameraX) {
    this.material.uniforms.uTime.value = distanceTraveled * 0.05;
    this.material.uniforms.uCamX.value = cameraX;
    this.points.position.x = cameraX;
  }

  getHeightAt(worldX, worldZ, distanceTraveled) {
    const t = distanceTraveled * 0.05;
    const noiseZ = worldZ - t * this.speed;
    return computeElevation(worldX, noiseZ, this.ns, this.hs);
  }
}
