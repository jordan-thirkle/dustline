import * as THREE from 'three';

// Shared, deliberately restrained materials: the kit should sit in the dusty light.
const palette = {
  tan: 0x9a8061, sand: 0xb29a77, dark: 0x4a4036, wood: 0x765b3e,
  canvas: 0x9b8d70, fadedRed: 0x8b5547, blue: 0x53656a, steel: 0x62615a,
  rust: 0x70483b, black: 0x282822, plastic: 0x777368, white: 0xc2b69a,
};
const materials = {
  cloth: new THREE.MeshStandardMaterial({ color: palette.canvas, roughness: 0.95, side: THREE.DoubleSide }),
  canvas: new THREE.MeshStandardMaterial({ color: palette.canvas, roughness: 0.9, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ color: palette.wood, roughness: 0.82 }),
  paintedMetal: new THREE.MeshStandardMaterial({ color: palette.steel, roughness: 0.65, metalness: 0.5 }),
  rustedMetal: new THREE.MeshStandardMaterial({ color: palette.rust, roughness: 0.78, metalness: 0.35 }),
  plastic: new THREE.MeshStandardMaterial({ color: palette.plastic, roughness: 0.72 }),
  rubber: new THREE.MeshStandardMaterial({ color: palette.black, roughness: 0.92 }),
};

function texture(label, stripes = false) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#9b8d70'; x.fillRect(0, 0, 256, 128);
  if (stripes) { x.fillStyle = '#7f6654'; for (let i = -1; i < 8; i += 2) x.fillRect(i * 40, 0, 20, 128); }
  x.fillStyle = '#3e3930'; x.font = 'bold 25px sans-serif'; x.textAlign = 'center'; x.fillText(label, 128, 76);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function mat(base, color, map = null) {
  if (map) { const m = base.clone(); m.color.set(0xffffff); m.map = map; m.needsUpdate = true; return m; }
  const m = base.clone(); m.color.set(color); return m;
}
function box(g, size, material, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function cyl(g, radius, height, material, y = 0, radial = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, height, radial), material); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function beam(g, a, b, radius, material) {
  const v = new THREE.Vector3().subVectors(b, a); const m = cyl(g, radius, v.length(), material, 0, 8);
  m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); return m;
}
function decal(g, w = 2.5, d = 1.8) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x342d25, transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.006; m.renderOrder = 1; g.add(m); return m;
}
function finish(g, opts = {}) { g.scale.setScalar(opts.scale || 1); if (opts.scale && typeof opts.scale !== 'number') g.scale.set(opts.scale.x || 1, opts.scale.y || 1, opts.scale.z || 1); return g; }
function crate(g, x, y, z, broken = false) {
  const c = box(g, [x, y, z], materials.wood, y / 2); const edge = 0.055;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, [edge, y + 0.08, edge], materials.rustedMetal, y / 2).position.set(sx * (x / 2 - edge), y / 2, sz * (z / 2 - edge));
  if (broken) { c.rotation.z = -0.08; box(g, [x * 0.75, edge, edge], materials.wood, y * 0.75).rotation.z = 0.2; }
  return c;
}

