// DUSTLINE — client/fx.js
// Procedural particle + impact effects. No external assets, no textures from disk.
//
// Usage:
//   FX.init(renderer, scene, camera);
//   FX.spawn('muzzleFlash', muzzleWorldPos, forwardDir, { weapon: 'm4' });
//   FX.spawn('tracer', muzzleWorldPos, { end: hitPoint, weapon: 'm4' });
//   FX.spawn('impact', hitPos, normal, { material: 'concrete' });   // or pass { object }
//   FX.spawn('explosion', pos, { radius: 6, onShake: (i) => camShake(i) });
//   FX.spawn('grenadeBounce', pos, {});
//   FX.spawn('footstepDust', pos, { material: 'dirt' });
//   FX.spawn('blood', pos, normal, { count: 16 });
//   FX.spawn('shellCasing', pos, dir, {});
//   FX.spawn('heatHaze', pos, {});
//   FX.addDecal(pos, normal);   // tiny faded bullet hole
//   FX.update(dt);              // MUST be called every frame
//   FX.clear();                 // wipe everything on map change / match end
//   FX.setEnabled(false);       // global kill switch
//
// Impact material is auto-chosen from opts.material, else resolved from the hit
// object's userData.materialKind (building/wall/tower -> concrete, crate -> metal).
//
// Palette: sun-baked military — dusty tans, concrete greys, desaturated.
// Muzzle flashes warm orange, tracers pale yellow, blood dark and grounded.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const R = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// scratch vectors (no allocations in the hot path)
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();

const PALETTE = {
  dust: new THREE.Color(0.71, 0.63, 0.47),
  concrete: new THREE.Color(0.56, 0.55, 0.52),
  smoke: new THREE.Color(0.35, 0.33, 0.30),
  smokeLight: new THREE.Color(0.62, 0.57, 0.48),
  muzzle: new THREE.Color(1.0, 0.72, 0.38),     // warm orange
  muzzleCore: new THREE.Color(1.0, 0.9, 0.62),
  tracer: new THREE.Color(1.0, 0.94, 0.72),     // pale yellow
  blood: new THREE.Color(0.30, 0.05, 0.05),     // dark, grounded
  fire: new THREE.Color(1.0, 0.62, 0.26),
  fireCore: new THREE.Color(1.0, 0.86, 0.52),
  debris: new THREE.Color(0.55, 0.5, 0.4),
  brass: new THREE.Color(0.78, 0.66, 0.38),
  spark: new THREE.Color(1.0, 0.82, 0.5),
  haze: new THREE.Color(0.85, 0.75, 0.55),
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  inited: false,
  enabled: true,
  elapsed: 0,
  pools: {},
  decals: [],
  decalCapacity: 24,
  casings: [],
  tracers: [],
  tracerPool: [],
  tracerNextAt: 0,
  hidden: null,       // THREE.Group holding all transient fx objects
  flashLight: null,
  flashLightLive: 0,
  geometry: {},
  material: {},
};

// =====================================================================
// Procedural geometry + texture (low vertex counts, shared)
// =====================================================================
function makeGeometry() {
  const g = {};
  g.quad = new THREE.PlaneGeometry(1, 1);       // 4 verts — sprites/rings/decals
  g.cube = new THREE.BoxGeometry(1, 1, 1);      // 24 verts — casings
  g.tracer = new THREE.BufferGeometry();
  g.tracer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  g.tracer.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
  g.tracer.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 250);
  state.geometry = g;
}

// Soft radial sprite texture (procedural 64x64, no file I/O).
function makeCircleTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMaterials() {
  const m = {};
  const basic = (color, opts = {}) => new THREE.MeshBasicMaterial(Object.assign({
    color, transparent: true, depthWrite: false, fog: true,
    side: THREE.DoubleSide, toneMapped: false,
  }, opts));
  m.fire = basic(PALETTE.fire, { blending: THREE.AdditiveBlending });
  m.fireCore = basic(PALETTE.fireCore, { blending: THREE.AdditiveBlending });
  m.smokeBill = basic(PALETTE.smoke, { opacity: 0.4 });
  m.debris = basic(PALETTE.debris);
  m.casing = basic(PALETTE.brass);
  m.ring = basic(PALETTE.dust, { opacity: 0.5 });
  m.ringAdd = basic(PALETTE.fire, { opacity: 0.4, blending: THREE.AdditiveBlending });
  m.haze = basic(PALETTE.haze, { opacity: 0.35, blending: THREE.AdditiveBlending });
  state.material = m;
}

