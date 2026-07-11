use crate::InputState;
use crate::entities::player::PlayerState;

/// Central game engine struct that holds all subsystem state.
/// Owns the shared memory buffers that JS reads via Float32Array views.
pub struct GameEngine {
    pub player: PlayerState,

    // Shared memory buffers — written every tick, read by JS
    pub transform_buf: [f32; 7],  // [pos_x, pos_y, pos_z, pitch, yaw, roll, target_fov]
    pub state_buf: [f32; 18],     // game state floats
    pub velocity_buf: [f32; 3],   // [vx, vy, vz]
}

impl GameEngine {
    pub fn new(init_x: f32, init_z: f32) -> GameEngine {
        GameEngine {
            player: PlayerState::new(init_x, init_z),
            transform_buf: [0.0; 7],
            state_buf: [0.0; 18],
            velocity_buf: [0.0; 3],
        }
    }

    pub fn tick(&mut self, dt: f32, input: &InputState, terrain_height: f32, is_intro: bool) -> bool {
        let result = self.player.tick(dt, input, terrain_height, is_intro);
        self.write_buffers();
        result
    }

    /// Write current player state into the shared memory buffers.
    pub fn write_buffers(&mut self) {
        let p = &self.player;

        // Transform buffer
        self.transform_buf[0] = p.pos.x;
        self.transform_buf[1] = p.pos.y;
        self.transform_buf[2] = p.pos.z;
        self.transform_buf[3] = p.pitch;
        self.transform_buf[4] = p.yaw;
        self.transform_buf[5] = p.roll;
        self.transform_buf[6] = p.target_fov;

        // State buffer
        self.state_buf[0] = p.hp;
        self.state_buf[1] = p.max_hp;
        self.state_buf[2] = p.stamina;
        self.state_buf[3] = p.max_stamina;
        self.state_buf[4] = if p.is_stalled { 1.0 } else { 0.0 };
        self.state_buf[5] = p.altitude;
        self.state_buf[6] = p.velocity.length();
        self.state_buf[7] = if p.is_boosting { 1.0 } else { 0.0 };
        self.state_buf[8] = if p.stamina_depleted { 1.0 } else { 0.0 };
        self.state_buf[9] = if p.terrain_warning { 1.0 } else { 0.0 };
        self.state_buf[10] = if p.terrain_crashed { 1.0 } else { 0.0 };
        self.state_buf[11] = if p.shield_active { 1.0 } else { 0.0 };
        self.state_buf[12] = p.stall_recovery_progress;
        self.state_buf[13] = if p.is_above_max_alt { 1.0 } else { 0.0 };
        // Shake: amplitude and progress for JS to apply quaternion perturbation
        let shake_progress = if p.shake_duration > 0.0 {
            p.shake_timer / p.shake_duration
        } else {
            0.0
        };
        self.state_buf[14] = p.shake_intensity * shake_progress * 0.04; // amplitude
        self.state_buf[15] = shake_progress;
        self.state_buf[16] = if p.is_dying { 1.0 } else { 0.0 };
        self.state_buf[17] = p.throttle;

        // Velocity buffer
        self.velocity_buf[0] = p.velocity.x;
        self.velocity_buf[1] = p.velocity.y;
        self.velocity_buf[2] = p.velocity.z;
    }
}