export function createProp(kind, opts = {}) {
  const g = new THREE.Group();
  const seed = opts.seed || 1;
  switch (kind) {
    case 'crate_stack': crate(g, 1, 0.72, 0.9); crate(g, 0.9, 0.62, 0.82).position.set(0.06, 0.72, 0.04); break;
    case 'pallet': {
      box(g, [1.25, 0.12, 1.05], materials.wood, 0.08);
      for (let x = -0.48; x <= 0.48; x += 0.24) box(g, [0.13, 0.18, 1.08], materials.wood, 0.18).position.x = x;
      for (const x of [-0.48, 0.48]) box(g, [0.12, 0.24, 1.08], materials.wood, 0.2).position.x = x;
      break;
    }
    case 'canvas_awning': {
      const cloth = mat(materials.canvas, palette.canvas, texture('MARKET', true));
      box(g, [3.5, 0.09, 1.8], cloth, 2.65).rotation.x = -0.12;
      for (const x of [-1.55, 1.55]) beam(g, new THREE.Vector3(x, 0, 0.7), new THREE.Vector3(x, 2.65, -0.05), 0.045, materials.paintedMetal);
      box(g, [3.65, 0.1, 0.1], materials.paintedMetal, 2.62).position.z = -0.85;
      break;
    }
    case 'steel_barrel': cyl(g, 0.43, 0.9, materials.paintedMetal, 0.45, 20); for (const y of [0.16, 0.72]) { const r = cyl(g, 0.445, 0.035, materials.rustedMetal, y, 20); r.scale.z = 1; } break;
    case 'sandbag': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), materials.canvas); m.scale.set(1.35, 0.62, 0.78); m.position.y = 0.26; m.castShadow = true; m.receiveShadow = true; g.add(m);
      beam(g, new THREE.Vector3(0.22, 0.42, 0), new THREE.Vector3(0.35, 0.56, 0.04), 0.018, materials.rubber); break;
    }
    case 'signage': {
      const signMat = mat(materials.wood, palette.tan, texture('SUPPLY', false)); box(g, [1.35, 0.72, 0.1], signMat, 2.35);
      beam(g, new THREE.Vector3(-0.46, 0, 0), new THREE.Vector3(-0.46, 2.2, 0), 0.055, materials.paintedMetal); beam(g, new THREE.Vector3(0.46, 0, 0), new THREE.Vector3(0.46, 2.2, 0), 0.055, materials.paintedMetal); break;
    }
    case 'hanging_cloth': { const m = box(g, [1.1, 1.35, 0.035], mat(materials.cloth, seed % 2 ? palette.fadedRed : palette.blue), 1.55); m.rotation.y = 0.05; beam(g, new THREE.Vector3(-0.55, 2.28, 0), new THREE.Vector3(0.55, 2.28, 0), 0.025, materials.rustedMetal); break; }
    case 'sack': { const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), materials.cloth); m.scale.set(0.8, 1.15, 0.8); m.position.y = 0.46; m.castShadow = true; g.add(m); beam(g, new THREE.Vector3(-0.1, 0.82, 0), new THREE.Vector3(0.1, 0.82, 0), 0.02, materials.rubber); break; }
    case 'basket': { cyl(g, 0.42, 0.5, materials.wood, 0.25, 12); const inner = cyl(g, 0.33, 0.03, materials.dark, 0.5, 12); inner.castShadow = false; break; }
    case 'broken_crate': crate(g, 0.95, 0.68, 0.8, true); break;
    case 'cable_run': { beam(g, new THREE.Vector3(-1.5, 0.72, 0), new THREE.Vector3(1.5, 0.82, 0.1), 0.045, materials.rubber); for (const x of [-1.4, 0, 1.4]) cyl(g, 0.08, 0.2, materials.rustedMetal, 0.1, 8).position.x = x; break; }
    case 'hvac_unit': { box(g, [1.2, 0.75, 0.75], materials.paintedMetal, 0.55); box(g, [0.8, 0.42, 0.04], materials.rubber, 0.58).position.z = 0.39; for (let x = -0.3; x <= 0.3; x += 0.2) box(g, [0.035, 0.3, 0.05], materials.rustedMetal, 0.58).position.set(x, 0, 0.42); break; }
    case 'water_tank': { cyl(g, 0.72, 1.25, materials.plastic, 0.85, 20); cyl(g, 0.74, 0.07, materials.rustedMetal, 1.48, 20); for (const x of [-0.48, 0.48]) beam(g, new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0.35, 0), 0.05, materials.paintedMetal); break; }
    case 'antenna': { beam(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.8, 0), 0.04, materials.paintedMetal); beam(g, new THREE.Vector3(-0.35, 2.55, 0), new THREE.Vector3(0.35, 2.55, 0), 0.025, materials.paintedMetal); box(g, [0.32, 0.12, 0.32], materials.rustedMetal, 0.06); break; }
    case 'dish': { box(g, [0.5, 0.15, 0.5], materials.paintedMetal, 0.08); const d = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.paintedMetal); d.position.y = 1.05; d.rotation.x = Math.PI; d.castShadow = true; g.add(d); beam(g, new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 0.78, 0), 0.045, materials.rustedMetal); break; }
    case 'guard_rail': { beam(g, new THREE.Vector3(-1.3, 0.75, 0), new THREE.Vector3(1.3, 0.75, 0), 0.055, materials.paintedMetal); for (const x of [-1.25, 1.25]) beam(g, new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0.76, 0), 0.06, materials.rustedMetal); break; }
    case 'ladder': { for (const x of [-0.3, 0.3]) beam(g, new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 2.2, 0), 0.045, materials.paintedMetal); for (let y = 0.3; y < 2.1; y += 0.35) beam(g, new THREE.Vector3(-0.3, y, 0), new THREE.Vector3(0.3, y, 0), 0.035, materials.rustedMetal); break; }
    case 'vehicle_nose': { box(g, [2.2, 0.8, 1.35], materials.paintedMetal, 0.72); box(g, [1.7, 0.42, 1.2], materials.rustedMetal, 1.28).position.z = -0.12; for (const x of [-0.72, 0.72]) cyl(g, 0.26, 0.16, materials.rubber, 0.3, 14).rotation.x = Math.PI / 2; break; }
    default: box(g, [0.5, 0.5, 0.5], materials.wood, 0.25);
  }
  return finish(g, opts);
}

function place(parent, kind, x, z, options = {}) { const p = createProp(kind, options); p.position.set(x, 0, z); parent.add(p); return p; }
function cluster(parent, x, z, items, w = 2.6, d = 2) { const c = new THREE.Group(); c.position.set(x, 0, z); decal(c, w, d); items.forEach(([kind, dx, dz, o]) => place(c, kind, dx, dz, o)); parent.add(c); return c; }

export function propKit(mapData) {
  const kit = new THREE.Group();
  kit.name = 'DUSTLINE_market_prop_kit';
  // Market footprint is x 8..24, z -6..16. The central lane (roughly x=15) remains open.
  cluster(kit, 10.7, 0.2, [['canvas_awning', 0, 0], ['signage', 0, -0.9], ['crate_stack', -1.2, 0.8], ['sack', 1.15, 0.65], ['basket', 1.2, -0.45]], 4.3, 3.5);
  cluster(kit, 20.7, 2.4, [['steel_barrel', 0, 0], ['steel_barrel', 0.9, 0.18, { seed: 2 }], ['pallet', -0.65, 0.65]], 2.9, 2.6);
  cluster(kit, 10.2, 9.8, [['steel_barrel', 0, 0], ['steel_barrel', 0.82, 0.12, { seed: 3 }], ['broken_crate', -0.8, 0.75]], 2.7, 2.5);
  cluster(kit, 21, 11.5, [['pallet', 0, 0], ['hanging_cloth', -0.7, 0.25], ['sack', 0.72, 0.55]], 2.8, 2.5);
  // A short, readable edge detail gives the market a service side without cluttering the route.
  place(kit, 'cable_run', 23.2, 6.8); place(kit, 'guard_rail', 9.1, 14.3);
  return kit;
}
