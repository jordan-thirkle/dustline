import * as THREE from 'three';

// A small, deliberately authored structure kit for DUSTLINE's two readability beats.
const STEEL = 0x6b5a45;
const STEEL_DARK = 0x413b34;
const CONCRETE = 0x8a8378;
const COOL_SHADOW = 0x53616b;
const DUST = 0x6f6250;

function mat(color, roughness = 0.82, metalness = 0.0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function part(group, geometry, material, x, y, z, cast = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function canvasTexture(kind) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, size, size);
  if (kind === 'chip') {
    g.fillStyle = 'rgba(63,57,49,.72)';
    for (let i = 0; i < 16; i++) {
      const x = 8 + Math.random() * 235, y = 18 + Math.random() * 218;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12 + Math.random() * 24, y - 5);
      g.lineTo(x + 18 + Math.random() * 20, y + 10 + Math.random() * 18);
      g.lineTo(x - 4, y + 14 + Math.random() * 18); g.closePath(); g.fill();
    }
  } else if (kind === 'streak') {
    for (let i = 0; i < 12; i++) {
      const x = 12 + Math.random() * 230;
      g.strokeStyle = `rgba(67,59,49,${0.18 + Math.random() * .2})`;
      g.lineWidth = 2 + Math.random() * 4;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - .5) * 18, 70 + Math.random() * 170); g.stroke();
    }
  } else if (kind === 'patch') {
    g.fillStyle = 'rgba(157,146,128,.82)';
    for (let i = 0; i < 5; i++) {
      const x = 20 + Math.random() * 190, y = 20 + Math.random() * 190;
      g.fillRect(x, y, 28 + Math.random() * 45, 18 + Math.random() * 38);
      g.strokeStyle = 'rgba(75,68,58,.55)'; g.lineWidth = 3; g.strokeRect(x, y, 28 + Math.random() * 45, 18 + Math.random() * 38);
    }
  } else {
    g.fillStyle = 'rgba(42,36,29,.28)';
    for (let i = 0; i < 28; i++) g.fillRect(Math.random() * size, Math.random() * 45, 8 + Math.random() * 30, 10 + Math.random() * 35);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function detailPlane(group, texture, x, y, z, width, height, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({
    color: 0xb0a18c, map: texture, transparent: true, roughness: 1, depthWrite: false,
  }));
  mesh.position.set(x, y, z); mesh.rotation.y = rotationY;
  mesh.receiveShadow = true; group.add(mesh); return mesh;
}

function addBeam(group, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material);
  beam.position.copy(start).add(end).multiplyScalar(.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  beam.castShadow = beam.receiveShadow = true; group.add(beam); return beam;
}

function dustRing(group, x, z, w, d, opacity = .28) {
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: DUST, transparent: true, opacity, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, .025, z); group.add(ring);
}

function towerObject(mapData) {
  const objects = mapData && mapData.objects ? mapData.objects : [];
  return objects.find(o => o.kind === 'tower' && o.x === -38 && o.z === 40) || { x: -38, z: 40, w: 7, d: 7, h: 13 };
}

export function removeOldTower(mapData, worldGroup) {
  const o = towerObject(mapData);
  const remove = [];
  worldGroup.traverse(child => {
    if (!child.isMesh || !child.geometry || !child.geometry.parameters) return;
    const p = child.geometry.parameters;
    const atTower = Math.abs(child.position.x - o.x) < .01 && Math.abs(child.position.z - o.z) < .01;
    const oldBox = p.width === o.w && p.depth === o.d && p.height === o.h;
    if (atTower && oldBox) remove.push(child);
  });
  remove.forEach(child => child.parent && child.parent.remove(child));
  return remove.length;
}

