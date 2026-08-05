// DUSTLINE movement integrator — shared verbatim by server (authoritative)
// and client (prediction), so local feel matches net state.
import { clamp, accelTo } from './math.js';

export const SPEED_WALK = 5.2;
export const SPEED_SPRINT = 7.6;
export const SPEED_CROUCH = 2.4;
export const ACCEL_GROUND = 46;
export const ACCEL_AIR = 12;
export const FRICTION_GROUND = 12;
export const GRAVITY = 22;
export const JUMP_V = 7.6;
export const SLIDE_TIME = 0.72;
export const SLIDE_BOOST = 2.4;

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const EYE_SLIDE = 0.78;
export const BODY_W = 0.62;   // player collision width (x,z)
export const BODY_DEPTH = 0.62;

export const STANCE = { STAND: 0, CROUCH: 1, SLIDE: 2 };

export function eyeHeight(stance) {
  return stance === STANCE.SLIDE ? EYE_SLIDE : stance === STANCE.CROUCH ? EYE_CROUCH : EYE_STAND;
}

// p: { pos:[x,y,z] (y above ground), vel:[vx,vy,vz], yaw, stance, slideT, grounded, moveMult }
// input: { mx, mz (strafe/forward in [-1,1]), sprint, jump, crouch }
// world: { colliders, bounds:[minX,minZ,maxX,maxZ], groundY(z)->number }
// dt in seconds. Mutates p, returns p.
export function integratePlayer(p, input, dt, world) {
  const st = p.stance;
  const speed = st === STANCE.CROUCH ? SPEED_CROUCH : SPEED_WALK * (p.moveMult ?? 1);

  // Sprint state
  const wantSprint = !!input.sprint && st === STANCE.STAND && !input.crouch && input.mz > 0.1;
  p.sprint = wantSprint ? Math.min(1, (p.sprint || 0) + dt * 6) : Math.max(0, (p.sprint || 0) - dt * 8);
  const maxSpeed = (st === STANCE.CROUCH ? SPEED_CROUCH : p.sprint > 0.5 ? SPEED_SPRINT : speed) * (p.moveMult ?? 1);

  // Slide start
  if (st === STANCE.STAND && input.slide && p.sprint > 0.5 && p.grounded && speedOf(p) > 4) {
    p.stance = STANCE.SLIDE;
    p.slideT = SLIDE_TIME;
    // kick along facing dir
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    p.vel[0] += cos * SLIDE_BOOST * 0.6;
    p.vel[2] += sin * SLIDE_BOOST * 0.6;
  }

  // Slide physics
  if (p.stance === STANCE.SLIDE) {
    p.slideT -= dt;
    if (p.slideT <= 0 && p.grounded) {
      p.stance = input.crouch ? STANCE.CROUCH : STANCE.STAND;
    }
  }

  // Desired move direction in world space (yaw = -Z forward convention: forward = (sin(yaw), cos(yaw))? We use camera forward = (sin(yaw), -cos(yaw))? Keep: forward = (Math.sin(yaw), -Math.cos(yaw)) so yaw 0 faces -Z.
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // input.mz forward/back, mx strafe (mx>0 = strafe right = +X rotated by yaw)
  let dx = sin * input.mz + cos * input.mx;
  let dz = -cos * input.mz + sin * input.mx;
  const mag = Math.hypot(dx, dz);
  if (mag > 1) { dx /= mag; dz /= mag; }

  // Crouch / stand transition
  if (input.crouch && p.stance === STANCE.STAND) {
    p.stance = STANCE.CROUCH;
  } else if (!input.crouch && p.stance === STANCE.CROUCH) {
    p.stance = STANCE.STAND;
  }

  if (p.grounded) {
    // slide keeps velocity decaying; otherwise ground accel/friction
    if (p.stance === STANCE.SLIDE) {
      const decel = 3.2;
      p.vel[0] -= p.vel[0] * Math.min(1, decel * dt);
      p.vel[2] -= p.vel[2] * Math.min(1, decel * dt);
    } else {
      const cur = Math.hypot(p.vel[0], p.vel[2]);
      p.vel[0] = accelTo(p.vel[0], dx * maxSpeed, ACCEL_GROUND, dt);
      p.vel[2] = accelTo(p.vel[2], dz * maxSpeed, ACCEL_GROUND, dt);
      // friction when no input
      if (mag < 0.1) {
        const f = Math.max(0, cur - FRICTION_GROUND * dt);
        if (cur > 1e-4) { p.vel[0] *= f / cur; p.vel[2] *= f / cur; }
      }
    }
    p.vel[1] = 0;
    if (input.jump && p.stance !== STANCE.SLIDE) {
      p.vel[1] = JUMP_V;
      p.grounded = false;
      p.stance = STANCE.STAND;
    }
  } else {
    // air control
    p.vel[0] = accelTo(p.vel[0], dx * maxSpeed, ACCEL_AIR, dt);
    p.vel[2] = accelTo(p.vel[2], dz * maxSpeed, ACCEL_AIR, dt);
    p.vel[1] -= GRAVITY * dt;
  }

  // Integrate position + collide
  const step = (axis) => {
    p.pos[axis] += p.vel[axis] * dt;
    resolveAxis(p, world, axis);
  };
  step(0);
  step(2);

  // Vertical: ground + jump
  p.pos[1] += p.vel[1] * dt;
  const gy = world.groundY(p.pos[0], p.pos[2]);
  const standH = eyeHeight(p.stance);
  if (p.pos[1] <= standH && p.vel[1] <= 0) {
    p.pos[1] = standH;
    p.vel[1] = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }

  // Enforce bounds
  const [minX, minZ, maxX, maxZ] = world.bounds;
  p.pos[0] = clamp(p.pos[0], minX + BODY_W / 2, maxX - BODY_W / 2);
  p.pos[2] = clamp(p.pos[2], minZ + BODY_DEPTH / 2, maxZ - BODY_DEPTH / 2);
  return p;
}

