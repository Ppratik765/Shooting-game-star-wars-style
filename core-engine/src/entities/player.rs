use glam::{Vec3, Quat, EulerRot};

use crate::InputState;
use crate::utils::lerp;

/// All player flight state and physics.
/// This struct owns the numerical simulation — it never touches DOM or JS objects.
pub struct PlayerState {
    // Position & orientation
    pub pos: Vec3,
    pub pitch: f32,
    pub yaw: f32,
    pub roll: f32,
    pub velocity: Vec3,

    // Throttle
    pub throttle: f32,

    // Physics
    pub gravity: f32,

    // Stamina / boost
    pub max_stamina: f32,
    pub stamina: f32,
    pub stamina_drain_rate: f32,
    pub stamina_regen_rate: f32,
    pub is_boosting: bool,
    pub was_boosting: bool,
    pub stamina_depleted: bool,

    // FOV
    pub base_fov: f32,
    pub target_fov: f32,

    // HP
    pub max_hp: f32,
    pub hp: f32,

    // Stall
    pub stall_pitch_threshold: f32,
    pub stall_time_required: f32,
    pub stall_timer: f32,
    pub is_stalled: bool,
    pub stall_recovery_progress: f32,
    pub prev_control_pressed: bool,
    pub infinite_engines_active: bool,
    pub shield_active: bool,

    // Death state
    pub is_dying: bool,
    pub die_from_high: bool,

    // Terrain
    pub terrain_warning: bool,
    pub terrain_crashed: bool,
    pub altitude: f32,
    pub is_above_max_alt: bool,

    // Camera shake
    pub shake_timer: f32,
    pub shake_duration: f32,
    pub shake_intensity: f32,
    pub shake_intensity_scale: f32,
    pub shake_triggered_this_frame: bool,
}

impl PlayerState {
    pub fn new(init_x: f32, init_z: f32) -> PlayerState {
        PlayerState {
            pos: Vec3::new(init_x, 500.0, init_z),
            pitch: -0.05,
            yaw: 0.0,
            roll: 0.0,
            velocity: Vec3::new(0.0, 0.0, -140.0),

            throttle: 140.0,
            gravity: -12.0,

            max_stamina: 100.0,
            stamina: 100.0,
            stamina_drain_rate: 30.0,
            stamina_regen_rate: 15.0,
            is_boosting: false,
            was_boosting: false,
            stamina_depleted: false,

            base_fov: 90.0,
            target_fov: 90.0,

            max_hp: 100.0,
            hp: 100.0,

            stall_pitch_threshold: 0.8,
            stall_time_required: 1.5,
            stall_timer: 0.0,
            is_stalled: false,
            stall_recovery_progress: 0.0,
            prev_control_pressed: false,
            infinite_engines_active: false,
            shield_active: false,

            is_dying: false,
            die_from_high: false,

            terrain_warning: false,
            terrain_crashed: false,
            altitude: 0.0,
            is_above_max_alt: false,

            shake_timer: 0.0,
            shake_duration: 0.22,
            shake_intensity: 0.0,
            shake_intensity_scale: 0.8,
            shake_triggered_this_frame: false,
        }
    }

    pub fn tick(&mut self, dt: f32, input: &InputState, terrain_height: f32, is_intro: bool) -> bool {
        self.shake_triggered_this_frame = false;

        if self.is_dying {
            self.update_dying(dt);
            self.update_shake(dt);
            self.check_terrain(terrain_height, dt);
        } else if self.terrain_crashed {
            // do nothing
        } else if is_intro {
            self.pitch = lerp(self.pitch, 0.0, 2.0 * dt);
            self.roll = lerp(self.roll, 0.0, 2.0 * dt);
            self.throttle = if input.is_mobile { 125.0 } else { 140.0 };
            self.target_fov = self.base_fov;
            self.update_stamina(dt);
            self.apply_physics(dt);
            self.pos.y = lerp(self.pos.y, 350.0, 4.0 * dt);
        } else {
            self.handle_input(dt, input);
            self.update_stamina(dt);
            self.update_stall(dt, input);
            self.apply_physics(dt);
            self.update_shake(dt);
            self.check_terrain(terrain_height, dt);
        }

        self.shake_triggered_this_frame
    }

