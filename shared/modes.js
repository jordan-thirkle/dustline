// DUSTLINE game modes — shared definitions. Each mode carries its own
// win condition, scoring rules, and flow; the server reads these to drive
// match state, the client reads them for HUD copy + countdowns.

export const MODES = {
  tdm: {
    id: 'tdm', name: 'TEAM DEATHMATCH', short: 'TDM', duration: 300,
    scoreToWin: 100, respawn: true, teams: true, desc: 'First team to 100 kills wins.',
    flags: {},
  },
  dom: {
    id: 'dom', name: 'DOMINATION', short: 'DOM', duration: 300,
    scoreToWin: 200, respawn: true, teams: true, desc: 'Hold the flags. 200 points wins.',
    flags: { A: [-12, -10], B: [0, 0], C: [14, 12] },
  },
  kc: {
    id: 'kc', name: 'KILL CONFIRMED', short: 'KC', duration: 300,
    scoreToWin: 75, respawn: true, teams: true, desc: 'Grab enemy tags to score. 75 wins.',
    flags: { tags: true },
  },
  snd: {
    id: 'snd', name: 'SEARCH & DESTROY', short: 'SND', duration: 120,
    scoreToWin: 6, respawn: false, teams: true, desc: 'Plant or defuse. 6 rounds wins.',
    flags: { bomb: true, rounds: 6, roundTime: 120, plantTime: 4, defuseTime: 6 },
  },
  ffa: {
    id: 'ffa', name: 'FREE FOR ALL', short: 'FFA', duration: 300,
    scoreToWin: 30, respawn: true, teams: false, desc: 'Everyone for themselves. 30 kills wins.',
    flags: {},
  },
};

export const MODE_LIST = Object.keys(MODES);
export const DEFAULT_MODE = 'tdm';

export function modeById(id) { return MODES[id] || MODES[DEFAULT_MODE]; }

export const MAPS = {
  dustline: { id: 'dustline', name: 'DUSTLINE', desc: 'Sun-baked coastal town', size: [120, 120] },
  outpost: { id: 'outpost', name: 'OUTPOST', desc: 'Ridgeline supply depot', size: [130, 130] },
};

export const DEFAULT_MAP = 'dustline';
export const MAX_PLAYERS = 12;
export const MAX_ROOM_PLAYERS = 12;
export const MIN_BOTS = 8; // fill to at least this many simulated players