function resolveAxis(p, world, axis) {
  const halfW = BODY_W / 2, halfD = BODY_DEPTH / 2;
  const hx = axis === 0 ? halfW : halfD;
  const hz = axis === 2 ? halfW : halfD;
  const minY = world.groundY(p.pos[0], p.pos[2]);
  const maxY = minY + 2.1; // head clearance check height
  for (const c of world.colliders) {
    const [cx, cz, cw, cd, ch] = c; // center x,z ; half-extents ; height
    const x0 = cx - cw, x1 = cx + cw, z0 = cz - cd, z1 = cz + cd;
    const overlaps =
      p.pos[0] + hx > x0 && p.pos[0] - hx < x1 &&
      p.pos[2] + hz > z0 && p.pos[2] - hz < z1 &&
      p.pos[1] < minY + ch && p.pos[1] + 1.9 > minY;
    if (!overlaps) continue;
    if (axis === 0) {
      if (p.vel[0] > 0) p.pos[0] = x0 - hx; else if (p.vel[0] < 0) p.pos[0] = x1 + hx; else {
        const dL = (p.pos[0] + hx) - x0, dR = x1 - (p.pos[0] - hx);
        p.pos[0] = dL < dR ? x0 - hx : x1 + hx;
      }
      p.vel[0] = 0;
    } else {
      if (p.vel[2] > 0) p.pos[2] = z0 - hz; else if (p.vel[2] < 0) p.pos[2] = z1 + hz; else {
        const dL = (p.pos[2] + hz) - z0, dR = z1 - (p.pos[2] - hz);
        p.pos[2] = dL < dR ? z0 - hz : z1 + hz;
      }
      p.vel[2] = 0;
    }
  }
}

// Hit test a point for spawn safety against colliders.
export function pointBlocked(x, z, y, world) {
  const halfW = BODY_W / 2;
  const minY = world.groundY(x, z);
  for (const c of world.colliders) {
    const [cx, cz, cw, cd, ch] = c;
    if (x + halfW > cx - cw && x - halfW < cx + cw && z + halfD > cz - cd && z - halfD < cz + cd && y < minY + ch + 0.5) return true;
  }
  return false;
}

const speedOf = (p) => Math.hypot(p.vel[0], p.vel[2]);
