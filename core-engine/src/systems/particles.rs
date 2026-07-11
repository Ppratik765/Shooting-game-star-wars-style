/// Particle physics engine — manages a fixed-size pool of particles.
///
/// Uses a Structure-of-Arrays (SoA) layout for cache-friendly iteration.
/// Outputs contiguous 4x4 matrix and RGB color buffers that JS maps
/// directly to Three.js InstancedMesh.instanceMatrix and instanceColor.

/// Simple xorshift32 PRNG — no external dependencies needed for Wasm.
struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Rng { state: if seed == 0 { 1 } else { seed } }
    }

    /// Returns a u32 in full range.
    fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// Returns a float in [0.0, 1.0).
    fn next_f32(&mut self) -> f32 {
        (self.next_u32() & 0x00FF_FFFF) as f32 / 16777216.0
    }

    /// Returns a float in [-0.5, 0.5).
    fn next_f32_centered(&mut self) -> f32 {
        self.next_f32() - 0.5
    }
}

pub struct ParticleEngine {
    max_particles: usize,


    // SoA particle data
    active: Vec<bool>,
    pos_x: Vec<f32>,
    pos_y: Vec<f32>,
    pos_z: Vec<f32>,
    vel_x: Vec<f32>,
    vel_y: Vec<f32>,
    vel_z: Vec<f32>,
    age: Vec<f32>,
    life: Vec<f32>,
    color_r: Vec<f32>,
    color_g: Vec<f32>,
    color_b: Vec<f32>,

    // Output buffers — read directly by JS via Float32Array
    matrix_buf: Vec<f32>,  // maxParticles × 16 (4x4 matrices)
    color_buf: Vec<f32>,   // maxParticles × 3 (RGB)
    active_count: u32,

    rng: Rng,
}

impl ParticleEngine {
    pub fn new(max_particles: u32, _is_mobile: bool) -> Self {
        let n = max_particles as usize;
        ParticleEngine {
            max_particles: n,

            active: vec![false; n],
            pos_x: vec![0.0; n],
            pos_y: vec![0.0; n],
            pos_z: vec![0.0; n],
            vel_x: vec![0.0; n],
            vel_y: vec![0.0; n],
            vel_z: vec![0.0; n],
            age: vec![0.0; n],
            life: vec![0.0; n],
            color_r: vec![0.0; n],
            color_g: vec![0.0; n],
            color_b: vec![0.0; n],

            matrix_buf: vec![0.0; n * 16],
            color_buf: vec![0.0; n * 3],
            active_count: 0,

            rng: Rng::new(0xDEAD_BEEF),
        }
    }

    /// Advance all particles by `dt` seconds.
    /// Applies gravity, advances age, computes scale, writes matrices.
    /// Returns the number of active particles.
    pub fn update(&mut self, dt: f32) -> u32 {
        let gravity = -25.0;
        let mut count: u32 = 0;

        for i in 0..self.max_particles {
            if !self.active[i] { continue; }

            self.age[i] += dt;
            if self.age[i] >= self.life[i] {
                self.active[i] = false;
                continue;
            }

            // Apply gravity
            self.vel_y[i] += gravity * dt;

            // Integrate position
            self.pos_x[i] += self.vel_x[i] * dt;
            self.pos_y[i] += self.vel_y[i] * dt;
            self.pos_z[i] += self.vel_z[i] * dt;

            // Compute scale (shrink over lifetime)
            let scale = (1.0 - self.age[i] / self.life[i]).max(0.0);

            // Write 4x4 identity matrix with position and uniform scale.
            // Column-major order (matching Three.js Matrix4):
            //   [sx  0  0  0]     indices: [0  1  2  3 ]
            //   [ 0 sy  0  0]              [4  5  6  7 ]
            //   [ 0  0 sz  0]              [8  9  10 11]
            //   [tx ty tz  1]              [12 13 14 15]
            let base = count as usize * 16;
            // Zero first (most elements are 0)
            self.matrix_buf[base..base + 16].fill(0.0);
            self.matrix_buf[base + 0] = scale;      // m[0][0] = sx
            self.matrix_buf[base + 5] = scale;      // m[1][1] = sy
            self.matrix_buf[base + 10] = scale;     // m[2][2] = sz
            self.matrix_buf[base + 12] = self.pos_x[i]; // m[3][0] = tx
            self.matrix_buf[base + 13] = self.pos_y[i]; // m[3][1] = ty
            self.matrix_buf[base + 14] = self.pos_z[i]; // m[3][2] = tz
            self.matrix_buf[base + 15] = 1.0;       // m[3][3] = 1

            // Write color
            let cbase = count as usize * 3;
            self.color_buf[cbase] = self.color_r[i];
            self.color_buf[cbase + 1] = self.color_g[i];
            self.color_buf[cbase + 2] = self.color_b[i];

            count += 1;
        }

        self.active_count = count;
        count
    }

