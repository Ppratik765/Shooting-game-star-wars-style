/// Placeholder for collision detection utilities.
/// Full implementation in Commit 3.
use glam::Vec3;

/// Check if a line segment intersects a sphere.
/// Used by WeaponSystem for laser-vs-enemy collision.
pub fn line_sphere_intersect(
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
    // Project sphere center onto the line segment
    let t = -(f.dot(d)) / seg_len_sq;
    let t_clamped = t.clamp(0.0, 1.0);
    let closest = line_start + d * t_clamped;
    let dist_sq = (closest - sphere_center).length_squared();
    dist_sq < radius * radius
}

/// Check if a point is within a sphere (squared distance check).
/// Used by EnemyManager for enemy-projectile-vs-player collision.
pub fn point_in_sphere_sq(
    point: Vec3,
    sphere_center: Vec3,
    radius_sq: f32,
) -> bool {
    (point - sphere_center).length_squared() < radius_sq
}
