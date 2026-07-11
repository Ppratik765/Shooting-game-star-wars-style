/// Placeholder for collision detection utilities.
/// Full implementation in Commit 3.
use std::cell::RefCell;
use glam::Vec3;

thread_local! {
    pub static HIT_RESULTS_BUF: RefCell<Vec<i32>> = RefCell::new(Vec::with_capacity(1024));
}

fn internal_line_sphere_intersect(
    line_start: Vec3,
    line_end: Vec3,
    sphere_center: Vec3,
    radius: f32,
) -> bool {
    let d = line_end - line_start;
    let f = line_start - sphere_center;
    let seg_len_sq = d.length_squared();
    if seg_len_sq < 1e-10 {
        return f.length_squared() < radius * radius;
    }
    let t = -(f.dot(d)) / seg_len_sq;
    let t_clamped = t.clamp(0.0, 1.0);
    let closest = line_start + d * t_clamped;
    let dist_sq = (closest - sphere_center).length_squared();
    dist_sq < radius * radius
}

pub fn check_bulk_laser_hits(
    enemy_ptr: *const f32,
    enemy_count: u32,
    laser_ptr: *const f32,
    laser_count: u32,
) {
    HIT_RESULTS_BUF.with(|buf| {
        let mut results = buf.borrow_mut();
        results.clear();

        let enemy_slice = unsafe { std::slice::from_raw_parts(enemy_ptr, (enemy_count * 4) as usize) };
        let laser_slice = unsafe { std::slice::from_raw_parts(laser_ptr, (laser_count * 6) as usize) };

        for l in 0..laser_count {
            let l_base = (l * 6) as usize;
            let tail = Vec3::new(laser_slice[l_base], laser_slice[l_base + 1], laser_slice[l_base + 2]);
            let head = Vec3::new(laser_slice[l_base + 3], laser_slice[l_base + 4], laser_slice[l_base + 5]);

            for e in 0..enemy_count {
                let e_base = (e * 4) as usize;
                let center = Vec3::new(enemy_slice[e_base], enemy_slice[e_base + 1], enemy_slice[e_base + 2]);
                let radius = enemy_slice[e_base + 3];

                if internal_line_sphere_intersect(tail, head, center, radius) {
                    results.push(e as i32); // enemy_idx
                    results.push(l as i32); // laser_idx
                    break; // one laser can only hit one enemy
                }
            }
        }
    });
}

pub fn check_bulk_enemy_projectiles(
    proj_ptr: *const f32,
    proj_count: u32,
    px: f32,
    py: f32,
    pz: f32,
    radius_sq: f32,
) {
    HIT_RESULTS_BUF.with(|buf| {
        let mut results = buf.borrow_mut();
        results.clear();

        let proj_slice = unsafe { std::slice::from_raw_parts(proj_ptr, (proj_count * 3) as usize) };
        let player_center = Vec3::new(px, py, pz);

        for p in 0..proj_count {
            let p_base = (p * 3) as usize;
            let pt = Vec3::new(proj_slice[p_base], proj_slice[p_base + 1], proj_slice[p_base + 2]);

            if (pt - player_center).length_squared() < radius_sq {
                results.push(p as i32); // proj_idx
            }
        }
    });
}