    /// Spawn an airburst explosion (enemy killed mid-air).
    /// burst_count: 120 desktop, 50 mobile.
    pub fn spawn_airburst(&mut self, x: f32, y: f32, z: f32, burst_count: u32) {
        for _ in 0..burst_count {
            let idx = match self.find_free() {
                Some(i) => i,
                None => break,
            };

            self.active[idx] = true;
            self.pos_x[idx] = x;
            self.pos_y[idx] = y;
            self.pos_z[idx] = z;
            self.vel_x[idx] = self.rng.next_f32_centered() * 140.0;
            self.vel_y[idx] = self.rng.next_f32_centered() * 140.0;
            self.vel_z[idx] = self.rng.next_f32_centered() * 140.0;
            self.age[idx] = 0.0;
            self.life[idx] = 0.3 + self.rng.next_f32() * 0.7;

            let r = self.rng.next_f32();
            if r > 0.8 {
                self.set_color_hex(idx, 0xffffff);
            } else if r > 0.4 {
                self.set_color_hex(idx, 0xffaa00);
            } else {
                self.set_color_hex(idx, 0xff0000);
            }
        }
    }

    /// Spawn a ground explosion (enemy crashes into terrain).
    /// ground_count: 80 desktop, 30 mobile.
    pub fn spawn_ground_explosion(&mut self, x: f32, y: f32, z: f32, ground_count: u32) {
        for _ in 0..ground_count {
            let idx = match self.find_free() {
                Some(i) => i,
                None => break,
            };

            self.active[idx] = true;
            self.pos_x[idx] = x;
            self.pos_y[idx] = y;
            self.pos_z[idx] = z;
            self.vel_x[idx] = self.rng.next_f32_centered() * 100.0;
            self.vel_y[idx] = self.rng.next_f32() * 50.0;
            self.vel_z[idx] = self.rng.next_f32_centered() * 100.0;
            self.age[idx] = 0.0;
            self.life[idx] = 0.8 + self.rng.next_f32() * 1.2;

            if self.rng.next_f32() > 0.5 {
                self.set_color_hex(idx, 0xff0000);
            } else {
                self.set_color_hex(idx, 0xff6600);
            }
        }
    }

    /// Spawn a laser impact splash.
    /// impact_count: 20 desktop, 8 mobile.
    pub fn spawn_laser_impact(&mut self, x: f32, y: f32, z: f32, impact_count: u32) {
        for _ in 0..impact_count {
            let idx = match self.find_free() {
                Some(i) => i,
                None => break,
            };

            self.active[idx] = true;
            self.pos_x[idx] = x;
            self.pos_y[idx] = y;
            self.pos_z[idx] = z;
            self.vel_x[idx] = self.rng.next_f32_centered() * 60.0;
            self.vel_y[idx] = self.rng.next_f32() * 35.0;
            self.vel_z[idx] = self.rng.next_f32_centered() * 60.0;
            self.age[idx] = 0.0;
            self.life[idx] = 0.2 + self.rng.next_f32() * 0.4;

            let r = self.rng.next_f32();
            if r > 0.6 {
                self.set_color_hex(idx, 0xff0000);
            } else if r > 0.3 {
                self.set_color_hex(idx, 0xff8800);
            } else {
                self.set_color_hex(idx, 0xffcc00);
            }
        }
    }

    /// Find the first inactive particle slot. Returns index or -1.
    /// Exposed so GameManager.js can get a "free" particle for death smoke.
    pub fn get_free(&mut self) -> i32 {
        match self.find_free() {
            Some(i) => i as i32,
            None => -1,
        }
    }

    /// Activate a specific particle by index.
    /// Used by JS for death sequence smoke (GameManager line ~1203).
    pub fn activate(
        &mut self,
        index: u32,
        x: f32, y: f32, z: f32,
        vx: f32, vy: f32, vz: f32,
        life_val: f32,
        r: f32, g: f32, b: f32,
    ) {
        let i = index as usize;
        if i >= self.max_particles { return; }
        self.active[i] = true;
        self.pos_x[i] = x;
        self.pos_y[i] = y;
        self.pos_z[i] = z;
        self.vel_x[i] = vx;
        self.vel_y[i] = vy;
        self.vel_z[i] = vz;
        self.age[i] = 0.0;
        self.life[i] = life_val;
        self.color_r[i] = r;
        self.color_g[i] = g;
        self.color_b[i] = b;
    }

    /// Returns a pointer to the matrix buffer (active_count × 16 floats).
    pub fn get_matrix_ptr(&self) -> *const f32 {
        self.matrix_buf.as_ptr()
    }

    /// Returns a pointer to the color buffer (active_count × 3 floats).
    pub fn get_color_ptr(&self) -> *const f32 {
        self.color_buf.as_ptr()
    }

    /// Returns the number of active particles after the last `update()`.
    pub fn get_active_count(&self) -> u32 {
        self.active_count
    }

    /// Deactivate all particles.
    pub fn reset(&mut self) {
        for i in 0..self.max_particles {
            self.active[i] = false;
        }
        self.active_count = 0;
    }

    // --- Private helpers ---

    fn find_free(&self) -> Option<usize> {
        for i in 0..self.max_particles {
            if !self.active[i] { return Some(i); }
        }
        None
    }

    fn set_color_hex(&mut self, idx: usize, hex: u32) {
        self.color_r[idx] = ((hex >> 16) & 0xFF) as f32 / 255.0;
        self.color_g[idx] = ((hex >> 8) & 0xFF) as f32 / 255.0;
        self.color_b[idx] = (hex & 0xFF) as f32 / 255.0;
    }
}
