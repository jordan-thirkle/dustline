// DUSTLINE viewmodel — first-person weapon rig. Procedural gun models built
// from weapon stats, with ADS lerp, recoil kick, reload animation, sprint
// sway/bob, and melee lunge. Everything frame-driven and cheap.
import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { clamp, damp } from '../shared/math.js';

const GREY = { rough: 0.55, metal: 0.7 };
const DARK = { rough: 0.7, metal: 0.5 };
const STOCK = { rough: 0.85, metal: 0.15 };

export function createViewmodel(scene, camera) {
  const root = new THREE.Group();
  root.name = 'viewmodel';
  scene.add(root);

  const vm = {
    root,
    weapon: 'm4',
    ads: 0,
    recoil: 0,
    recoilSide: 0,
    sprintT: 0,
    bobT: 0,
    reloadT: -1,
    meleeT: -1,
    swapT: 0,
    fireFlash: 0,
    gun: null,
    muzzle: null,
    camera,
    fovBase: 75,
    fovCurrent: 75,
    adsFov: 55,
  };

  vm.setWeapon = (id, instant = false) => {
    if (vm.gun) {
      vm.root.remove(vm.gun);
      disposeObject(vm.gun);
    }
    vm.weapon = id;
    const w = WEAPONS[id];
    vm.gun = buildGun(id);
    vm.root.add(vm.gun);
    vm.muzzle = findMuzzle(vm.gun);
    if (instant) {
      vm.swapT = 0;
    } else {
      vm.swapT = 1;
    }
    vm.ads = 0;
    if (w && w.scope) vm.adsFov = w.scope.fov;
    else vm.adsFov = 55;
  };

  vm.update = (dt, state) => {
    // state: { moveSpeed, sprint, ads (0..1 target), firing, reloading, melee, grounded, velY }
    const w = WEAPONS[vm.weapon] || WEAPONS.m4;

    // ADS smoothing
    const targetAds = state.ads ? 1 : 0;
    vm.ads = damp(vm.ads, targetAds, w.adsSpeed ? 1 / w.adsSpeed : 6, dt);

    // recoil decay
    vm.recoil = Math.max(0, vm.recoil - dt * 9);
    vm.recoilSide = damp(vm.recoilSide, 0, 8, dt);

    // timers
    if (vm.reloadT >= 0) vm.reloadT -= dt;
    if (vm.meleeT >= 0) vm.meleeT -= dt;
    if (vm.swapT > 0) vm.swapT -= dt;
    if (vm.fireFlash > 0) vm.fireFlash -= dt * 8;

    // sprint bob
    const speed = state.moveSpeed || 0;
    vm.sprintT = damp(vm.sprintT, state.sprint ? 1 : 0, 8, dt);
    const sprintBob = state.sprint ? 1 : 0;
    vm.bobT += dt * (3.2 + speed * 1.6 + sprintBob * 3.4);

    // FOV: ADS zoom + sprint kick
    const sprintFov = state.sprint ? 4 : 0;
    const targetFov = vm.fovBase + sprintFov + vm.recoil * 30;
    vm.fovCurrent = damp(vm.fovCurrent, targetFov, 10, dt);
    // apply ADS zoom to camera
    const zoomFov = targetFov - (targetFov - vm.adsFov) * vm.ads;
    if (vm.camera) vm.camera.fov = damp(vm.camera.fov, zoomFov, 14, dt);
    if (vm.camera) vm.camera.updateProjectionMatrix();

    if (!vm.gun) return;

    // Pose calculation
    const idleBob = Math.sin(vm.bobT) * (speed > 0.5 ? 0.006 + speed * 0.0012 : 0);
    const idleSwayX = Math.sin(vm.bobT * 0.5) * 0.004;
    const bobX = Math.cos(vm.bobT) * (speed > 0.5 ? 0.008 + sprintBob * 0.012 : 0);
    const bobY = Math.abs(Math.sin(vm.bobT)) * (speed > 0.5 ? 0.009 + sprintBob * 0.014 : 0);

    // Recoil kick (pitch down of gun)
    const kickY = vm.recoil * 0.9;
    const kickX = vm.recoilSide * 0.8;

    // ADS pose
    const base = w.viewmodel;
    const posX = base.pos[0] + (base.adsPos[0] - base.pos[0]) * vm.ads;
    const posY = base.pos[1] + (base.adsPos[1] - base.pos[1]) * vm.ads;
    const posZ = base.pos[2] + (base.adsPos[2] - base.pos[2]) * vm.ads;

    // Sprint pose (drop gun down + right)
    const sprintDrop = vm.sprintT * 0.09;
    const sprintRot = vm.sprintT * 0.22;

    // Reload animation: dip + rotate
    let reloadDip = 0, reloadRot = 0;
    if (vm.reloadT >= 0) {
      const t = 1 - vm.reloadT / (WEAPONS[vm.weapon]?.reload || 1.6);
      if (t < 0.25) { reloadDip = (t / 0.25) * -0.22; reloadRot = (t / 0.25) * 0.7; }
      else if (t > 0.8) { const k = (1 - t) / 0.2; reloadDip = k * -0.22; reloadRot = k * 0.7; }
      else { reloadDip = -0.22; reloadRot = 0.7; }
    }

    // Melee lunge
    let meleeX = 0, meleeRot = 0, meleeDip = 0;
    if (vm.meleeT >= 0) {
      const t = 1 - vm.meleeT / 0.34;
      meleeX = Math.sin(t * Math.PI) * 0.16;
      meleeRot = Math.sin(t * Math.PI) * 1.5;
      meleeDip = Math.sin(t * Math.PI) * 0.06;
    }

    // Swap rotation
    let swapRot = 0, swapDrop = 0;
    if (vm.swapT > 0) {
      swapRot = vm.swapT * 2.4;
      swapDrop = vm.swapT * 0.3;
    }

    const g = vm.gun;
    g.position.set(
      posX + idleSwayX + bobX * (1 - vm.ads) + meleeX - kickX + sprintDrop * 0.4,
      posY + idleBob + bobY * (1 - vm.ads) + reloadDip - kickY - sprintDrop - meleeDip + swapDrop,
      posZ
    );
    g.rotation.set(
      reloadRot * (1 - vm.ads) + meleeRot + swapRot * 0.3 + kickY * 0.8,
      (vm.ads ? 0 : sprintRot) + swapRot + kickX,
      0
    );
    g.scale.setScalar((w.viewmodel.scale || 0.16) * (1 - vm.ads * 0.12));

    // muzzle flash
    if (vm.muzzle) {
      vm.muzzle.visible = vm.fireFlash > 0.3;
      if (vm.muzzle.visible) {
        vm.muzzle.material.opacity = clamp(vm.fireFlash, 0, 1) * 0.9;
        vm.muzzle.rotation.z = Math.random() * Math.PI;
      }
    }
  };

  vm.addRecoil = (w) => {
    const r = w ? w.recoil : { up: 0.012, side: 0.005 };
    vm.recoil = Math.min(vm.recoil + r.up * 9, 0.5);
    vm.recoilSide += (Math.random() - 0.5) * r.side * 14;
  };

  vm.startReload = (reloadTime) => {
    vm.reloadT = reloadTime || 1.6;
  };

  vm.melee = () => { vm.meleeT = 0.34; };

  vm.setFov = (f) => { vm.fovBase = f; vm.adsFov = f * 0.72; };

  vm.dispose = () => {
    if (vm.gun) disposeObject(vm.gun);
    scene.remove(root);
  };

  return vm;
}

