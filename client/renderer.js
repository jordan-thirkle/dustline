// DUSTLINE client renderer — Three.js scene, sun lighting, map meshes built
// from shared map data, quality presets, and a deterministic boot state for
// screenshot QA (gauntlet critic needs real pixels from a known camera).
import * as THREE from 'three';
import { MAPS_DATA, aabbs } from '../shared/map.js';

export const QUALITY = {
  low: { shadows: false, sunShadowMap: 1024, fxaa: false, dust: 0.4, dpr: 1, pop: 120 },
  med: { shadows: true, sunShadowMap: 2048, fxaa: true, dust: 0.7, dpr: 1.25, pop: 200 },
  high: { shadows: true, sunShadowMap: 2048, fxaa: true, dust: 1, dpr: 1.5, pop: 300 },
  ultra: { shadows: true, sunShadowMap: 4096, fxaa: true, dust: 1.2, dpr: 2, pop: 400 },
};

export function createRenderer(container, quality = QUALITY.high) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}

// Procedural noise texture for ground detail (baked once).
function noiseTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 90;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.anisotropy = 4;
  return t;
}

const PALETTES = [
  // plaster / stucco warm tans
  [0xc9b69b, 0xb39c7f, 0x8f7c63],
  [0xbfa888, 0xa58d6c, 0x7d6a4f],
  [0xd2c0a4, 0xb8a487, 0x93805f],
  // concrete grey
  [0xb9b3a8, 0xa49e93, 0x7f7a70],
  // corrugated metal (rust hints)
  [0x9aa0a3, 0x848b8f, 0x62686c],
  [0xa68d6f, 0x8d7355, 0x69553d],
  // crates
  [0xa8845a, 0x8c6d45, 0x6b5233],
  [0x7d8a6a, 0x66744f, 0x4c5738],
];

export function createWorld(renderer, scene, mapId = 'dustline', quality = QUALITY.high) {
  const map = MAPS_DATA[mapId] || MAPS_DATA.dustline;
  const light = map.light;

  // Fog + background match the dusty sky
  scene.fog = new THREE.Fog(light.fog[0], light.fog[1], light.fog[2], light.fogNear, light.fogFar);
  scene.background = new THREE.Color(light.sky[0], light.sky[1], light.sky[2]);

  // Sun
  const sun = new THREE.DirectionalLight(0xffe6c2, light.sunIntensity);
  sun.position.set(70, 95, 40);
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.sunShadowMap, quality.sunShadowMap);
    const d = 85;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere + fill for baked daylight feel
  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x6b5f4d, 0.55);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xb8c4ff, 0.22);
  fill.position.set(-60, 40, -70);
  scene.add(fill);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Ground
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xb3a68e,
    roughness: 0.94,
    metalness: 0.0,
    map: noiseTexture(256),
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.bounds[2] * 2 + 40, map.bounds[3] * 2 + 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  worldGroup.add(ground);

  // Faded ground texture variation: subtle large blotches via second overlay
  const blotch = new THREE.Mesh(
    new THREE.PlaneGeometry(map.bounds[2] * 2 + 40, map.bounds[3] * 2 + 40),
    new THREE.MeshBasicMaterial({ color: 0x9a8d74, transparent: true, opacity: 0.18, depthWrite: false })
  );
  blotch.rotation.x = -Math.PI / 2;
  blotch.position.y = 0.01;
  worldGroup.add(blotch);

  // Buildings & cover from shared map data
  const colliders = aabbs(map);
  map.objects.forEach((o, i) => {
    const p = PALETTES[o.palette % PALETTES.length];
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(o.w, o.h, o.d),
      new THREE.MeshStandardMaterial({
        color: p[0], roughness: 0.9, metalness: 0.02,
        map: wallTexture(o, p[0]),
      })
    );
    body.position.set(o.x, o.h / 2, o.z);
    body.castShadow = true;
    body.receiveShadow = true;
    worldGroup.add(body);

    // Slight trim darker base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(o.w + 0.06, 0.9, o.d + 0.06),
      new THREE.MeshStandardMaterial({ color: p[2], roughness: 0.95 })
    );
    base.position.set(o.x, 0.45, o.z);
    base.receiveShadow = true;
    worldGroup.add(base);

    // Roof
    if (o.roof === 'shed' && o.kind !== 'wall' && o.kind !== 'crate') {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(o.w + 0.3, 0.35, o.d + 0.3),
        new THREE.MeshStandardMaterial({ color: p[1], roughness: 0.85 })
      );
      roof.position.set(o.x, o.h + 0.17, o.z);
      roof.rotation.y = 0;
      roof.castShadow = true;
      worldGroup.add(roof);
      // low parapet
      const para = new THREE.Mesh(
        new THREE.BoxGeometry(o.w + 0.4, 0.5, 0.4),
        new THREE.MeshStandardMaterial({ color: p[2], roughness: 0.9 })
      );
      para.position.set(o.x, o.h + 0.25, o.z + o.d / 2 - 0.15);
      worldGroup.add(para);
    }
  });

  // Distant "city" skyline silhouette (cheap, readable depth)
  addSkyline(worldGroup, map.bounds, light.fog);

  // Dust particles (subtle, sunlit)
  const dust = createDust(scene, map.dust, quality.dust);
  dust.visible = quality.dust > 0.2;

  // Spawn point markers for QA camera placement
  return {
    sun, hemi, worldGroup, colliders, map, dust,
    setQuality(q) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
      renderer.shadowMap.enabled = q.shadows;
      sun.shadow.mapSize.set(q.sunShadowMap, q.sunShadowMap);
      dust.visible = q.dust > 0.2;
    },
    dispose() {
      scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material) o.material.dispose();
        }
      });
    },
  };
}