export function buildTower(mapData, worldGroup) {
  const o = towerObject(mapData);
  const group = new THREE.Group();
  group.name = 'dustline_watchtower_structure';
  worldGroup.add(group);
  const steel = mat(STEEL, .7, .62), darkSteel = mat(STEEL_DARK, .82, .5);
  const concrete = mat(CONCRETE, .93), cool = mat(COOL_SHADOW, .9);
  const tube = new THREE.CylinderGeometry(.16, .18, 8.9, 10);

  // 6.4m plinth stays inside the shared 7m x 7m collision footprint.
  part(group, new THREE.BoxGeometry(6.35, .42, 6.35), concrete, o.x, .21, o.z);
  dustRing(group, o.x, o.z, 7.0, 7.0, .34);
  dustRing(group, o.x, o.z, 7.6, 7.6, .12);

  // Four credible load paths, with cool shadow-side gussets.
  [-2.45, 2.45].forEach(dx => [-2.45, 2.45].forEach(dz => {
    part(group, tube, steel, o.x + dx, 4.85, o.z + dz);
    part(group, new THREE.BoxGeometry(.42, .28, .42), darkSteel, o.x + dx, .56, o.z + dz);
  }));
  part(group, new THREE.BoxGeometry(5.9, .24, 5.9), steel, o.x, 7.05, o.z);
  part(group, new THREE.BoxGeometry(5.75, .18, 5.75), cool, o.x, 7.2, o.z, false);
  // Cross-braces on two visible faces: silhouette break at the mid-height.
  [-2.62, 2.62].forEach(dz => {
    addBeam(group, [o.x - 2.45, 1.0, o.z + dz], [o.x + 2.45, 6.8, o.z + dz], .075, darkSteel);
    addBeam(group, [o.x + 2.45, 1.0, o.z + dz], [o.x - 2.45, 6.8, o.z + dz], .075, darkSteel);
  });

  // Cabin and darker rear/shadow plane, held below the 13m AABB height.
  part(group, new THREE.BoxGeometry(4.8, 2.35, 4.5), steel, o.x, 9.05, o.z);
  part(group, new THREE.BoxGeometry(4.25, 1.75, .08), cool, o.x, 9.1, o.z + 2.29, false);
  const slit = mat(0x273038, .95, .05);
  [-1.45, 0, 1.45].forEach(dx => part(group, new THREE.BoxGeometry(.72, .34, .06), slit, o.x + dx, 9.25, o.z - 2.29, false));
  [-1.45, 1.45].forEach(dx => part(group, new THREE.BoxGeometry(.08, .35, .58), slit, o.x + dx, 9.25, o.z + 2.31, false));
  part(group, new THREE.BoxGeometry(5.15, .25, 4.85), darkSteel, o.x, 10.3, o.z);
  // Guard rail gives the upper silhouette a human scale and a second break.
  [o.z - 2.25, o.z + 2.25].forEach(z => { addBeam(group, [o.x - 2.35, 10.75, z], [o.x + 2.35, 10.75, z], .065, steel); [-2.25, 2.25, 0].forEach(dx => addBeam(group, [o.x + dx, 10.3, z], [o.x + dx, 10.75, z], .055, steel)); });
  addBeam(group, [o.x - 2.35, 10.75, o.z - 2.25], [o.x - 2.35, 10.75, o.z + 2.25], .065, steel);

  // Ladder on the near face, with evenly spaced rungs readable at player height.
  addBeam(group, [o.x - 1.0, .55, o.z - 2.72], [o.x - 1.0, 7.05, o.z - 2.72], .065, steel);
  addBeam(group, [o.x + 1.0, .55, o.z - 2.72], [o.x + 1.0, 7.05, o.z - 2.72], .065, steel);
  for (let y = 1; y < 7; y += .62) addBeam(group, [o.x - 1, y, o.z - 2.72], [o.x + 1, y, o.z - 2.72], .05, steel);

  // Roof antenna and dish stop at 12.85m, inside the 13m server collider.
  addBeam(group, [o.x, 10.42, o.z], [o.x, 12.72, o.z], .075, darkSteel);
  part(group, new THREE.CylinderGeometry(.8, .28, .08, 20, 1, false, 0, Math.PI), steel, o.x, 11.45, o.z + .1).rotation.x = -.45;
  addBeam(group, [o.x, 11.4, o.z + .1], [o.x, 11.95, o.z + .1], .045, steel);

  // Door, barrel, and sandbags make the base legible without changing collision data.
  part(group, new THREE.BoxGeometry(1.0, 1.8, .1), darkSteel, o.x + 2.46, 1.45, o.z - .5);
  part(group, new THREE.CylinderGeometry(.38, .38, .85, 12), steel, o.x - 2.05, .83, o.z - 1.1);
  for (let i = 0; i < 5; i++) part(group, new THREE.SphereGeometry(.42, 8, 5), mat(0x9b896c, .95), o.x - 1.2 + (i % 2) * .65, .42 + Math.floor(i / 2) * .34, o.z + 1.65);
  return group;
}

export function buildAlleyProps(mapData, worldGroup) {
  const group = new THREE.Group(); group.name = 'dustline_alley_structure_pass'; worldGroup.add(group);
  const wall = mat(0x766f66, .95), edge = mat(0x554f48, .95);
  // Foreground partial obstruction in the x=-14..-6, z=-10..6 corridor.
  part(group, new THREE.BoxGeometry(2.8, 1.65, .34), wall, -11.5, .825, -6.4);
  part(group, new THREE.BoxGeometry(2.95, .12, .48), edge, -11.5, 1.68, -6.4);
  // Three authored wall-detail families: chips, water streaks, and repairs.
  detailPlane(group, canvasTexture('chip'), -3.52, 1.7, -12.71, 1.6, 2.3, 0);
  detailPlane(group, canvasTexture('streak'), -1.7, 1.15, -12.73, 1.0, 2.1, 0);
  detailPlane(group, canvasTexture('patch'), -8.98, 1.25, 0.73, 2.2, 1.35, Math.PI / 2);
  detailPlane(group, canvasTexture('chip'), -11.1, .9, 0.73, 1.2, 1.6, Math.PI / 2);
  // Irregular wall-side accumulation, while the corridor center remains dusty.
  [
    [-4.0, -11.2, 3.8, .7], [-9.0, 1.2, .8, 4.2], [-6.7, -4.8, .65, 2.0],
  ].forEach(([x, z, w, d]) => { dustRing(group, x, z, w, d, .27); });
  // Hard-edged sun shaft / controlled value break, only a narrow slice of the alley.
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.8), new THREE.MeshBasicMaterial({ color: 0xd2b98d, transparent: true, opacity: .18, depthWrite: false }));
  shaft.rotation.x = -Math.PI / 2; shaft.position.set(-7.2, .035, -3.2); group.add(shaft);
  return group;
}
