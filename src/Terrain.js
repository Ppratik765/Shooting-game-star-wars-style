import * as THREE from 'three';

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

// Layered terrain: macro mountains + hills + canyons
function computeElevation(worldX, worldZ, ns, hs) {
  // --- MACRO: large mountain ranges ---
  const macro = snoise2D(worldX * ns * 0.4, worldZ * ns * 0.4);          // very large features
  const macroAbs = Math.pow(Math.abs(macro), 1.6) * Math.sign(macro + 0.1);

  // --- MID: hills and ridges ---
  const mid = snoise2D(worldX * ns * 1.2, worldZ * ns * 1.2);
  const midAbs = Math.pow(Math.abs(mid), 1.1);

  // --- DETAIL: small bumps ---
  const detail = snoise2D(worldX * ns * 4.0, worldZ * ns * 4.0) * 0.15;

  // --- CANYON: subtract a canyon layer for dramatic cuts ---
  const canyonNoise = snoise2D(worldX * ns * 0.7 + 3.7, worldZ * ns * 0.7 + 1.3);
  const canyonCut = Math.max(0.0, 1.0 - Math.abs(canyonNoise) * 3.5); // sharp cuts

  // Combine layers
  let elevation = macroAbs * hs * 1.1
    + midAbs * hs * 0.45
    + detail * hs;

  // Canyon subtraction (cut deep valleys into the terrain)
  elevation -= canyonCut * hs * 0.6;

  // Ensure a minimum floor
  elevation = Math.max(elevation, 3.0);
  return elevation;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    // Higher density grid, tighter spacing for smoother terrain
    this.gridSize = 480;
    this.gridSpacing = 6;
    this.ns = 0.0022;
    this.hs = 90.0;
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
        positions[i * 3]     = x * this.gridSpacing - offset;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z * this.gridSpacing - offset;
        i++;
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uNoiseScale:  { value: this.ns },
        uHeightScale: { value: this.hs },
        uCamX:        { value: 0 },
        uCamZ:        { value: 0 }
      },
      vertexShader: /* glsl */`
        uniform float uNoiseScale, uHeightScale, uCamX, uCamZ;

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

        float getElevation(float wx, float wz) {
          // Macro mountains
          float macro = snoise(vec2(wx * uNoiseScale * 0.4, wz * uNoiseScale * 0.4));
          float macroAbs = pow(abs(macro), 1.6) * sign(macro + 0.1);

          // Mid hills
          float mid = snoise(vec2(wx * uNoiseScale * 1.2, wz * uNoiseScale * 1.2));
          float midAbs = pow(abs(mid), 1.1);

          // Detail
          float detail = snoise(vec2(wx * uNoiseScale * 4.0, wz * uNoiseScale * 4.0)) * 0.15;

          // Canyons
          float canyonNoise = snoise(vec2(wx * uNoiseScale * 0.7 + 3.7, wz * uNoiseScale * 0.7 + 1.3));
          float canyonCut = max(0.0, 1.0 - abs(canyonNoise) * 3.5);

          float elev = macroAbs * uHeightScale * 1.1
                     + midAbs  * uHeightScale * 0.45
                     + detail  * uHeightScale;
          elev -= canyonCut * uHeightScale * 0.6;
          return max(elev, 3.0);
        }

        varying float vElevation;
        varying float vDist;
        varying vec2  vLocalXZ;

        void main(){
          float worldX = position.x + uCamX;
          float worldZ = position.z + uCamZ;
          vLocalXZ = position.xz;

          float elevation = getElevation(worldX, worldZ);
          vElevation = elevation;

          vec3 newPos = vec3(position.x, elevation, position.z);
          vec4 mvPos  = modelViewMatrix * vec4(newPos, 1.0);
          gl_Position = projectionMatrix * mvPos;

          // Fixed point size — no distance scaling that causes flicker
          float dist = -mvPos.z;
          // Clamp point size: large up close, minimum far away
          gl_PointSize = clamp(180.0 / dist, 1.8, 5.0);

          vDist = dist;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vElevation;
        varying float vDist;
        varying vec2  vLocalXZ;
        uniform float uHeightScale;

        void main(){
          // Circular point shape (discard corners)
          vec2 c = 2.0 * gl_PointCoord - 1.0;
          float r = dot(c, c);
          if(r > 1.0) discard;

          float t = clamp(vElevation / uHeightScale, 0.0, 1.0);

          // Valley = deep blue, slopes = cyan, peaks = bright cyan-white
          vec3 valleyCol = vec3(0.0, 0.05, 0.28);
          vec3 hillCol   = vec3(0.0, 0.25, 0.55);
          vec3 slopeCol  = vec3(0.0, 0.55, 0.85);
          vec3 peakCol   = vec3(0.5, 0.9, 1.0);

          vec3 col;
          if(t < 0.25)      col = mix(valleyCol, hillCol,  t / 0.25);
          else if(t < 0.55) col = mix(hillCol,  slopeCol, (t - 0.25) / 0.30);
          else              col = mix(slopeCol,  peakCol,  (t - 0.55) / 0.45);

          // Distance fade
          float distFade = clamp(1.0 - vDist / 1400.0, 0.12, 1.0);
          col *= distFade;

          // Radial edge fade for terrain grid boundary
          float radialDist = length(vLocalXZ);
          float alpha = smoothstep(1440.0, 1100.0, radialDist);

          // Soft point edge (anti-alias)
          float softEdge = 1.0 - smoothstep(0.6, 1.0, r);

          gl_FragColor = vec4(col, alpha * softEdge);
        }
      `,
      transparent: true,
      depthWrite: false  // prevents z-fighting / flickering between points
    });

    this.points = new THREE.Points(geometry, this.material);
    this.scene.add(this.points);
  }

  update(cameraX, cameraZ) {
    this.material.uniforms.uCamX.value = cameraX;
    this.material.uniforms.uCamZ.value = cameraZ;
    this.points.position.x = cameraX;
    this.points.position.z = cameraZ;
  }

  getHeightAt(worldX, worldZ) {
    return computeElevation(worldX, worldZ, this.ns, this.hs);
  }
}