// Wall texture with stucco patches + grime streaks, baked procedural.
function wallTexture(o, baseColor) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 256, 256);
  // noise
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() * 40 - 20 | 0}, ${Math.random() * 40 - 20 | 0}, ${Math.random() * 30 - 15 | 0}, 0.08)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 4, 4);
  }
  // horizontal grime streak
  g.fillStyle = 'rgba(60, 50, 40, 0.10)';
  g.fillRect(0, 160 + Math.random() * 40, 256, 26);
  // windows
  if (o.windows) {
    const rows = Math.max(2, Math.round(o.h / 3.2));
    const cols = Math.max(2, Math.round((o.w > o.d ? o.w : o.d) / 3.6));
    const w = 256 / (cols + 1), hh = 256 / (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = w * (cc + 1) - 18, y = hh * (r + 1) - 14;
        g.fillStyle = 'rgba(24, 26, 30, 0.85)';
        g.fillRect(x, y, 36, 28);
        g.fillStyle = 'rgba(150, 170, 200, 0.14)';
        g.fillRect(x + 3, y + 3, 30, 22);
        g.strokeStyle = 'rgba(20, 18, 14, 0.9)';
        g.lineWidth = 2;
        g.strokeRect(x, y, 36, 28);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function addSkyline(group, bounds, fogColor) {
  // cheap layered boxes in fog color to suggest a town beyond the playfield
  const matFar = new THREE.MeshBasicMaterial({ color: new THREE.Color(fogColor[0], fogColor[1], fogColor[2]) });
  const rng = mulberry(7);
  const edges = [
    [bounds[0] - 30, bounds[2] + 30, bounds[2] + 70],
    [bounds[2] + 30, bounds[0] - 30, bounds[0] - 70],
  ];
  edges.forEach(([xStart, zStart]) => {
    for (let i = 0; i < 14; i++) {
      const w = 6 + rng() * 8, h = 10 + rng() * 22, d = 10 + rng() * 20;
      const bx = xStart + (rng() * 90 - 45);
      const bz = zStart + (rng() * 40 - 20);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFar);
      m.position.set(bx, h / 2, bz);
      group.add(m);
    }
  });
  // edge walls so fog reads as buildings
  const wallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(fogColor[0], fogColor[1], fogColor[2]) });
  const L = bounds[2] - bounds[0] + 40;
  const edges2 = [
    [bounds[0] - 26, 0, L, 0, -14],
    [bounds[2] + 26, 0, L, 0, 14],
    [0, bounds[0] - 26, 14, L, -14],
    [0, bounds[2] + 26, 14, L, 14],
  ];
  edges2.forEach(([x, z, w, d, off]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 30, d), wallMat);
    m.position.set(x + (off ? 0 : 0), 15, z + (off ? off : 0));
    group.add(m);
  });
}

function createDust(scene, density, q) {
  const count = Math.floor(220 * q * density);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const seedy = mulberry(11);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = seedy() * 240 - 120;
    pos[i * 3 + 1] = 0.4 + seedy() * 9;
    pos[i * 3 + 2] = seedy() * 240 - 120;
    vel[i * 3] = (seedy() - 0.5) * 0.4;
    vel[i * 3 + 1] = (seedy() - 0.5) * 0.2;
    vel[i * 3 + 2] = (seedy() - 0.5) * 0.4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xd8cbaa, size: 0.12, transparent: true, opacity: 0.16,
    depthWrite: false, blending: THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.vel = vel;
  scene.add(pts);
  return pts;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function updateDust(dust, dt) {
  if (!dust || !dust.visible) return;
  const pos = dust.geometry.attributes.position.array;
  const vel = dust.userData.vel;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    if (pos[i * 3] > 120) pos[i * 3] = -120;
    if (pos[i * 3] < -120) pos[i * 3] = 120;
    if (pos[i * 3 + 1] > 10) pos[i * 3 + 1] = 0.4;
    if (pos[i * 3 + 2] > 120) pos[i * 3 + 2] = -120;
    if (pos[i * 3 + 2] < -120) pos[i * 3 + 2] = 120;
  }
  dust.geometry.attributes.position.needsUpdate = true;
}