    pub fn trigger_shake(&mut self, intensity: f32) {
        self.shake_timer = self.shake_duration;
        self.shake_intensity = intensity * self.shake_intensity_scale;
        self.shake_triggered_this_frame = true;
    }

    pub fn die(&mut self) {
        if self.is_dying { return; }
        self.is_dying = true;
        self.die_from_high = self.altitude > 800.0;
        self.velocity.y -= if self.die_from_high { 250.0 } else { 80.0 };
    }

    pub fn reset(&mut self) {
        self.pitch = 0.0;
        self.yaw = 0.0;
        self.roll = 0.0;
        self.velocity = Vec3::new(0.0, 0.0, -140.0);
        self.throttle = 140.0;
        self.stamina = self.max_stamina;
        self.stamina_depleted = false;
        self.is_boosting = false;
        self.was_boosting = false;
        self.is_stalled = false;
        self.stall_recovery_progress = 0.0;
        self.prev_control_pressed = false;
        self.is_dying = false;
        self.die_from_high = false;
        self.stall_timer = 0.0;
        self.terrain_warning = false;
        self.terrain_crashed = false;
        self.hp = self.max_hp;
        self.target_fov = self.base_fov;
        self.altitude = 200.0;
        self.shake_timer = 0.0;
        self.infinite_engines_active = false;
        self.shield_active = false;
    }

    // --- Private helpers ---

    fn handle_input(&mut self, dt: f32, input: &InputState) {
        if self.is_stalled {
            self.throttle = 20.0;
            self.is_boosting = false;
            self.target_fov = self.base_fov;

            self.pitch = lerp(self.pitch, -0.8, 1.2 * dt);
            self.roll = lerp(self.roll, 0.5, 1.0 * dt);
            self.yaw += 0.4 * dt;
            return;
        }

        if input.is_mobile {
            let gyro_pitch_speed = 1.35;
            let gyro_yaw_speed = 1.25;
            let gyro_roll_speed = 3.5;

            self.pitch += input.gyro_pitch_amt * gyro_pitch_speed * dt;

            if input.gyro_roll_amt.abs() > 0.02 {
                self.roll = lerp(self.roll, input.gyro_roll_amt * 1.1, gyro_roll_speed * dt);
                self.yaw += input.gyro_roll_amt * gyro_yaw_speed * dt;
            } else {
                self.roll = lerp(self.roll, 0.0, 3.0 * dt);
            }

            self.throttle = 125.0;
            if input.is_boosting && !self.stamina_depleted {
                if !self.is_boosting && !self.was_boosting {
                    self.trigger_shake(3.0);
                }
                self.is_boosting = true;
                self.target_fov = self.base_fov + 20.0;
                self.throttle = 310.0;
            } else {
                self.is_boosting = false;
                self.target_fov = self.base_fov;
            }
        } else {
            let mouse_sensitivity = 0.0028;

            self.pitch -= input.mouse_movement_y * mouse_sensitivity;
            if input.is_forward { self.pitch += 1.2 * dt; }
            if input.is_backward { self.pitch -= 1.2 * dt; }

            self.yaw -= input.mouse_movement_x * mouse_sensitivity;

            let roll_speed = 2.5;
            if input.is_left {
                self.roll = lerp(self.roll, 1.0, roll_speed * dt);
                self.yaw += 0.8 * dt;
            } else if input.is_right {
                self.roll = lerp(self.roll, -1.0, roll_speed * dt);
                self.yaw -= 0.8 * dt;
            } else {
                self.roll = lerp(self.roll, 0.0, 2.0 * dt);
            }

            self.throttle = 140.0;
            if input.is_boosting && !self.stamina_depleted {
                if !self.is_boosting && !self.was_boosting {
                    self.trigger_shake(3.0);
                }
                self.is_boosting = true;
                self.target_fov = self.base_fov + 20.0;
                self.throttle = 360.0;
            } else {
                self.is_boosting = false;
                self.target_fov = self.base_fov;
            }
        }

        self.was_boosting = input.is_boosting && !self.stamina_depleted;
        self.pitch = self.pitch.clamp(-1.4, 1.4);
    }

