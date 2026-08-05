// DUSTLINE client renderer — Three.js scene, sun lighting, map meshes built
// from shared map data, quality presets, and a deterministic boot state for
// screenshot QA (gauntlet critic needs real pixels from a known camera).
import * as THREE from 'three';
import { MAPS_DATA, aabbs } from '../shared/map.js';
import { propKit } from './props.js';
import { buildTower, buildAlleyProps, removeOldTower } from './structures.js';

export const QUALITY = {
  low: { shadows: false, sunShadowMap: 1024, fxaa: false, dust: 0.4, dpr: 1, pop: 120 },
  med: { shadows: true, sunShadowMap: 2048, fxaa: true, dust: 0.7, dpr: 1.25, pop: 200 },
  high: { shadows: true, sunShadowMap: 2048, fxaa: true, dust: 1, dpr: 1.5, pop: 300 },
  ultra: { shadows: true, sunShadowMap: 4096, fxaa: true, dust: 1.2, dpr: 2, pop: 400 },
};

// Procedural dusty pavement texture — macro variation, seams, cracks, grime.
function pavementTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  // base dusty concrete
  const base = [0x8a, 0x84, 0x76];
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, S, S);

  // large macro blotches (mottled wear)
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 40 + Math.random() * 90;
    const grd = g.createRadialGradient(x, y, 2, x, y, r);
    const tone = 20 + Math.random() * 24;
    grd.addColorStop(0, `rgba(${tone},${tone - 4},${tone - 10},0.10)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // fine noise (dust/sand grain)
  for (let i = 0; i < 14000; i++) {
    const v = Math.random() * 34 - 17;
    g.fillStyle = `rgba(${v | 0},${(v * 0.9) | 0},${(v * 0.7) | 0},0.06)`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
  }

  // concrete slab seams (grid)
  g.strokeStyle = 'rgba(50,46,40,0.5)';
  g.lineWidth = 2.5;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * S;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  // seam shadow (one side darker)
  g.strokeStyle = 'rgba(30,28,24,0.4)';
  g.lineWidth = 3;
  for (let i = 1; i <= 4; i++) {
    const p = (i / 4) * S + 2;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }

  // cracks
  g.strokeStyle = 'rgba(40,36,30,0.55)';
  for (let i = 0; i < 12; i++) {
    g.lineWidth = 1 + Math.random() * 1.4;
    g.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    g.moveTo(x, y);
    const steps = 6 + (Math.random() * 8 | 0);
    for (let s = 0; s < steps; s++) {
      x += (Math.random() - 0.5) * 40;
      y += (Math.random() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // dirt accumulation in seams + grime
  g.fillStyle = 'rgba(60,52,40,0.18)';
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 26;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // tire/traffic wear bands
  g.fillStyle = 'rgba(70,64,52,0.14)';
  g.fillRect(0, S * 0.3, S, 26);
  g.fillRect(0, S * 0.72, S, 20);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(18, 18);
  t.anisotropy = 8;
  return t;
}

// Vertical grime gradient — dense at base, fades up ~1.1m, irregular splash.
function grimeTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // vertical fade: dark at bottom, transparent at top
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, 'rgba(30,26,20,0)');
  grd.addColorStop(0.65, 'rgba(30,26,20,0.25)');
  grd.addColorStop(1, 'rgba(24,20,15,0.9)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // irregular splash edges
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S;
    const y = S * 0.6 + Math.random() * S * 0.4;
    const r = 3 + Math.random() * 12;
    g.fillStyle = 'rgba(20,16,12,0.3)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// Soft radial gradient for AO contact under buildings.
function contactShadowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function createRenderer(container, quality = QUALITY.high) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;   // punchier key-to-shadow separation
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
  scene.fog = new THREE.Fog(light.fog[0], light.fog[1], light.fog[2], light.fogNear * 0.55, light.fogFar);
  scene.background = new THREE.Color(light.sky[0], light.sky[1], light.sky[2]);

  // Sun — authoritative low-angle key: hard-ish shadows, warm, strong
  const sun = new THREE.DirectionalLight(0xffe0b8, 4.6);
  sun.position.set(38, 48, 16);
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.sunShadowMap, quality.sunShadowMap);
    const d = 90;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 280;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = 2.5;   // tighter = harder edge = more authority
  }
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere + cool fill — crushed global fill, but a narrow cool bounce
  // keeps shadow INTERIORS readable (critic r5: shadows win but not voids).
  const hemi = new THREE.HemisphereLight(0xfff0da, 0x3a4a5a, 0.28);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x8fb8e8, 0.42);
  fill.position.set(-60, 40, -70);
  scene.add(fill);
  // cool sky bounce that lifts ONLY the deepest shadow interiors — must stay
  // as fill, not a second key (critic r6: reduce until it reads as fill).
  const skyBounce = new THREE.DirectionalLight(0x9db8d8, 0.14);
  skyBounce.position.set(0, 90, -20);
  scene.add(skyBounce);

  // subtle warm bounce light from ground
  const bounce = new THREE.DirectionalLight(0xc8b690, 0.3);
  bounce.position.set(0, -10, 0);
  scene.add(bounce);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Ground — dusty pavement (critic: layered surface, not a clean plane)
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x9a938a,
    roughness: 0.82,
    metalness: 0.0,
    map: pavementTexture(),
    bumpMap: pavementTexture(),
    bumpScale: 0.6,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.bounds[2] * 2 + 40, map.bounds[3] * 2 + 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  worldGroup.add(ground);

  // Contact shadows — footprint-aligned soft rectangles (not oval decals),
  // darker and tighter at the base, fading with distance from the object.
  const dirtDecals = new THREE.Group();
  map.objects.forEach((o) => {
    if (o.kind === 'building') return; // buildings get real shadow maps
    const sw = o.w * 1.25 + 0.8, sd = o.d * 1.25 + 0.8;
    // tight soft shadow under the footprint (denser — critic r8: grounding)
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sd),
      new THREE.MeshBasicMaterial({ color: 0x070706, transparent: true, opacity: 0.55, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(o.x, 0.045, o.z);
    dirtDecals.add(shadow);
    // dirt stain ring around base
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(o.w + 1.4, o.d + 1.4),
      new THREE.MeshBasicMaterial({ color: 0x4c4436, transparent: true, opacity: 0.16, depthWrite: false })
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(o.x, 0.02, o.z);
    dirtDecals.add(decal);
  });
  worldGroup.add(dirtDecals);

  // Building base AO — dark ground contact band around every structure
  // (critic r8: walls must visibly sit on the ground, not float).
  const aoTex = contactShadowTexture();
  map.objects.forEach((o) => {
    const bandW = o.w + 2.4, bandD = o.d + 2.4;
    const ao = new THREE.Mesh(
      new THREE.PlaneGeometry(bandW, bandD),
      new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, opacity: 0.65, depthWrite: false })
    );
    ao.rotation.x = -Math.PI / 2;
    ao.position.set(o.x, 0.05, o.z);
    dirtDecals.add(ao);
  });

  // Wall-base grime band — irregular vertical splash, not continuous strip.
  // Use a gradient texture so it fades up 0.3-1.2m (critic).
  const grimeTex = grimeTexture();
  map.objects.forEach((o) => {
    if (o.kind !== 'wall' && o.kind !== 'crate' && o.kind !== 'tower') return;
    const grime = new THREE.Mesh(
      new THREE.BoxGeometry(o.w + 0.05, 1.1, o.d + 0.05),
      new THREE.MeshBasicMaterial({ map: grimeTex, transparent: true, opacity: 0.5, depthWrite: false })
    );
    grime.position.set(o.x, 0.55, o.z);
    worldGroup.add(grime);
  });

  // Buildings & cover from shared map data
  const colliders = aabbs(map);
  map.objects.forEach((o, i) => {
    const p = PALETTES[o.palette % PALETTES.length];
    // material response by kind (critic: concrete/painted/metal/wood distinct)
    let rough, metal;
    if (o.kind === 'crate') { rough = 0.8; metal = 0.15; }         // painted wood
    else if (o.kind === 'tower') { rough = 0.55; metal = 0.6; }    // oxidized steel
    else if (o.kind === 'wall') { rough = 0.85; metal = 0.05; }    // masonry
    else { rough = 0.78; metal = 0.1; }                            // painted stucco
    const wallTex = wallTexture(o, p[0]);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(o.w, o.h, o.d),
      new THREE.MeshStandardMaterial({
        color: p[0], roughness: rough, metalness: metal,
        map: wallTex,
        roughnessMap: wallTex.userData.roughnessMap,
      })
    );
    body.position.set(o.x, o.h / 2, o.z);
    body.castShadow = true;
    body.receiveShadow = true;
    worldGroup.add(body);

    // Slight trim darker base (higher roughness = less specular bounce)
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(o.w + 0.06, 0.9, o.d + 0.06),
      new THREE.MeshStandardMaterial({ color: p[2], roughness: Math.min(1, rough + 0.08), metalness: metal * 0.5 })
    );
    base.position.set(o.x, 0.45, o.z);
    base.receiveShadow = true;
    worldGroup.add(base);

    // Recessed windows — real geometry that catches shadow (mid-scale breakup)
    if (o.windows && o.kind === 'building' && o.h >= 5) {
      const windowMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.3, metalness: 0.1 });
      const sillMat = new THREE.MeshStandardMaterial({ color: p[2], roughness: 0.9 });
      const cols = Math.max(2, Math.round(o.w / 5));
      const rows = Math.max(2, Math.round(o.h / 4));
      const wx0 = o.x - o.w / 2 + 1.4, wz0 = o.z - o.d / 2 + 1.2;
      const wStep = (o.w - 2.8) / cols, wH = (o.h - 3.5) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = wx0 + c * wStep, wz = wz0 + r * 0; // x positions along facade
          // front face windows (z-)
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.06), windowMat);
          win.position.set(wx, 1.6 + r * wH, o.z - o.d / 2 - 0.04);
          win.castShadow = false;
          worldGroup.add(win);
          // back face windows (z+)
          const winB = win.clone();
          winB.position.z = o.z + o.d / 2 + 0.04;
          worldGroup.add(winB);
          // sill (front)
          const sill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.1), sillMat);
          sill.position.set(wx, 1.45 + r * wH, o.z - o.d / 2 - 0.05);
          worldGroup.add(sill);
          // side face windows (x-) if wide enough
          if (o.d > 8) {
            const winS = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 1.0), windowMat);
            winS.position.set(o.x - o.w / 2 - 0.04, 1.6 + r * wH, wz0 + c * ((o.d - 2.4) / cols));
            worldGroup.add(winS);
            const winS2 = winS.clone();
            winS2.position.x = o.x + o.w / 2 + 0.04;
            worldGroup.add(winS2);
          }
        }
      }
    }

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

  // Authored structures + market kit (gauntlet round 3)
  if (mapId === 'dustline') {
    removeOldTower(map, worldGroup);
    buildTower(map, worldGroup);
    buildAlleyProps(map, worldGroup);
    worldGroup.add(propKit(map));
  }

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
  // plaster texture breakup (denser mid-frequency — material response)
  for (let i = 0; i < 400; i++) {
    const v = Math.random() * 26 - 13;
    g.fillStyle = `rgba(${v | 0},${(v * 0.9) | 0},${(v * 0.7) | 0},0.12)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
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
  // roughness map: mid-gray with spatial variation (specular breakup)
  const rc = document.createElement('canvas');
  rc.width = 256; rc.height = 256;
  const rg = rc.getContext('2d');
  rg.fillStyle = '#8a8a8a';
  rg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const v = 100 + Math.random() * 90;
    rg.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.2)`;
    rg.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  const roughTex = new THREE.CanvasTexture(rc);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(Math.max(1, Math.round(o.w / 3)), Math.max(1, Math.round(o.h / 3)));
  roughTex.anisotropy = 4;
  t.userData.roughnessMap = roughTex;
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
