// DUSTLINE map data — shared by server (collision AABBs, spawns) and
// client (builds meshes from the same objects). One source of truth.

// Ground is flat at y=0. Everything else is a solid AABB.
// kind drives client visuals; server only needs x/z/w/d/h.

export const MAPS_DATA = {
  dustline: {
    id: 'dustline',
    name: 'DUSTLINE',
    bounds: [-62, -62, 62, 62],
    light: { sky: [0.62, 0.56, 0.47], sun: [1.0, 0.9, 0.75], sunIntensity: 1.35, ambient: [0.5, 0.47, 0.4], fog: [0.66, 0.6, 0.51], fogNear: 70, fogFar: 190 },
    dust: 0.35, // heat-haze / dust density
    objects: [
      // ---- perimeter buildings ----
      { kind: 'building', x: -46, z: -46, w: 26, d: 26, h: 9, palette: 0, windows: true, roof: 'flat' },
      { kind: 'building', x: -46, z: 46, w: 26, d: 26, h: 9, palette: 1, windows: true, roof: 'shed' },
      { kind: 'building', x: 46, z: -46, w: 26, d: 26, h: 9, palette: 1, windows: true, roof: 'flat' },
      { kind: 'building', x: 46, z: 46, w: 26, d: 26, h: 9, palette: 0, windows: true, roof: 'shed' },
      // ---- mid-ring structures ----
      { kind: 'building', x: -18, z: -54, w: 22, d: 9, h: 6.5, palette: 2, windows: true, roof: 'flat' },
      { kind: 'building', x: 8, z: -54, w: 26, d: 9, h: 7.5, palette: 0, windows: true, roof: 'shed' },
      { kind: 'building', x: 34, z: -52, w: 16, d: 9, h: 8, palette: 1, windows: true, roof: 'flat' },
      { kind: 'building', x: -54, z: -6, w: 9, d: 22, h: 8, palette: 1, windows: true, roof: 'shed' },
      { kind: 'building', x: 54, z: -6, w: 9, d: 22, h: 8, palette: 2, windows: true, roof: 'flat' },
      { kind: 'building', x: -24, z: 54, w: 22, d: 9, h: 7, palette: 2, windows: true, roof: 'flat' },
      { kind: 'building', x: 12, z: 54, w: 26, d: 9, h: 9, palette: 0, windows: true, roof: 'shed' },
      // watchtower (solid vantage)
      { kind: 'tower', x: -38, z: 40, w: 7, d: 7, h: 13, palette: 3, windows: false, roof: 'flat' },
      // ---- central plaza cover ----
      { kind: 'wall', x: 0, z: -12, w: 7, d: 1.4, h: 1.8, palette: 4 },
      { kind: 'wall', x: -9, z: 2, w: 8, d: 1.4, h: 1.4, palette: 4 },
      { kind: 'wall', x: 11, z: 10, w: 6, d: 1.4, h: 1.8, palette: 5 },
      { kind: 'wall', x: -4, z: 26, w: 6, d: 1.2, h: 1.5, palette: 5 },
      { kind: 'wall', x: 24, z: -26, w: 5, d: 1.2, h: 1.7, palette: 4 },
      { kind: 'wall', x: -30, z: 24, w: 1.2, d: 6, h: 1.7, palette: 5 },
      { kind: 'wall', x: -16, z: -30, w: 6, d: 1.2, h: 1.5, palette: 4 },
      { kind: 'wall', x: 30, z: 32, w: 1.2, d: 6, h: 1.6, palette: 5 },
      { kind: 'crate', x: -13, z: 13, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: 15, z: -15, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: -22, z: -18, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'crate', x: 22, z: 6, w: 3, d: 3, h: 2.4, palette: 7 },
      { kind: 'crate', x: 3, z: 34, w: 3.4, d: 3.4, h: 2.2, palette: 6 },
      { kind: 'crate', x: -34, z: -10, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'crate', x: 40, z: -30, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: -42, z: 22, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'wall', x: 2, z: -40, w: 5, d: 1.2, h: 1.6, palette: 4 },
      { kind: 'wall', x: -2, z: 44, w: 5, d: 1.2, h: 1.6, palette: 5 },
      { kind: 'crate', x: 36, z: 12, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: -28, z: -36, w: 3.4, d: 3.4, h: 2.2, palette: 7 },
      { kind: 'wall', x: 18, z: 30, w: 1.2, d: 5, h: 1.5, palette: 5 },
      { kind: 'wall', x: -20, z: -44, w: 5, d: 1.2, h: 1.5, palette: 4 },
    ],
    spawns: {
      tan: [
        [-52, -20], [-46, 4], [-52, 22], [-28, -44], [-8, -42], [-46, -12], [-30, -18], [-38, 14],
      ],
      green: [
        [52, 20], [46, -4], [52, -22], [28, 44], [8, 42], [46, 12], [30, 18], [38, -14],
      ],
      ffa: [
        [-52, -20], [52, 20], [-52, 22], [52, -22], [-28, -44], [28, 44], [-8, -42], [8, 42],
        [-46, 4], [46, -4], [-38, -14], [38, 14], [-30, 18], [30, -18], [-46, -12], [46, 12],
      ],
    },
    domFlags: { A: [-18, 18], B: [0, 0], C: [20, -20] },
    snd: {
      sites: { A: [-8, -8], B: [10, 10] },
    },
  },

  outpost: {
    id: 'outpost',
    name: 'OUTPOST',
    bounds: [-65, -65, 65, 65],
    light: { sky: [0.66, 0.6, 0.52], sun: [1.0, 0.88, 0.7], sunIntensity: 1.4, ambient: [0.46, 0.42, 0.36], fog: [0.72, 0.66, 0.58], fogNear: 80, fogFar: 210 },
    dust: 0.42,
    objects: [
      { kind: 'building', x: 0, z: -58, w: 60, d: 12, h: 7, palette: 2, windows: true, roof: 'flat' },
      { kind: 'building', x: -58, z: 0, w: 12, d: 60, h: 7, palette: 0, windows: true, roof: 'shed' },
      { kind: 'building', x: 58, z: 0, w: 12, d: 60, h: 7, palette: 1, windows: true, roof: 'flat' },
      { kind: 'building', x: 0, z: 58, w: 60, d: 12, h: 7, palette: 0, windows: true, roof: 'shed' },
      { kind: 'tower', x: -40, z: -40, w: 8, d: 8, h: 14, palette: 3, windows: false, roof: 'flat' },
      { kind: 'tower', x: 40, z: 40, w: 8, d: 8, h: 14, palette: 3, windows: false, roof: 'flat' },
      { kind: 'building', x: 0, z: 0, w: 14, d: 14, h: 5, palette: 2, windows: true, roof: 'flat' },
      { kind: 'wall', x: -24, z: -20, w: 10, d: 1.4, h: 1.7, palette: 4 },
      { kind: 'wall', x: 24, z: 20, w: 10, d: 1.4, h: 1.7, palette: 5 },
      { kind: 'wall', x: -20, z: 24, w: 1.4, d: 10, h: 1.7, palette: 5 },
      { kind: 'wall', x: 20, z: -24, w: 1.4, d: 10, h: 1.7, palette: 4 },
      { kind: 'crate', x: -10, z: -6, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: 10, z: 6, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'crate', x: -30, z: 10, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'crate', x: 30, z: -10, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: -6, z: 30, w: 3, d: 3, h: 2.2, palette: 6 },
      { kind: 'crate', x: 6, z: -30, w: 3, d: 3, h: 2.2, palette: 7 },
      { kind: 'wall', x: -44, z: 20, w: 6, d: 1.2, h: 1.6, palette: 4 },
      { kind: 'wall', x: 44, z: -20, w: 6, d: 1.2, h: 1.6, palette: 5 },
    ],
    spawns: {
      tan: [[-52, -30], [-52, 6], [-40, -30], [-52, -44], [-20, -44], [-40, 14], [-12, -52], [-30, 22]],
      green: [[52, 30], [52, -6], [40, 30], [52, 44], [20, 44], [40, -14], [12, 52], [30, -22]],
      ffa: [[-52, -30], [52, 30], [-52, 30], [52, -30], [-40, -30], [40, 30], [-40, 14], [40, -14], [-20, -44], [20, 44], [-12, -52], [12, 52], [-30, 22], [30, -22]],
    },
    domFlags: { A: [-24, -24], B: [0, 0], C: [24, 24] },
    snd: { sites: { A: [-12, -12], B: [12, 12] } },
  },
};

// Build the AABB list the server physics + client prediction use.
// Each collider: [centerX, centerZ, halfWidth, halfDepth, height]
export function aabbs(mapData) {
  return mapData.objects.map(o => [o.x, o.z, o.w / 2, o.d / 2, o.h]);
}

export function spawnYaw(x, z, center = [0, 0]) {
  const dx = center[0] - x, dz = center[1] - z;
  return Math.atan2(dx, -dz); // yaw convention: forward = (sin, -cos)
}

export function mapById(id) { return MAPS_DATA[id] || MAPS_DATA.dustline; }