// =====================================================================
// Particle pool — one THREE.Points with parallel CPU arrays per system.
// =====================================================================
function createPool(maxCount, opts = {}) {
  const n = maxCount;
  const arrays = {
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    size: new Float32Array(n),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    grav: new Float32Array(n),
    col: new Float32Array(n * 3),
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arrays.pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(arrays.size, 1));
  geo.setAttribute('life', new THREE.BufferAttribute(arrays.life, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(arrays.col, 3));

  const blending = opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending,
    vertexShader: `
      attribute float size;
      attribute float life;
      attribute vec3 color;
      varying float vLife;
      varying vec3 vColor;
      void main() {
        vLife = life;
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (320.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vLife;
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float a = smoothstep(0.5, 0.12, d) * clamp(vLife, 0.0, 1.0);
        gl_FragColor = vec4(vColor, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.visible = false;
  return { points, arrays, count: 0, maxCount: n, geo };
}

function getPool(name, maxCount, opts = {}) {
  let pool = state.pools[name];
  if (!pool) {
    pool = createPool(maxCount, opts);
    state.pools[name] = pool;
    state.hidden.add(pool.points);
  }
  return pool;
}

// Seed one particle. data = [x, y, z, size, life, maxLife, gravity].
function seedPool(pool, data, vel, color) {
  const max = pool.maxCount;
  const i = pool.count < max ? pool.count : Math.floor(Math.random() * max);
  const o = i * 3;
  const A = pool.arrays;
  A.pos[o] = data[0]; A.pos[o + 1] = data[1]; A.pos[o + 2] = data[2];
  A.vel[o] = vel[0]; A.vel[o + 1] = vel[1]; A.vel[o + 2] = vel[2];
  A.size[i] = data[3];
  A.life[i] = data[4];
  A.maxLife[i] = data[5];
  A.grav[i] = data[6];
  A.col[o] = color.r; A.col[o + 1] = color.g; A.col[o + 2] = color.b;
  if (pool.count < max) pool.count++;
  pool.points.visible = true;
}

// Velocity along a normal with a spread cone + speed jitter.
function seedImpulse(pool, data, dir, speed, spread, color) {
  const s = speed * R(0.35, 1);
  const ax = tmpA.copy(dir).multiplyScalar(s);
  ax.x += R(-1, 1) * spread; ax.y += R(-1, 1) * spread; ax.z += R(-1, 1) * spread;
  seedPool(pool, data, [ax.x, ax.y, ax.z], color);
}

// Velocity in a vertical cone (dust puffs, smoke columns).
function seedCone(pool, data, dir, speedMin, speedMax, spread, upBias, color) {
  const s = R(speedMin, speedMax);
  const ax = tmpA.copy(dir).multiplyScalar(s);
  ax.y += upBias;
  ax.x += R(-1, 1) * spread; ax.y += R(-1, 1) * spread; ax.z += R(-1, 1) * spread;
  seedPool(pool, data, [ax.x, ax.y, ax.z], color);
}

// =====================================================================
// Billboard sprites (muzzle flash, fireball, smoke puff, shockwave ring)
// =====================================================================
function createSprite(mat) {
  const m = new THREE.Mesh(state.geometry.quad, mat.clone());
  m.visible = false;
  m.renderOrder = 5;
  m.frustumCulled = false;
  return m;
}

function billboard(mesh, pos) {
  mesh.position.copy(pos);
  mesh.lookAt(state.camera.position); // face the camera exactly
}

// =====================================================================
// Muzzle flash — warm-orange billboard + shared flickering PointLight
// =====================================================================
function muzzleFlash(pos, opts = {}) {
  const s = state.material;
  const weapon = opts.weapon || 'm4';
  const isBig = weapon === 'sniper' || weapon === 'shotgun' || weapon === 'lmg';

  const flash = createSprite(isBig ? s.fire : s.fireCore);
  billboard(flash, pos);
  const fScale = R(0.5, 0.7) * (isBig ? 1.7 : 1);
  flash.scale.setScalar(fScale);
  flash.userData.fx = { t: 0, dur: R(0.04, 0.055), s0: fScale, grow: fScale * 1.25, fade: 1 };
  state.hidden.add(flash);

  const core = createSprite(s.fireCore);
  billboard(core, pos);
  const cScale = R(0.22, 0.32) * (isBig ? 1.4 : 1);
  core.scale.setScalar(cScale);
  core.userData.fx = { t: 0, dur: R(0.02, 0.03), s0: cScale, grow: cScale * 0.6, fade: 1 };
  state.hidden.add(core);

  if (state.flashLight) {
    state.flashLight.position.copy(pos);
    state.flashLight.distance = Math.max(opts.distance ?? 14, 6);
    state.flashLight.intensity = (isBig ? 26 : 13) * R(0.75, 1.15);
    state.flashLightLive = 0.04;
  }
}

// =====================================================================
// Tracer — short additive line muzzle->hit with a faint smoke wisp.
// Rate-limited so full-auto stays readable.
// =====================================================================
function spawnTracer(muzzlePos, opts = {}) {
  const now = performance.now();
  if (now < state.tracerNextAt) return;
  state.tracerNextAt = now + 36;
  const end = opts.end;
  if (!end) return;

  let line;
  if (state.tracerPool.length) {
    line = state.tracerPool.pop();
  } else {
    line = new THREE.Line(state.geometry.tracer.clone(), new THREE.LineBasicMaterial({
      color: PALETTE.tracer,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    line.frustumCulled = false;
  }
  line.visible = true;
  const posAttr = line.geometry.getAttribute('position');
  posAttr.setXYZ(0, muzzlePos.x, muzzlePos.y, muzzlePos.z);
  posAttr.setXYZ(1, end.x, end.y, end.z);
  posAttr.needsUpdate = true;
  const colAttr = line.geometry.getAttribute('color');
  colAttr.setXYZ(0, PALETTE.tracer.r, PALETTE.tracer.g, PALETTE.tracer.b);
  colAttr.setXYZ(1, PALETTE.tracer.r, PALETTE.tracer.g, PALETTE.tracer.b);
  colAttr.needsUpdate = true;
  line.userData.fx = { t: 0, dur: R(0.05, 0.08), type: 'tracer' };
  state.hidden.add(line);
  state.tracers.push(line);

  // faint smoke wisp at the end of a long shot
  const dx = end.x - muzzlePos.x, dy = end.y - muzzlePos.y, dz = end.z - muzzlePos.z;
  if (dx * dx + dy * dy + dz * dz > 16) {
    const pool = getPool('tracerSmoke', 60, {});
    for (let k = 0; k < 2; k++) {
      tmpC.set(end.x + R(-0.25, 0.25), end.y + R(-0.1, 0.3), end.z + R(-0.25, 0.25));
      seedPool(pool,
        [tmpC.x, tmpC.y, tmpC.z, 0.2, R(0.5, 0.9), R(0.5, 0.9), -0.1],
        [R(-0.15, 0.15), R(0.05, 0.3), R(-0.15, 0.15)], PALETTE.smokeLight);
    }
  }
}

// =====================================================================
// Impact effects — per material kind
// =====================================================================
const IMPACT_CFG = {
  metal: { sparks: 12, dust: 5, chunks: 2, blood: 0 },
  concrete: { sparks: 3, dust: 12, chunks: 5, blood: 0 },
  dirt: { sparks: 0, dust: 10, chunks: 3, blood: 0 },
  flesh: { sparks: 0, dust: 0, chunks: 0, blood: 14 },
};

function resolveMaterial(object) {
  if (!object) return 'concrete';
  const u = object.userData || {};
  if (u.materialKind) return u.materialKind;
  if (u.kind === 'crate') return 'metal';
  if (u.kind === 'building' || u.kind === 'wall' || u.kind === 'tower') return 'concrete';
  return 'concrete';
}

function impact(pos, normal, opts = {}) {
  const mat = String(opts.material || resolveMaterial(opts.object)).toLowerCase();
  const cfg = IMPACT_CFG[mat] || IMPACT_CFG.concrete;
  const n = normal || tmpA.set(0, 1, 0);

  if (cfg.sparks) {
    const pool = getPool('sparks', 160, { additive: true });
    const col = mat === 'metal' ? PALETTE.spark : PALETTE.dust;
    for (let i = 0; i < cfg.sparks; i++) {
      seedImpulse(pool,
        [pos.x + R(-0.04, 0.04), pos.y + R(-0.04, 0.04), pos.z + R(-0.04, 0.04),
          0.035, R(0.12, 0.4), R(0.12, 0.4), -9.8],
        n, R(2, 6), 2.5, col);
    }
  }
  if (cfg.dust) {
    const pool = getPool('dust', 220, {});
    const col = mat === 'concrete' ? PALETTE.concrete : PALETTE.dust;
    for (let i = 0; i < cfg.dust; i++) {
      seedImpulse(pool,
        [pos.x + R(-0.12, 0.12), pos.y + R(-0.02, 0.06), pos.z + R(-0.12, 0.12),
          0.06, R(0.3, 0.8), R(0.3, 0.8), -0.4],
        n, R(1, 3), 1.2, col);
    }
  }
  if (cfg.chunks) {
    const pool = getPool('debris', 64, {});
    const col = mat === 'concrete' ? PALETTE.concrete : PALETTE.debris;
    for (let i = 0; i < cfg.chunks; i++) {
      seedImpulse(pool,
        [pos.x, pos.y, pos.z, 0.12, R(0.5, 1.1), R(0.5, 1.1), -12],
        n, R(1.5, 4), 1.5, col);
    }
  }
  if (cfg.blood) {
    const pool = getPool('blood', 90, {});
    for (let i = 0; i < cfg.blood; i++) {
      seedImpulse(pool,
        [pos.x, pos.y + 0.05, pos.z, 0.03, R(0.3, 0.7), R(0.3, 0.7), -12],
        n, R(1, 4), 2.2, PALETTE.blood);
    }
  }
}

// =====================================================================
// Blood spray (explicit)
// =====================================================================
function blood(pos, normal, opts = {}) {
  const n = normal || tmpA.set(0, 1, 0);
  const pool = getPool('blood', 90, {});
  const count = clamp(Math.floor(opts.count || 14), 1, 40);
  for (let i = 0; i < count; i++) {
    seedImpulse(pool,
      [pos.x, pos.y + 0.05, pos.z, 0.03, R(0.3, 0.7), R(0.3, 0.7), -12],
      n, R(1, 4), 2.2, PALETTE.blood);
  }
}

// =====================================================================
// Footstep dust — soft low puff
// =====================================================================
function footstepDust(pos, opts = {}) {
  const pool = getPool('dust', 220, {});
  const mat = String(opts.material || 'dirt').toLowerCase();
  const col = mat === 'concrete' ? PALETTE.concrete : mat === 'metal' ? PALETTE.concrete : PALETTE.dust;
  for (let i = 0; i < 5; i++) {
    seedCone(pool,
      [pos.x + R(-0.1, 0.1), pos.y + 0.02, pos.z + R(-0.1, 0.1),
        0.06, R(0.3, 0.6), R(0.3, 0.6), -0.2],
      tmpA.set(0, 1, 0), R(0.15, 0.4), R(0.15, 0.4), 0.8, 0, col);
  }
}

// =====================================================================
// Explosion — fireball, smoke column, debris, dust ring, light flash
// =====================================================================
function explosion(pos, opts = {}) {
  const radius = opts.radius || 5;
  const scale = clamp(radius / 5, 0.5, 3);

  // fireball (outer glow + hot core), both billboards
  const fire = createSprite(state.material.fire);
  billboard(fire, pos);
  const f0 = radius * R(0.9, 1.1);
  fire.scale.setScalar(f0);
  fire.userData.fx = { t: 0, dur: 0.24, s0: f0, grow: radius * 1.35, fade: 1 };
  state.hidden.add(fire);

  const core = createSprite(state.material.fireCore);
  billboard(core, pos);
  const c0 = radius * 0.6;
  core.scale.setScalar(c0);
  core.userData.fx = { t: 0, dur: 0.15, s0: c0, grow: radius * 0.85, fade: 1 };
  state.hidden.add(core);

  // expanding dust shockwave ring on the ground
  const ring = createSprite(state.material.ring);
  billboard(ring, tmpB.copy(pos).setY(pos.y + 0.05));
  const r0 = radius * 0.1;
  ring.scale.setScalar(r0);
  ring.userData.fx = { t: 0, dur: 0.4, s0: r0, grow: radius * 2.6, fade: 0.45 };
  state.hidden.add(ring);

  // light flash
  if (state.flashLight) {
    state.flashLight.position.copy(pos);
    state.flashLight.distance = radius * 10;
    state.flashLight.intensity = 90 * scale;
    state.flashLightLive = 0.12;
  }

  // smoke column
  const smokePool = getPool('smoke', 120, {});
  for (let i = 0; i < 16 * scale; i++) {
    const a = R(0, TAU);
    const r = R(0, radius * 0.3);
    seedCone(smokePool,
      [pos.x + Math.cos(a) * r, pos.y + R(0, 0.3), pos.z + Math.sin(a) * r,
        R(0.4, 0.8) * scale, R(1.2, 2.4), R(1.2, 2.4), -0.15],
      tmpA.set(0, 1, 0), R(0.8, 2), R(0.8, 2), 0.6, 0, PALETTE.smoke);
  }

  // debris chunks
  const debrisPool = getPool('debris', 64, {});
  for (let i = 0; i < 10 * scale; i++) {
    seedCone(debrisPool,
      [pos.x, pos.y + 0.2, pos.z, 0.14, R(0.6, 1.4), R(0.6, 1.4), -15],
      tmpB.set(R(-0.6, 0.6), 1, R(-0.6, 0.6)).normalize(), R(4, 9), R(4, 9), 2.5, 0, PALETTE.debris);
  }

  // dust cloud
  const dustPool = getPool('dust', 220, {});
  for (let i = 0; i < 14 * scale; i++) {
    seedCone(dustPool,
      [pos.x + R(-0.4, 0.4), pos.y + R(0, 0.2), pos.z + R(-0.4, 0.4),
        0.1, R(0.8, 1.8), R(0.8, 1.8), -0.5],
      tmpC.set(R(-0.4, 0.4), 1, R(-0.4, 0.4)).normalize(), R(1.5, 4), R(1.5, 4), 1.6, 0, PALETTE.dust);
  }

  // camera shake callback (the game applies the actual shake).
  // Prefer assigning FX.onShake = (i) => {...} at init; per-spawn
  // opts.onShake overrides it for that one explosion.
  const intensity = clamp(0.5 + radius * 0.1, 0.5, 1.4);
  if (opts.onShake) opts.onShake(intensity);
  else if (state.onShake) state.onShake(intensity);
}

// =====================================================================
// Grenade bounce — tiny metallic ticks
// =====================================================================
function grenadeBounce(pos, opts = {}) {
  const pool = getPool('sparkMetal', 48, { additive: true });
  for (let i = 0; i < 3; i++) {
    seedImpulse(pool,
      [pos.x + R(-0.05, 0.05), pos.y + R(0, 0.05), pos.z + R(-0.05, 0.05),
        0.02, R(0.08, 0.18), R(0.08, 0.18), -9.8],
      tmpA.set(R(-0.5, 0.5), 0.3, R(-0.5, 0.5)).normalize(), R(0.5, 1.5), 0.8, PALETTE.spark);
  }
}

// =====================================================================
// Heat-haze shimmer — faint additive haze, kept subtle (military)
// =====================================================================
function heatHaze(pos, opts = {}) {
  const pool = getPool('haze', 24, { additive: true });
  for (let i = 0; i < 3; i++) {
    seedCone(pool,
      [pos.x + R(-0.3, 0.3), pos.y + R(0.1, 0.6), pos.z + R(-0.3, 0.3),
        0.3, R(0.5, 1.0), R(0.5, 1.0), -0.05],
      tmpA.set(0, 1, 0), R(0.1, 0.3), R(0.1, 0.3), 0.3, 0, PALETTE.haze);
  }
}

// =====================================================================
// Shell casing — small box that bounces and settles (immediate, 3D)
// =====================================================================
function shellCasing(pos, dir, opts = {}) {
  const mesh = new THREE.Mesh(state.geometry.cube, state.material.casing);
  mesh.position.copy(pos);
  const s = R(0.03, 0.05);
  mesh.scale.set(s, s, s * 1.6);
  mesh.rotation.set(R(0, TAU), R(0, TAU), R(0, TAU));
  mesh.userData.fx = {
    t: 0, dur: R(1.6, 2.6), type: 'casing',
    vel: tmpA.copy(dir).multiplyScalar(R(1.5, 3.5)).add(tmpB.set(0, R(2, 3.2), 0)),
    rotv: tmpC.set(R(-7, 7), R(-7, 7), R(-7, 7)),
    groundY: pos.y,
  };
  state.hidden.add(mesh);
  state.casings.push(mesh);
}

// =====================================================================
// Spawn dispatcher
// =====================================================================
// Supported forms:
//   FX.spawn('impact', pos, normal, { material: 'metal' })
//   FX.spawn('impact', pos, { material: 'metal', object: hitObj })   // no normal
//   FX.spawn('muzzleFlash', pos, forwardDir, { weapon: 'm4' })
//   FX.spawn('tracer', muzzlePos, { end: hitPoint })
function spawn(type, pos, normalOrOpts, opts) {
  if (!state.inited || !state.enabled) return;
  let posV;
  if (pos instanceof THREE.Vector3) posV = pos;
  else posV = tmpC.set(pos[0], pos[1], pos[2]);
  let normal, options;
  if (normalOrOpts && typeof normalOrOpts.x === 'number') {
    normal = normalOrOpts;
    options = opts || {};
  } else {
    normal = undefined;
    options = normalOrOpts || {};
  }
  const dir = options.dir || normal || tmpA.set(0, 1, 0);
  switch (type) {
    case 'muzzleFlash': muzzleFlash(posV, options); break;
    case 'tracer': spawnTracer(posV, options); break;
    case 'impact': impact(posV, normal, options); break;
    case 'blood': blood(posV, normal, options); break;
    case 'footstepDust': footstepDust(posV, options); break;
    case 'explosion': explosion(posV, options); break;
    case 'grenadeBounce': grenadeBounce(posV, options); break;
    case 'heatHaze': heatHaze(posV, options); break;
    case 'shellCasing': shellCasing(posV, dir, options); break;
    default: break;
  }
}

// =====================================================================
// Per-frame update
// =====================================================================
function update(dt) {
  if (!state.inited) return;
  dt = Math.min(dt, 0.1);
  state.elapsed += dt;

  // muzzle light flicker + decay
  if (state.flashLightLive > 0) {
    state.flashLightLive -= dt;
    if (state.flashLightLive <= 0) {
      state.flashLight.intensity = 0;
      state.flashLightLive = 0;
    } else {
      state.flashLight.intensity *= Math.pow(0.05, dt);
    }
  }

  // decal fade
  for (let i = state.decals.length - 1; i >= 0; i--) {
    const d = state.decals[i];
    d.t += dt;
    if (d.t >= d.dur) {
      state.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      state.decals.splice(i, 1);
    } else {
      d.mesh.material.opacity = d.baseOpacity * (1 - d.t / d.dur);
    }
  }

  // tracers (additive line segments)
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    const line = state.tracers[i];
    const fx = line.userData.fx;
    fx.t += dt;
    const k = 1 - fx.t / fx.dur;
    if (k <= 0) {
      state.hidden.remove(line);
      line.visible = false;
      line.material.opacity = 0.9;
      state.tracerPool.push(line);
      state.tracers.splice(i, 1);
    } else {
      line.material.opacity = 0.9 * k;
    }
  }

  // particle pools — integrate, then compact survivors to the front
  for (const name in state.pools) {
    const pool = state.pools[name];
    if (!pool.count) continue;
    const A = pool.arrays;
    let write = 0;
    for (let i = 0; i < pool.count; i++) {
      A.life[i] -= dt;
      if (A.life[i] <= 0) continue;
      const oi = i * 3;
      A.vel[oi + 1] += -9.8 * A.grav[i] * dt;
      A.pos[oi] += A.vel[oi] * dt;
      A.pos[oi + 1] += A.vel[oi + 1] * dt;
      A.pos[oi + 2] += A.vel[oi + 2] * dt;
      // ground contact: bounce once, then settle
      if (A.pos[oi + 1] < 0 && A.grav[i] < 0) {
        A.pos[oi + 1] = 0;
        A.vel[oi + 1] *= -0.3;
        A.grav[i] = 0;
      }
      if (write !== i) {
        const ow = write * 3;
        A.pos[ow] = A.pos[oi]; A.pos[ow + 1] = A.pos[oi + 1]; A.pos[ow + 2] = A.pos[oi + 2];
        A.vel[ow] = A.vel[oi]; A.vel[ow + 1] = A.vel[oi + 1]; A.vel[ow + 2] = A.vel[oi + 2];
        A.col[ow] = A.col[oi]; A.col[ow + 1] = A.col[oi + 1]; A.col[ow + 2] = A.col[oi + 2];
        A.size[write] = A.size[i];
        A.life[write] = A.life[i];
        A.maxLife[write] = A.maxLife[i];
        A.grav[write] = A.grav[i];
      }
      write++;
    }
    pool.count = write;
    if (write > 0) {
      pool.points.visible = true;
      pool.geo.getAttribute('position').needsUpdate = true;
      pool.geo.getAttribute('size').needsUpdate = true;
      pool.geo.getAttribute('life').needsUpdate = true;
      pool.geo.getAttribute('color').needsUpdate = true;
    } else {
      pool.points.visible = false;
    }
  }

  // billboard sprites (fire, rings, muzzle flash)
  const children = state.hidden.children;
  for (let i = 0; i < children.length; i++) {
    const obj = children[i];
    const fx = obj.userData.fx;
    if (!fx || fx.type) continue; // skip pool Points, tracers and casings
    fx.t += dt;
    if (fx.t >= fx.dur) {
      state.hidden.remove(obj);
      i--;
      continue;
    }
    const k = fx.t / fx.dur;
    const s0 = fx.s0 || 0.5;
    const grow = fx.grow != null ? fx.grow : s0;
    obj.scale.setScalar(s0 + (grow - s0) * k);
    obj.material.opacity = (fx.fade != null ? fx.fade : 1) * (1 - k);
  }

  // shell casings: gravity, bounce, settle, tumble
  for (let i = state.casings.length - 1; i >= 0; i--) {
    const c = state.casings[i];
    const fx = c.userData.fx;
    fx.t += dt;
    if (fx.t >= fx.dur) {
      state.hidden.remove(c);
      state.casings.splice(i, 1);
      continue;
    }
    fx.vel.y -= 9.8 * dt;
    c.position.x += fx.vel.x * dt;
    c.position.y += fx.vel.y * dt;
    c.position.z += fx.vel.z * dt;
    if (c.position.y < fx.groundY) {
      c.position.y = fx.groundY;
      fx.vel.y *= -0.35;
      fx.vel.x *= 0.6;
      fx.vel.z *= 0.6;
      if (Math.abs(fx.vel.y) < 0.6) fx.vel.y = 0;
    }
    c.rotation.x += fx.rotv.x * dt;
    c.rotation.y += fx.rotv.y * dt;
    c.rotation.z += fx.rotv.z * dt;
    const damp = Math.pow(0.5, dt);
    fx.rotv.multiplyScalar(damp);
  }
}

// =====================================================================
// Public API
// =====================================================================
function init(renderer, scene, camera) {
  if (state.inited) return;
  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.hidden = new THREE.Group();
  state.hidden.name = 'fx-transients';
  scene.add(state.hidden);

  makeGeometry();
  state.geometry.circleTex = makeCircleTexture();
  makeMaterials();

  // shared muzzle/explosion light — idle at near-zero intensity, far below the map
  const flashLight = new THREE.PointLight(0xffd9a0, 0, 40, 2);
  flashLight.position.set(0, -200, 0);
  scene.add(flashLight);
  state.flashLight = flashLight;
  state.flashLightLive = 0;

  // pre-warm the common pools (rest are lazy)
  getPool('sparks', 160, { additive: true });
  getPool('sparkMetal', 48, { additive: true });
  getPool('dust', 220, {});
  getPool('smoke', 120, {});
  getPool('blood', 90, {});
  getPool('debris', 64, {});
  getPool('tracerSmoke', 60, {});
  getPool('haze', 24, { additive: true });

  state.inited = true;
}

// Small faded bullet-hole decal (evicts oldest at capacity).
function addDecal(pos, normal) {
  if (!state.inited || !state.enabled) return;
  if (state.decals.length >= state.decalCapacity) {
    const old = state.decals.shift();
    state.scene.remove(old.mesh);
    old.mesh.geometry.dispose();
  }
  const mesh = new THREE.Mesh(state.geometry.quad, new THREE.MeshBasicMaterial({
    color: 0x15110c, transparent: true, opacity: 0.5,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  mesh.position.copy(pos).addScaledVector(normal, 0.012);
  mesh.lookAt(tmpA.copy(pos).add(normal));
  mesh.scale.setScalar(R(0.09, 0.14));
  state.scene.add(mesh);
  state.decals.push({ mesh, t: 0, dur: 8, baseOpacity: 0.5 });
}

function setEnabled(on) {
  state.enabled = !!on;
}

// Wipe every particle, tracer, sprite, casing and light back to idle.
// The shared muzzle light is kept (parked, zero intensity).
function clear() {
  for (const name in state.pools) {
    const pool = state.pools[name];
    pool.count = 0;
    pool.points.visible = false;
  }
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    const line = state.tracers[i];
    state.hidden.remove(line);
    line.visible = false;
    line.material.opacity = 0.9;
    state.tracerPool.push(line);
  }
  state.tracers.length = 0;
  for (let i = state.casings.length - 1; i >= 0; i--) {
    state.hidden.remove(state.casings[i]);
  }
  state.casings.length = 0;
  const children = state.hidden.children.slice();
  for (let i = 0; i < children.length; i++) {
    // remove transients (sprites, leftover tracers/casings); keep pool Points
    if (children[i].userData.fx) state.hidden.remove(children[i]);
  }
  for (let i = state.decals.length - 1; i >= 0; i--) {
    const d = state.decals[i];
    state.scene.remove(d.mesh);
    d.mesh.geometry.dispose();
  }
  state.decals.length = 0;
  state.flashLightLive = 0;
  state.flashLight.intensity = 0;
  state.flashLight.position.set(0, -200, 0);
  state.tracerNextAt = 0;
}

export const FX = {
  init,
  spawn,
  update,
  clear,
  addDecal,
  setEnabled,
  PALETTE,
  get onShake() { return state.onShake; },
  set onShake(fn) { state.onShake = typeof fn === 'function' ? fn : null; },
};
