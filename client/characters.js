// DUSTLINE character models — procedural soldiers for remote players + bots.
// Two faction palettes (tan/khaki vs green/grey), animated legs/arms for
// walk/run/idle, smooth pose lerp. Kept cheap (instanced-ish via shared geoms).
import * as THREE from 'three';

export const FACTION_COLORS = {
  tan: { body: 0xb9a98a, gear: 0x6f614a, helmet: 0x9a8b6c, skin: 0x8a6a4f, pack: 0x4c4434 },
  green: { body: 0x75805c, gear: 0x4a5240, helmet: 0x5f6a4a, skin: 0x7a5a44, pack: 0x3a4030 },
};

const GEO = {}; // cached geometries

function geo(kind) {
  if (!GEO[kind]) {
    switch (kind) {
      case 'head': GEO[kind] = new THREE.SphereGeometry(0.13, 10, 8); break;
      case 'helm': GEO[kind] = new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); break;
      case 'torso': GEO[kind] = new THREE.BoxGeometry(0.42, 0.52, 0.26); break;
      case 'hip': GEO[kind] = new THREE.BoxGeometry(0.34, 0.22, 0.24); break;
      case 'arm': GEO[kind] = new THREE.BoxGeometry(0.11, 0.5, 0.11); break;
      case 'forearm': GEO[kind] = new THREE.BoxGeometry(0.09, 0.4, 0.09); break;
      case 'leg': GEO[kind] = new THREE.BoxGeometry(0.13, 0.5, 0.14); break;
      case 'shin': GEO[kind] = new THREE.BoxGeometry(0.11, 0.42, 0.12); break;
      case 'pack': GEO[kind] = new THREE.BoxGeometry(0.34, 0.4, 0.16); break;
      case 'gun': GEO[kind] = new THREE.BoxGeometry(0.05, 0.06, 0.5); break;
    }
  }
  return GEO[kind];
}

export function createSoldier(team = 1) {
  const pal = FACTION_COLORS[team === 2 ? 'green' : 'tan'];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.9, metalness: 0.05 });
  const gearMat = new THREE.MeshStandardMaterial({ color: pal.gear, roughness: 0.9 });
  const helmMat = new THREE.MeshStandardMaterial({ color: pal.helmet, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.9 });
  const packMat = new THREE.MeshStandardMaterial({ color: pal.pack, roughness: 0.95 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.4 });

  // hierarchy: root -> hips -> torso/head + arms ; hips -> legs
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  const torso = new THREE.Group();
  torso.position.y = 0.3;
  hips.add(torso);

  const add = (geo, mat, parent, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // head + helmet
  const head = add(geo('head'), skinMat, torso, 0, 0.42, 0);
  add(geo('helm'), helmMat, torso, 0, 0.43, 0);
  add(geo('pack'), packMat, torso, 0, 0.32, -0.2);
  add(geo('torso'), bodyMat, torso, 0, 0.12, 0);
  add(geo('hip'), gearMat, hips, 0, -0.02, 0);

  // arms: shoulder pivots
  const armL = new THREE.Group(); armL.position.set(-0.25, 0.34, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.25, 0.34, 0); torso.add(armR);
  const upperL = add(geo('arm'), bodyMat, armL, 0, -0.26, 0);
  const upperR = add(geo('arm'), bodyMat, armR, 0, -0.26, 0);
  const foreL = add(geo('forearm'), bodyMat, armL, 0, -0.5, 0);
  const foreR = add(geo('forearm'), bodyMat, armR, 0, -0.5, 0);
  // gun held in front
  const gun = add(geo('gun'), gunMat, armR, 0.02, -0.62, 0.18);
  gun.rotation.x = Math.PI / 2;
  gun.rotation.z = Math.PI / 2;

  // legs
  const legL = new THREE.Group(); legL.position.set(-0.1, 0, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.1, 0, 0); hips.add(legR);
  const thighL = add(geo('leg'), gearMat, legL, 0, -0.26, 0);
  const thighR = add(geo('leg'), gearMat, legR, 0, -0.26, 0);
  const shinL = add(geo('shin'), gearMat, legL, 0, -0.52, 0);
  const shinR = add(geo('shin'), gearMat, legR, 0, -0.52, 0);

  g.userData = {
    hips, torso, head, armL, armR, legL, legR, upperL, upperR, foreL, foreR,
    gun, thighL, thighR, shinL, shinR, mats: [bodyMat, gearMat, helmMat, skinMat, packMat, gunMat],
  };
  return g;
}

// Animate a soldier group. state: { move (0..1 speed factor), sprint, alive, ads, falling, velY }
export function animateSoldier(soldier, dt, state) {
  if (!soldier || !soldier.userData) return;
  const u = soldier.userData;
  const speed = Math.min(1, state.move || 0);
  const sprint = state.sprint ? 1 : 0;
  const t = performance.now() / 1000;

  // legs swing
  const stride = (0.6 + sprint * 0.9 + speed * 2.6) * speed;
  const phase = t * 9 * (0.8 + sprint * 0.8);
  const swing = Math.sin(phase) * stride * 0.5;
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.thighL.rotation.x = swing;
  u.thighR.rotation.x = -swing;
  // arms counter-swing (gun arm holds steady toward aim)
  u.armL.rotation.x = -swing * 0.7;
  u.armR.rotation.x = swing * 0.25 + 0.2;
  u.upperL.rotation.x = -swing * 0.7;
  u.upperR.rotation.x = swing * 0.25 + 0.2;
  u.foreL.rotation.x = 0.4;
  u.foreR.rotation.x = 0.25;

  // torso lean forward when moving/sprinting
  const lean = 0.12 + speed * 0.14 + sprint * 0.08;
  u.torso.rotation.x = damp(u.torso.rotation.x, lean, 8, dt);

  // head bob
  u.head.position.y = 0.42 + Math.sin(phase * 2) * 0.01 * speed;
}

// Set a soldier to face a yaw, with smooth turn.
export function faceSoldier(soldier, yaw, dt) {
  if (!soldier) return;
  const target = yaw + Math.PI / 2; // model faces +Z by default; yaw convention forward=(sin,-cos)
  soldier.rotation.y = damp(soldier.rotation.y, target, 10, dt);
}

function damp(a, b, lambda, dt) { return a + (b - a) * (1 - Math.exp(-lambda * dt)); }

export function disposeSoldier(soldier) {
  if (!soldier) return;
  if (soldier.userData) {
    (soldier.userData.mats || []).forEach((m) => m.dispose());
  }
  soldier.traverse((c) => {
    if (c.isMesh && c.geometry) { /* shared geoms, don't dispose */ }
  });
}
