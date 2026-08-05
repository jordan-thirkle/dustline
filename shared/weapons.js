// DUSTLINE weapon definitions — shared by server (damage model) and client (viewmodel, fx, HUD).
// Adding a weapon = adding one entry here. The viewmodel builder reads these params.

export const WEAPONS = {
  m4: {
    id: 'm4', name: 'M4A1 CARBINE', slot: 'primary', class: 'rifle',
    dmg: 34, dmgHead: 1.65, range: 95, falloff: 0.5,
    rpm: 780, auto: true, mag: 30, reserve: 120, reload: 2.1,
    adsSpeed: 0.26, hipSpread: 0.018, adsSpread: 0.0022,
    spreadPerShot: 0.0014, spreadRecover: 8, recoil: { up: 0.012, side: 0.006, kick: 0.05 },
    moveSpread: 0.012, sprintRecover: 0.35,
    pelletCount: 1, tracer: 1,
    viewmodel: { scale: 0.175, pos: [0.155, -0.165, -0.34], adsPos: [0, -0.148, -0.06] },
    fireSound: 'ar', vol: 0.9,
  },
  ak: {
    id: 'ak', name: 'AK-12 PATROL', slot: 'primary', class: 'rifle',
    dmg: 41, dmgHead: 1.6, range: 90, falloff: 0.55,
    rpm: 640, auto: true, mag: 30, reserve: 120, reload: 2.4,
    adsSpeed: 0.3, hipSpread: 0.022, adsSpread: 0.003,
    spreadPerShot: 0.0019, spreadRecover: 6.5, recoil: { up: 0.018, side: 0.008, kick: 0.075 },
    moveSpread: 0.013, sprintRecover: 0.4,
    pelletCount: 1, tracer: 1,
    viewmodel: { scale: 0.17, pos: [0.15, -0.16, -0.33], adsPos: [0, -0.146, -0.05] },
    fireSound: 'ak', vol: 1.0,
  },
  mp5: {
    id: 'mp5', name: 'MP5 SMG', slot: 'primary', class: 'smg',
    dmg: 27, dmgHead: 1.6, range: 55, falloff: 0.6,
    rpm: 900, auto: true, mag: 30, reserve: 120, reload: 1.9,
    adsSpeed: 0.22, hipSpread: 0.02, adsSpread: 0.003,
    spreadPerShot: 0.0012, spreadRecover: 9, recoil: { up: 0.008, side: 0.004, kick: 0.035 },
    moveSpread: 0.011, sprintRecover: 0.3,
    pelletCount: 1, tracer: 1,
    viewmodel: { scale: 0.16, pos: [0.16, -0.15, -0.32], adsPos: [0, -0.15, -0.05] },
    fireSound: 'smg', vol: 0.85,
  },
  m249: {
    id: 'm249', name: 'M249 SAW', slot: 'primary', class: 'lmg',
    dmg: 36, dmgHead: 1.55, range: 80, falloff: 0.5,
    rpm: 700, auto: true, mag: 75, reserve: 150, reload: 3.6,
    adsSpeed: 0.38, hipSpread: 0.03, adsSpread: 0.0045,
    spreadPerShot: 0.0018, spreadRecover: 5, recoil: { up: 0.014, side: 0.007, kick: 0.06 },
    moveSpread: 0.014, sprintRecover: 0.45,
    pelletCount: 1, tracer: 1,
    viewmodel: { scale: 0.175, pos: [0.148, -0.17, -0.36], adsPos: [0, -0.15, -0.06] },
    fireSound: 'lmg', vol: 1.05,
  },
  sniper: {
    id: 'sniper', name: 'TAC-50 BOLT', slot: 'primary', class: 'sniper',
    dmg: 145, dmgHead: 2.0, range: 400, falloff: 0,
    rpm: 45, auto: false, mag: 5, reserve: 25, reload: 3.1,
    adsSpeed: 0.5, hipSpread: 0.035, adsSpread: 0.0006,
    spreadPerShot: 0.0, spreadRecover: 0, recoil: { up: 0.05, side: 0.015, kick: 0.22 },
    moveSpread: 0.02, sprintRecover: 0.8,
    pelletCount: 1, tracer: 1.4,
    scope: { zoom: 4, fov: 20 },
    viewmodel: { scale: 0.19, pos: [0.14, -0.17, -0.38], adsPos: [0, -0.15, -0.08] },
    fireSound: 'sniper', vol: 1.2,
  },
  shotgun: {
    id: 'shotgun', name: 'M870 BREACHER', slot: 'primary', class: 'shotgun',
    dmg: 22, dmgHead: 1.3, range: 22, falloff: 0.85,
    rpm: 70, auto: false, mag: 6, reserve: 30, reload: 3.4,
    adsSpeed: 0.3, hipSpread: 0.03, adsSpread: 0.012,
    spreadPerShot: 0.0, spreadRecover: 0, recoil: { up: 0.035, side: 0.01, kick: 0.14 },
    moveSpread: 0.018, sprintRecover: 0.7,
    pelletCount: 8, tracer: 0.4,
    viewmodel: { scale: 0.17, pos: [0.16, -0.165, -0.34], adsPos: [0, -0.15, -0.06] },
    fireSound: 'shotgun', vol: 1.15,
  },
  pistol: {
    id: 'pistol', name: 'G19 SIDEARM', slot: 'secondary', class: 'pistol',
    dmg: 30, dmgHead: 1.7, range: 45, falloff: 0.5,
    rpm: 400, auto: false, mag: 12, reserve: 48, reload: 1.4,
    adsSpeed: 0.18, hipSpread: 0.014, adsSpread: 0.002,
    spreadPerShot: 0.0016, spreadRecover: 10, recoil: { up: 0.01, side: 0.005, kick: 0.04 },
    moveSpread: 0.01, sprintRecover: 0.3,
    pelletCount: 1, tracer: 1,
    viewmodel: { scale: 0.14, pos: [0.15, -0.15, -0.3], adsPos: [0, -0.148, -0.05] },
    fireSound: 'pistol', vol: 0.8,
  },
  knife: {
    id: 'knife', name: 'COMBAT KNIFE', slot: 'secondary', class: 'melee',
    dmg: 100, dmgHead: 1.0, range: 2.4, falloff: 0,
    rpm: 65, auto: false, mag: 0, reserve: 0, reload: 0,
    adsSpeed: 0.1, hipSpread: 0, adsSpread: 0,
    spreadPerShot: 0, spreadRecover: 0, recoil: { up: 0.03, side: 0, kick: 0.1 },
    moveSpread: 0, sprintRecover: 0,
    pelletCount: 1, tracer: 0,
    viewmodel: { scale: 0.15, pos: [0.14, -0.16, -0.3], adsPos: [0, -0.15, -0.05] },
    fireSound: 'knife', vol: 0.6,
  },
};

export const SECONDARY_DEFAULT = 'pistol';
export const KNIFE = 'knife';

export const DAMAGE_CATEGORY = {
  m4: 'rifle', ak: 'rifle', mp5: 'smg', m249: 'lmg', sniper: 'sniper', shotgun: 'shotgun', pistol: 'pistol', knife: 'melee',
};

export function weaponById(id) { return WEAPONS[id]; }

// Compute damage given distance (hitscan range falloff model).
export function damageAtRange(w, dist) {
  if (dist >= w.range) return w.dmg * (1 - w.falloff);
  return w.dmg * (1 - (dist / w.range) * w.falloff);
}

export function pelletsFor(w) { return w.pelletCount || 1; }

// Time between shots from rpm
export function shotInterval(w) { return 60 / w.rpm; }

// Round (display) name
export function magDisplay(w) { return w.mag; }