    fn update_stamina(&mut self, dt: f32) {
        if self.is_boosting {
            if !self.infinite_engines_active {
                self.stamina -= self.stamina_drain_rate * dt;
            }
            if self.stamina <= 0.0 {
                self.stamina = 0.0;
                self.stamina_depleted = true;
                self.is_boosting = false;
            }
        } else {
            self.stamina += self.stamina_regen_rate * dt;
            if self.stamina >= self.max_stamina {
                self.stamina = self.max_stamina;
            }
            if self.stamina_depleted && self.stamina > self.max_stamina * 0.2 {
                self.stamina_depleted = false;
            }
        }
    }

    fn update_stall(&mut self, dt: f32, input: &InputState) {
        if self.pitch > self.stall_pitch_threshold {
            self.stall_timer += dt;
            if self.stall_timer >= self.stall_time_required {
                if !self.is_stalled {
                    self.is_stalled = true;
                    self.stall_recovery_progress = 0.0;
                }
            }
        } else {
            self.stall_timer = (self.stall_timer - dt * 2.0).max(0.0);
            if input.is_mobile {
                if self.pitch < 0.3 {
                    self.is_stalled = false;
                }
            }
        }

        if self.is_stalled {
            if !input.is_mobile {
                if input.is_stalled_recovery_key && !self.prev_control_pressed {
                    self.stall_recovery_progress += 15.0;
                    self.trigger_shake(0.5);
                }
                self.prev_control_pressed = input.is_stalled_recovery_key;

                self.stall_recovery_progress = (self.stall_recovery_progress - 15.0 * dt).max(0.0);

                if self.stall_recovery_progress >= 100.0 {
                    self.is_stalled = false;
                    self.stall_recovery_progress = 0.0;
                }
            }
        } else {
            self.prev_control_pressed = false;
        }
    }

    fn apply_physics(&mut self, dt: f32) {
        let euler_quat = Quat::from_euler(EulerRot::YXZ, self.yaw, self.pitch, self.roll);
        let forward = euler_quat * Vec3::new(0.0, 0.0, -1.0);
        let target_velocity = forward * self.throttle;

        self.velocity = self.velocity.lerp(target_velocity, 6.0 * dt);
        self.velocity.y += self.gravity * dt;

        self.pos += self.velocity * dt;
    }

    fn update_shake(&mut self, dt: f32) {
        if self.shake_timer > 0.0 {
            self.shake_timer -= dt;
        }
    }

    fn check_terrain(&mut self, terrain_height: f32, dt: f32) {
        self.altitude = self.pos.y - terrain_height;
        self.terrain_warning = self.altitude < 60.0;
        self.is_above_max_alt = self.pos.y > 1500.0;
        if self.is_above_max_alt {
            self.hp -= 5.0 * dt;
        }
        if self.altitude < 2.0 {
            self.terrain_crashed = true;
        }
    }

    fn update_dying(&mut self, dt: f32) {
        let speed_mult = if self.die_from_high { 3.5 } else { 1.2 };
        let target_pitch = -std::f32::consts::FRAC_PI_2;
        self.pitch = lerp(self.pitch, target_pitch, 3.0 * speed_mult * dt);
        self.roll += 6.0 * speed_mult * dt;
        self.velocity.y -= 800.0 * speed_mult * dt;

        let euler_quat = Quat::from_euler(EulerRot::YXZ, self.yaw, self.pitch, self.roll);
        let forward = euler_quat * Vec3::new(0.0, 0.0, -1.0);
        let target_throttle = self.throttle * if self.die_from_high { 3.0 } else { 1.5 };
        let target_velocity = forward * target_throttle;

        self.velocity = self.velocity.lerp(target_velocity, 3.5 * dt);
        self.pos += self.velocity * dt;
    }
}
