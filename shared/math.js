// DUSTLINE shared math helpers — used by both server sim and client prediction.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

// Ray vs AABB slab test. Returns t (distance) or null (no hit / behind origin).
export function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxT = 1e9) {
  let tmin = 0, tmax = maxT;
  const s = (o, d, mn, mx) => {
    if (Math.abs(d) < 1e-8) return o < mn || o > mx ? null : true;
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (s(ox, dx, minX, maxX) === null) return null;
  if (s(oy, dy, minY, maxY) === null) return null;
  if (s(oz, dz, minZ, maxZ) === null) return null;
  if (tmax < 0) return null;   // box entirely behind the ray origin
  return tmin > 0 ? tmin : 0;
}

// Test if a point is inside an AABB (with optional vertical range).
export function pointInAABB(px, py, pz, mn, mx) {
  return px >= mn[0] && px <= mx[0] && py >= mn[1] && py <= mx[1] && pz >= mn[2] && pz <= mx[2];
}

// Frame-rate independent smoothing toward target velocity.
export function accelTo(cur, target, accel, dt) {
  const delta = target - cur;
  const maxDelta = accel * dt;
  return Math.abs(delta) <= maxDelta ? target : cur + Math.sign(delta) * maxDelta;
}

export const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; };

// Deterministic pseudo-random from a seed (for bot names, cosmetic variation).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
