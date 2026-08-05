// DUSTLINE wire protocol — JSON-framed messages over WebSocket.
// Every message: { t: <type>, d: <data> }
// Shared so server and client can never drift.

export const TICK_RATE = 30;          // server simulation + broadcast rate
export const INPUT_RATE = 30;         // client input send rate
export const SERVER_PORT = 3000;

export const MSG = {
  // client -> server
  HELLO: 'hello',        // { name, deviceId, loadout }
  INPUT: 'input',        // { seq, t, mx, mz, yaw, pitch, sprint, jump, crouch, slide, fire, ads, reload, melee, weapon, grenade, stim }
  CHAT: 'chat',          // { text }
  LOADOUT: 'loadout',    // { loadout }
  JOIN: 'join',          // { code? } -> matchmake or join room by code
  LEAVE: 'leave',
  PING: 'ping',          // { t }
  LOGIN: 'login',        // { username, password } -> { ok, token, account } or { ok:false, msg }
  SIGNUP: 'signup',      // { username, password } -> create account
  LOGOUT: 'logout',      // { token }
  SESSION: 'session',    // { token } -> validate + attach

  // server -> client
  WELCOME: 'welcome',    // { playerId, serverTime, room, map, mode, tickRate, teams? }
  STATE: 'state',        // { seq, t, players: {...}, entities: [...], events: [...], scores, timeLeft, mode, flags, xp?, ... }
  SPAWN: 'spawn',        // { id, pos, hp, ap, weapon }
  HIT: 'hit',            // { target, dmg, x, y, z, headshot, killer }   (to the shooter)
  DAMAGE: 'damage',      // { dmg, x, y, z, from }                       (to the victim)
  KILLFEED: 'killfeed',  // { killer, victim, weapon, headshot, killerTeam, victimTeam, time }
  EVENT: 'event',        // { type, ... }  (explosion, capture, tagDrop, confirm, deny, uav, smoke)
  SCORE: 'score',        // { id, delta, reason, x, y, z }  (score popup)
  XP: 'xp',              // { gained, breakdown, level, before, xpInLevel, xpForNext, unlocks: [...] , prestige? }
  MATCH_END: 'matchEnd', // { winner, scores, mvp, mode, map, stats: {...} }
  ROOM: 'room',          // { code, players: [{id,name,team,ready,isBot}], max, mode, map, state }
  PONG: 'pong',          // { t }
  CHAT_SRV: 'chatSrv',   // { from, text, team? }
  ERROR: 'error',        // { msg }
  KICKED: 'kicked',      // { reason }
  AUTH: 'auth',          // { ok, token?, account?, msg? }
};

export const pack = (t, d) => JSON.stringify({ t, d });
export const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

export const TEAMS = { NONE: 0, TAN: 1, GREEN: 2 };
export const TEAM_NAMES = { 0: '—', 1: 'JACKALS', 2: 'VIPERS' };

export function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}
