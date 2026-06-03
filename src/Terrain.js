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

// Layered terrain: wide mountains, no flat land, irregular everywhere
function computeElevation(worldX, worldZ, ns, hs) {
  // --- Heavy domain warp: distort coordinates for very irregular shapes ---
  const warpX = snoise2D(worldX * ns * 0.2 + 7.3, worldZ * ns * 0.2 + 2.1) * 150;
  const warpZ = snoise2D(worldX * ns * 0.2 + 13.7, worldZ * ns * 0.2 + 9.4) * 150;
  const wx = worldX + warpX;
  const wz = worldZ + warpZ;

  // --- CONTINENT: very wide, rolling landscape base (low freq, high amplitude) ---
  const continent = snoise2D(wx * ns * 0.12, wz * ns * 0.12);
  const continentShaped = (continent * 0.5 + 0.5); // 0..1 range, always positive
  const continentElev = continentShaped * continentShaped * hs * 1.2;

  // --- MACRO: wide mountain masses ---
  const macro = snoise2D(wx * ns * 0.3, wz * ns * 0.3);
  const macroShaped = Math.pow(Math.abs(macro), 0.8) * hs * 0.9;

  // --- MID: hills ---
  const mid = snoise2D(wx * ns * 0.7, wz * ns * 0.7);
  const midShaped = Math.abs(mid) * hs * 0.4;

  // --- RIDGES: sharp ridge lines ---
  const ridge = snoise2D(wx * ns * 1.2 + 5.0, wz * ns * 1.2 + 3.0);
  const ridgeLine = 1.0 - Math.abs(ridge);
  const ridgeSharp = Math.pow(ridgeLine, 1.6) * hs * 0.18;

  // --- BUMPS: medium detail ---
  const bumps = snoise2D(wx * ns * 2.5, wz * ns * 2.5) * hs * 0.08;

  // --- MICRO: fine texture everywhere so nothing feels flat ---
  const micro1 = snoise2D(wx * ns * 5.0 + 20.0, wz * ns * 5.0 + 15.0) * hs * 0.04;
  const micro2 = snoise2D(wx * ns * 10.0 + 50.0, wz * ns * 10.0 + 35.0) * hs * 0.015;

  // --- CANYON: deep cuts between mountains ---
  const canyonNoise = snoise2D(wx * ns * 0.4 + 3.7, wz * ns * 0.4 + 1.3);
  const canyonCut = Math.max(0.0, 1.0 - Math.abs(canyonNoise) * 2.5);
  const canyonDeep = Math.pow(canyonCut, 1.8) * hs * 0.7;

  // --- Second canyon at different angle ---
  const canyon2 = snoise2D(wx * ns * 0.5 + 11.2, wz * ns * 0.5 + 7.8);
  const canyon2Cut = Math.max(0.0, 1.0 - Math.abs(canyon2) * 3.0);
  const canyon2Deep = Math.pow(canyon2Cut, 2.0) * hs * 0.4;

  // Combine — no flat areas possible because continent base is always > 0
  let elevation = continentElev
    + macroShaped
    + midShaped
    + ridgeSharp
    + bumps
    + micro1
    + micro2;

  // Canyon subtraction
  elevation -= canyonDeep;
  elevation -= canyon2Deep;

  // Irregular floor — never truly flat, always bumpy minimum
  const floorNoise = snoise2D(worldX * ns * 3.0 + 40.0, worldZ * ns * 3.0 + 25.0);
  const floorNoise2 = snoise2D(worldX * ns * 7.0 + 60.0, worldZ * ns * 7.0 + 45.0);
  const minFloor = 15.0 + floorNoise * 12.0 + floorNoise2 * 5.0;
  elevation = Math.max(elevation, minFloor);

  return elevation;
}