function buildGun(id) {
  const w = WEAPONS[id] || WEAPONS.m4;
  const g = new THREE.Group();

  // Critic-specified material stack: cerakote, polymer, worn metal, wood
  const cerakote = new THREE.MeshStandardMaterial({ color: 0x262824, roughness: 0.6, metalness: 0.35 });
  const receiverMat = cerakote;  // receiver uses cerakote finish
  const polymer = new THREE.MeshStandardMaterial({ color: 0x161816, roughness: 0.75, metalness: 0.05 });
  const wornMetal = new THREE.MeshStandardMaterial({ color: 0x55564e, roughness: 0.55, metalness: 0.6 });
  const barrelMetal = new THREE.MeshStandardMaterial({ color: 0x3a3b36, roughness: 0.4, metalness: 0.75 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a4035, roughness: 0.85, metalness: 0.05 });
  const opticGlass = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.15, metalness: 0.4, emissive: 0x223344, emissiveIntensity: 0.15 });

  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = false;
    g.add(m);
    return m;
  };
  const box = (mat, w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (mat) => null; // placeholder, using part directly below

  switch (id) {
    case 'sniper': {
      // TAC-50 bolt action
      part(box(receiverMat, 0.05, 0.055, 0.52), receiverMat, 0, 0, -0.06);
      part(box(cerakote, 0.042, 0.05, 0.44), cerakote, 0, 0.004, -0.04);
      part(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 10), barrelMetal, 0, 0.012, 0.22, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.017, 0.017, 0.08, 10), barrelMetal, 0, 0.012, 0.4, Math.PI / 2, 0, 0);
      // scope
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10), wornMetal, 0, 0.055, 0.02, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10), wornMetal, 0, 0.055, -0.09, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 8), opticGlass, 0, 0.055, 0.14, Math.PI / 2, 0, 0);
      // stock + grip
      part(box(wood, 0.045, 0.05, 0.16), wood, 0, -0.01, -0.28);
      part(box(wood, 0.06, 0.1, 0.07), wood, 0, -0.08, 0.06);
      part(box(polymer, 0.05, 0.09, 0.06), polymer, 0, -0.075, 0.02);
      // bolt handle
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 6), wornMetal, 0.03, 0.045, -0.1, 0, 0, Math.PI / 2);
      break;
    }
    case 'shotgun': {
      // M870 pump
      part(box(cerakote, 0.055, 0.052, 0.4), cerakote, 0, 0, -0.02);
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 10), barrelMetal, 0, 0.02, 0.16, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 10), barrelMetal, 0, 0.02, 0.3, Math.PI / 2, 0, 0);
      // pump forend
      part(box(wood, 0.052, 0.06, 0.16), wood, 0, -0.02, 0.06);
      part(box(wood, 0.07, 0.1, 0.07), wood, 0, -0.07, 0.08);
      // stock
      part(box(wood, 0.05, 0.06, 0.14), wood, 0, -0.01, -0.2);
      // shell tube cap
      part(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), wornMetal, 0, 0.02, 0.32, Math.PI / 2, 0, 0);
      break;
    }
    case 'm249': {
      // SAW LMG
      part(box(receiverMat, 0.055, 0.06, 0.5), receiverMat, 0, 0.01, -0.02);
      part(box(cerakote, 0.048, 0.05, 0.44), cerakote, 0, 0.02, -0.02);
      part(new THREE.CylinderGeometry(0.016, 0.016, 0.4, 10), barrelMetal, 0, 0.0, 0.22, Math.PI / 2, 0, 0);
      // box mag
      part(box(polymer, 0.09, 0.16, 0.09), polymer, 0, -0.11, -0.05);
      // bipod (folded)
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), wornMetal, -0.02, -0.06, 0.14, 0, 0, 0.35);
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), wornMetal, 0.02, -0.06, 0.14, 0, 0, -0.35);
      // carry handle
      part(box(polymer, 0.05, 0.06, 0.03), polymer, 0, 0.05, -0.12);
      // front sight
      part(box(wornMetal, 0.02, 0.045, 0.015), wornMetal, 0, 0.045, 0.28);
      break;
    }
    case 'ak': {
      // AK-12
      part(box(receiverMat, 0.045, 0.05, 0.42), receiverMat, 0, 0.005, -0.02);
      part(box(cerakote, 0.04, 0.045, 0.36), cerakote, 0, 0.01, -0.02);
      // barrel + gas tube
      part(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), barrelMetal, 0, 0.03, 0.12, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), barrelMetal, 0, 0.055, 0.12, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 6), wornMetal, 0, 0.06, 0.28, Math.PI / 2, 0, 0);
      // wood furniture
      part(box(wood, 0.055, 0.1, 0.07), wood, 0, -0.08, 0.06);
      part(box(wood, 0.045, 0.05, 0.18), wood, 0, -0.01, -0.2);
      // curved mag
      part(new THREE.BoxGeometry(0.05, 0.1, 0.07), polymer, 0, -0.085, -0.02);
      part(new THREE.BoxGeometry(0.045, 0.07, 0.06), polymer, 0, -0.13, 0.0, 0.25);
      break;
    }
    case 'mp5': {
      part(box(receiverMat, 0.05, 0.045, 0.34), receiverMat, 0, 0, 0);
      part(box(cerakote, 0.045, 0.04, 0.3), cerakote, 0, 0.005, 0);
      part(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 8), barrelMetal, 0, 0.035, 0.16, Math.PI / 2, 0, 0);
      part(box(polymer, 0.05, 0.06, 0.05), polymer, 0, -0.06, 0.06);
      part(box(polymer, 0.04, 0.06, 0.07), polymer, 0, -0.05, -0.08);
      part(box(polymer, 0.045, 0.14, 0.055), polymer, 0, -0.1, 0.0, 0.2);
      // front sight ring
      part(new THREE.TorusGeometry(0.014, 0.004, 6, 10), wornMetal, 0, 0.05, 0.2, Math.PI / 2, 0, 0);
      break;
    }
    case 'pistol': {
      part(box(cerakote, 0.038, 0.042, 0.19), cerakote, 0, 0, 0);
      part(box(polymer, 0.035, 0.065, 0.07), polymer, 0, -0.05, 0.06);
      part(box(wornMetal, 0.022, 0.02, 0.07), wornMetal, 0, 0.028, 0.12);
      // slide serrations
      part(box(wornMetal, 0.036, 0.012, 0.03), wornMetal, 0, 0.028, -0.02);
      break;
    }
    case 'knife': {
      part(new THREE.BoxGeometry(0.014, 0.022, 0.22), wornMetal, 0, 0, -0.05);
      part(new THREE.BoxGeometry(0.016, 0.022, 0.02), wornMetal, 0, 0, -0.16, 0, 0, 0.6);
      part(new THREE.BoxGeometry(0.024, 0.055, 0.06), polymer, 0, 0, 0.09);
      break;
    }
    default: { // m4 — reference-accurate proportions + construction cues
      // receiver + upper
      part(box(receiverMat, 0.045, 0.05, 0.4), receiverMat, 0, 0.005, -0.03);
      part(box(cerakote, 0.04, 0.045, 0.34), cerakote, 0, 0.012, -0.03);
      // ejection port (darker recess + dust cover line)
      part(box(wornMetal, 0.026, 0.018, 0.05), wornMetal, 0.021, 0.035, 0.0);
      // charging handle
      part(new THREE.BoxGeometry(0.024, 0.02, 0.035), wornMetal, 0.028, 0.04, -0.15);
      // takedown pins
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6), wornMetal, 0, 0.03, -0.1, 0, 0, Math.PI / 2);
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6), wornMetal, 0, 0.02, -0.22, 0, 0, Math.PI / 2);
      // selector lever
      part(new THREE.BoxGeometry(0.012, 0.016, 0.03), wornMetal, 0.024, 0.018, 0.04);
      // trigger guard
      part(new THREE.TorusGeometry(0.02, 0.004, 6, 12, Math.PI), wornMetal, 0, -0.06, 0.05, 0, 0, 0);
      // upper rail
      part(box(cerakote, 0.032, 0.02, 0.2), cerakote, 0, 0.045, 0.0);
      // handguard (ventilated)
      part(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10), barrelMetal, 0, 0.02, 0.12, Math.PI / 2, 0, 0);
      part(box(cerakote, 0.04, 0.05, 0.2), cerakote, 0, 0.005, 0.12);
      // handguard heat-shield ribs
      for (let i = 0; i < 4; i++) {
        part(new THREE.TorusGeometry(0.019, 0.002, 5, 10), wornMetal, 0, 0.02, 0.05 + i * 0.045, 0, 0, 0);
      }
      // barrel
      part(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), barrelMetal, 0, 0.02, 0.26, Math.PI / 2, 0, 0);
      // gas block + front sight (delta)
      part(new THREE.BoxGeometry(0.02, 0.03, 0.04), wornMetal, 0, 0.028, 0.2);
      part(new THREE.BoxGeometry(0.014, 0.05, 0.02), wornMetal, 0, 0.05, 0.28);
      // A2 muzzle (birdcage)
      part(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), wornMetal, 0, 0.02, 0.36, Math.PI / 2, 0, 0);
      part(new THREE.CylinderGeometry(0.013, 0.013, 0.015, 10), wornMetal, 0, 0.02, 0.39, Math.PI / 2, 0, 0);
      // carry handle + rear sight (ladder aperture)
      part(box(cerakote, 0.05, 0.06, 0.04), cerakote, 0, 0.075, -0.12);
      part(box(wornMetal, 0.03, 0.025, 0.03), wornMetal, 0, 0.065, -0.14);
      // STANAG mag (curved)
      part(box(polymer, 0.042, 0.11, 0.06), polymer, 0, -0.09, -0.02);
      part(box(polymer, 0.04, 0.05, 0.055), polymer, 0, -0.13, 0.0, 0.18);
      // mag catch
      part(new THREE.BoxGeometry(0.008, 0.014, 0.014), wornMetal, 0.024, -0.035, 0.0);
      // pistol grip
      part(box(polymer, 0.045, 0.09, 0.06), polymer, 0, -0.08, 0.06);
      // collapsible stock
      part(box(polymer, 0.045, 0.05, 0.2), polymer, 0, -0.005, -0.24);
      part(box(polymer, 0.03, 0.025, 0.06), polymer, 0, 0.005, -0.32);
      part(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6), wornMetal, 0, 0.02, -0.28, 0, 0, Math.PI / 2);
      // sling plate
      part(box(wornMetal, 0.016, 0.02, 0.012), wornMetal, 0.024, 0.0, -0.34);
      // edge wear hints (subtle)
      part(box(cerakote, 0.04, 0.01, 0.05), cerakote, 0, 0.03, -0.04);
    }
  }
  g.userData.muzzle = new THREE.Object3D();
  g.userData.muzzle.position.set(0, 0.02, 0.4);
  g.add(g.userData.muzzle);
  return g;
}

function findMuzzle(g) { return g.userData.muzzle || null; }

function disposeObject(o) {
  o.traverse((c) => {
    if (c.isMesh) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); }
    }
  });
}

// Flash sprite (billboard) attached to muzzle for camera-facing flash.
export function createMuzzleFlash() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255, 240, 200, 1)');
  grd.addColorStop(0.3, 'rgba(255, 180, 90, 0.9)');
  grd.addColorStop(1, 'rgba(255, 120, 30, 0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.32, 0.32, 1);
  s.visible = false;
  return s;
}
