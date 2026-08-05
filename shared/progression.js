// DUSTLINE progression & XP — shared math for XP curve, levels, unlocks, prestige.
// Server persists accounts; client renders the same numbers.

export const BASE_XP = 100;
export const LEVEL_GROWTH = 1.35;
export const XP_PER_LEVEL = 40;   // tuned so early levels fly by

export function xpForLevel(level) {
  if (level <= 1) return 0;
  let sum = 0;
  for (let i = 1; i < level; i++) sum += Math.floor(BASE_XP * Math.pow(LEVEL_GROWTH, (i - 1) / 4));
  return sum;
}
export function xpForLevelAt(level) { return xpForLevel(level + 1) - xpForLevel(level); }
export function levelFromXp(totalXp) {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  return level;
}
export function xpIntoLevel(totalXp) { const l = levelFromXp(totalXp); return totalXp - xpForLevel(l); }
export function xpRemaining(totalXp) { return xpForLevelAt(levelFromXp(totalXp)); }

export const PRESTIGE_MAX = 3;
export const PRESTIGE_XP = 50000; // xp threshold to prestige (roughly level 55)

// XP events
export const XP = {
  KILL: 100, KILL_HEADSHOT: 150, ASSIST: 50, WIN: 250, LOSE: 100,
  CAPTURE: 100, DENY: 75, CONFIRM: 50, TAG_DROP: 25, PLANT: 150, DEFUSE: 150,
  FIRST_BLOOD: 100, MULTIKILL: 50, STREAK: 25, KILLSTREAK: 100,
  MATCH_BONUS: 25, CHALLENGE: 200,
};

// Unlock table: weapon id -> level unlocked (1 = default)
export const UNLOCKS = {
  m4: 1, pistol: 1, knife: 1, mp5: 3, shotgun: 5, ak: 8, m249: 12, sniper: 16,
};

export const LOADOUT_SLOTS = {
  primary: ['m4', 'ak', 'mp5', 'm249', 'shotgun', 'sniper'],
  secondary: ['pistol', 'knife'],
};

// Perk / streak definitions (dopamine systems)
export const PERKS = {
  flak: { id: 'flak', name: 'FLAK JACKET', desc: 'Take 25% less explosive damage', lvl: 1 },
  ghost: { id: 'ghost', name: 'GHOST', desc: 'Invisible to enemy UAV pings', lvl: 6 },
  dexterity: { id: 'dexterity', name: 'DEXTERITY', desc: '15% faster sprint-out & reload', lvl: 10 },
  tracker: { id: 'tracker', name: 'TRACKER', desc: 'Footsteps of wounded enemies glow', lvl: 14 },
};

export const KILLSTREAKS = [
  { id: 'uav', name: 'UAV', cost: 4, desc: 'Reveals enemies on minimap for 8s' },
  { id: 'carepackage', name: 'CARE PACKAGE', cost: 6, desc: 'Drops a random streak crate' },
  { id: 'napalm', name: 'NAPAKM STRIKE', cost: 8, desc: 'Burns a zone with an air strike' },
  { id: 'gunship', name: 'GUNSHIP', cost: 10, desc: 'Call in an autonomous support gun' },
];

// Stat tracking (dopamine loop)
export function newStats() {
  return { kills: 0, deaths: 0, assists: 0, headshots: 0, wins: 0, losses: 0, games: 0, score: 0, timePlayed: 0, bestStreak: 0 };
}

export function kd(stats) { return stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : stats.kills.toFixed(2); }