export class Terrain {
  constructor(scene, isMobile = false) {
    this.scene = scene;
    this.gridSize = isMobile ? 400 : 700;
    this.gridSpacing = isMobile ? 12 : 8;
    this.ns = 0.0016;   // slightly lower freq = wider mountains
    this.hs = 220.0;    // taller
    this.maxRadius = (this.gridSize * this.gridSpacing) / 2;
    this.fadeStart = this.maxRadius - 800; // 800 unit fade window
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
        uCamZ:        { value: 0 },
        uActualCamX:  { value: 0 },
        uActualCamZ:  { value: 0 },
        uMaxRadius:   { value: this.maxRadius },
        uFadeStart:   { value: this.fadeStart },
        uLightning:   { value: 0.0 }
      },
      vertexShader: /* glsl */`
        uniform float uNoiseScale, uHeightScale, uCamX, uCamZ, uActualCamX, uActualCamZ;
        uniform float uMaxRadius, uFadeStart;

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
          // Heavy domain warp
          float warpX = snoise(vec2(wx * uNoiseScale * 0.2 + 7.3, wz * uNoiseScale * 0.2 + 2.1)) * 150.0;
          float warpZ = snoise(vec2(wx * uNoiseScale * 0.2 + 13.7, wz * uNoiseScale * 0.2 + 9.4)) * 150.0;
          float wwx = wx + warpX;
          float wwz = wz + warpZ;

          // Continent base — always positive, wide rolling
          float continent = snoise(vec2(wwx * uNoiseScale * 0.12, wwz * uNoiseScale * 0.12));
          float continentShaped = (continent * 0.5 + 0.5);
          float continentElev = continentShaped * continentShaped * uHeightScale * 1.2;

          // Wide mountains
          float macro = snoise(vec2(wwx * uNoiseScale * 0.3, wwz * uNoiseScale * 0.3));
          float macroShaped = pow(abs(macro), 0.8) * uHeightScale * 0.9;

          // Hills
          float mid = snoise(vec2(wwx * uNoiseScale * 0.7, wwz * uNoiseScale * 0.7));
          float midShaped = abs(mid) * uHeightScale * 0.4;

          // Ridges
          float ridge = snoise(vec2(wwx * uNoiseScale * 1.2 + 5.0, wwz * uNoiseScale * 1.2 + 3.0));
          float ridgeLine = 1.0 - abs(ridge);
          float ridgeSharp = pow(ridgeLine, 1.6) * uHeightScale * 0.18;

          // Bumps
          float bumps = snoise(vec2(wwx * uNoiseScale * 2.5, wwz * uNoiseScale * 2.5)) * uHeightScale * 0.08;

          // Micro texture
          float micro1 = snoise(vec2(wwx * uNoiseScale * 5.0 + 20.0, wwz * uNoiseScale * 5.0 + 15.0)) * uHeightScale * 0.04;
          float micro2 = snoise(vec2(wwx * uNoiseScale * 10.0 + 50.0, wwz * uNoiseScale * 10.0 + 35.0)) * uHeightScale * 0.015;

          // Canyons
          float canyonNoise = snoise(vec2(wwx * uNoiseScale * 0.4 + 3.7, wwz * uNoiseScale * 0.4 + 1.3));
          float canyonCut = max(0.0, 1.0 - abs(canyonNoise) * 2.5);
          float canyonDeep = pow(canyonCut, 1.8) * uHeightScale * 0.7;

          float canyon2 = snoise(vec2(wwx * uNoiseScale * 0.5 + 11.2, wz * uNoiseScale * 0.5 + 7.8));
          float canyon2Cut = max(0.0, 1.0 - abs(canyon2) * 3.0);
          float canyon2Deep = pow(canyon2Cut, 2.0) * uHeightScale * 0.4;

          float elev = continentElev
                     + macroShaped
                     + midShaped
                     + ridgeSharp
                     + bumps
                     + micro1
                     + micro2;

          elev -= canyonDeep;
          elev -= canyon2Deep;

          // Irregular floor
          float floorNoise = snoise(vec2(wx * uNoiseScale * 3.0 + 40.0, wz * uNoiseScale * 3.0 + 25.0));
          float floorNoise2 = snoise(vec2(wx * uNoiseScale * 7.0 + 60.0, wz * uNoiseScale * 7.0 + 45.0));
          float minFloor = 15.0 + floorNoise * 12.0 + floorNoise2 * 5.0;
          return max(elev, minFloor);
        }

        varying float vElevation;
        varying float vDist;
        varying float vRadialDist;

        void main(){
          float worldX = position.x + uCamX;
          float worldZ = position.z + uCamZ;

          float elevation = getElevation(worldX, worldZ);
          vElevation = elevation;

          vec3 newPos = vec3(position.x, elevation, position.z);
          vec4 mvPos  = modelViewMatrix * vec4(newPos, 1.0);
          gl_Position = projectionMatrix * mvPos;

          float dist = -mvPos.z;
          gl_PointSize = clamp(180.0 / dist, 1.6, 3.5);

          vDist = dist;
          vRadialDist = length(vec2(worldX - uActualCamX, worldZ - uActualCamZ));
        }
      `,
      fragmentShader: /* glsl */`
        varying float vElevation;
        varying float vDist;
        varying float vRadialDist;
        uniform float uHeightScale;
        uniform float uMaxRadius, uFadeStart;
        uniform float uLightning;

        void main(){
          vec2 c = 2.0 * gl_PointCoord - 1.0;
          float r = dot(c, c);
          if(r > 1.0) discard;

          float t = clamp(vElevation / uHeightScale, 0.0, 1.0);

          // Deep canyons = dark blue/purple, slopes = cyan, peaks = bright white-cyan
          vec3 canyonCol = vec3(0.0, 0.02, 0.15);
          vec3 valleyCol = vec3(0.0, 0.06, 0.30);
          vec3 hillCol   = vec3(0.0, 0.20, 0.50);
          vec3 slopeCol  = vec3(0.0, 0.40, 0.65);
          vec3 ridgeCol  = vec3(0.15, 0.45, 0.70);
          vec3 peakCol   = vec3(0.40, 0.50, 0.60);

          vec3 col;
          if(t < 0.08)      col = mix(canyonCol, valleyCol, t / 0.08);
          else if(t < 0.22) col = mix(valleyCol, hillCol,   (t - 0.08) / 0.14);
          else if(t < 0.45) col = mix(hillCol,   slopeCol,  (t - 0.22) / 0.23);
          else if(t < 0.70) col = mix(slopeCol,  ridgeCol,  (t - 0.45) / 0.25);
          else if(t < 0.88) col = mix(ridgeCol,  peakCol,   (t - 0.70) / 0.18);
          else              col = mix(peakCol,   vec3(0.70, 0.73, 0.78), (t - 0.88) / 0.12); // Bright cool white accent

          float distFade = clamp(1.0 - vDist / 2800.0, 0.12, 1.0);
          col *= distFade;

          vec3 fogColor = vec3(0.01, 0.03, 0.10); // Slight blue atmospheric space fog
          float fogFactor = smoothstep(1200.0, 2600.0, vDist);
          col = mix(col, fogColor, fogFactor);

          float alpha = smoothstep(uMaxRadius, uFadeStart, vRadialDist);
          // Only cap alpha for very distant points to prevent overlapping peak brightness buildup
          // Nearby terrain stays fully opaque; beyond 1800 units, max alpha ramps down to 0.55
          float distAlphaCap = mix(1.0, 0.55, smoothstep(1800.0, 2600.0, vDist));
          alpha = min(alpha, distAlphaCap);
          float softEdge = 1.0 - smoothstep(0.6, 1.0, r);

          // Lightning flash hits the terrain
          col = mix(col, vec3(1.0, 1.0, 1.0), uLightning * 0.95);

          gl_FragColor = vec4(col, alpha * softEdge);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    this.points = new THREE.Points(geometry, this.material);
    this.scene.add(this.points);
  }

  update(cameraX, cameraZ) {
    const snapX = Math.floor(cameraX / this.gridSpacing) * this.gridSpacing;
    const snapZ = Math.floor(cameraZ / this.gridSpacing) * this.gridSpacing;

    this.material.uniforms.uCamX.value = snapX;
    this.material.uniforms.uCamZ.value = snapZ;
    this.material.uniforms.uActualCamX.value = cameraX;
    this.material.uniforms.uActualCamZ.value = cameraZ;
    this.points.position.x = snapX;
    this.points.position.z = snapZ;
  }

  getHeightAt(worldX, worldZ) {
    return computeElevation(worldX, worldZ, this.ns, this.hs);
  }
}
