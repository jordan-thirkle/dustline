// DUSTLINE room/match lifecycle — create rooms, fill with bots, run match
// states (warmup -> active -> ended -> restart), broadcast to clients.
import { GameSim } from './game.js';
import { MSG, TEAMS, makeRoomCode } from '../shared/protocol.js';
import { modeById, DEFAULT_MODE, DEFAULT_MAP, MIN_BOTS } from '../shared/modes.js';
import { mapById, aabbs } from '../shared/map.js';
import { mulberry32 } from '../shared/math.js';
import { WEAPONS } from '../shared/weapons.js';
import { UNLOCKS, levelFromXp } from '../shared/progression.js';

const BOT_NAMES = [
  'Rex-77', 'Viper-2', 'Ghost-5', 'Sable', 'Kestrel', 'Onyx-9', 'Falcon-1',
  'Mongoose', 'Bandit-3', 'Coyote', 'Ranger-8', 'Dagger', 'Havoc-4', 'Ember',
  'Wraith-6', 'Cinder', 'Jackal-2', 'Bronco', 'Slate-1', 'Puma',
];

export class Room {
  constructor({ id, code, mode, map, maxPlayers, persistence = null }) {
    this.id = id;
    this.code = code || makeRoomCode();
    this.mode = mode || DEFAULT_MODE;
    this.map = map || DEFAULT_MAP;
    this.maxPlayers = maxPlayers || 12;
    this.persistence = persistence;
    this.players = new Map();  // id -> player
    this.state = 'lobby';
    this.sim = null;
    this.tickCount = 0;
    this.warmup = 12;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.lastBroadcast = 0;
    this.broadcastQueue = [];
  }

  getPlayerCount() { return this.players.size; }

  addHuman(p) {
    p.room = this;
    p.team = TEAMS.NONE;
    this.players.set(p.id, p);
    this.fillBots();          // fill to MIN_BOTS immediately so matches can start solo
    this.balanceTeams();
    this.tryStart();
  }

  addBot() {
    const id = 'bot-' + this.rng().toString(36).slice(2, 8);
    const p = {
      id,
      name: BOT_NAMES[(this.rng() * BOT_NAMES.length) | 0],
      team: TEAMS.NONE,
      isBot: true,
      loadout: this.randomBotLoadout(),
      totalXp: (this.rng() * 20000) | 0,
      perks: { flak: true },
      stats: { kills: 0, deaths: 0, assists: 0 },
      room: this,
      alive: false,
    };
    this.players.set(id, p);
    return p;
  }

  randomBotLoadout() {
    const primaries = ['m4', 'ak', 'mp5', 'shotgun', 'm249', 'sniper'];
    return { primary: primaries[(this.rng() * primaries.length) | 0], secondary: 'pistol' };
  }

  balanceTeams() {
    let t = 0, g = 0;
    for (const p of this.players.values()) {
      if (p.team === TEAMS.TAN) t++;
      else if (p.team === TEAMS.GREEN) g++;
    }
    for (const p of this.players.values()) {
      if (p.team === TEAMS.NONE) {
        p.team = t <= g ? TEAMS.TAN : TEAMS.GREEN;
        if (p.team === TEAMS.TAN) t++; else g++;
      }
    }
  }

  tryStart() {
    if (this.state === 'lobby' && this.players.size >= 2) {
      this.state = 'warmup';
      this.warmup = 8;
    }
  }

  // Fill with bots until MIN_BOTS simulated players
  fillBots() {
    let humans = 0;
    for (const p of this.players.values()) if (!p.isBot) humans++;
    while (this.players.size < Math.max(MIN_BOTS, humans + 1)) {
      this.addBot();
    }
  }

  startMatch() {
    this.fillBots();
    this.balanceTeams();
    this.sim = new GameSim({
      mode: this.mode,
      map: this.map,
      onBroadcast: (t, d) => this.broadcastToAll(t, d),
      onMessage: (playerId, t, d) => this.sendTo(playerId, t, d),
      onMatchEnd: async (results) => {
        for (const { player, won } of results) {
          if (player.isBot || !this.persistence) continue;
          try {
            await this.persistence.applyMatchResult(player.deviceId, {
              kills: player.kills || 0,
              deaths: player.deaths || 0,
              assists: player.assists || 0,
              won: !!won,
              score: player.score || 0,
              xp: player.matchXp || 0,
            });
          } catch (e) {
            console.error('[persistence] match result save failed for', player.deviceId, e.message);
          }
        }
      },
    });
    for (const p of this.players.values()) {
      p.alive = false;
      this.sim.addPlayer(p);
      p.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false, crouch: false, slide: false, fire: false, fireHeld: false, reload: false, melee: false, grenade: false, weapon: p.loadout.primary };
      // welcome info
      this.sendTo(p.id, MSG.WELCOME, {
        playerId: p.id, name: p.name, team: p.team,
        mode: this.mode, map: this.map,
        weapon: p.loadout.primary, loadout: p.loadout,
        tickRate: 30, serverTime: Date.now(),
      });
    }
    this.state = 'active';
    this.broadcastToAll(MSG.ROOM, this.roomState());
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.sim) this.sim.removePlayer(id);
    this.broadcastToAll(MSG.ROOM, this.roomState());
  }

  // ---------- tick ----------
  tick(dt) {
    this.tickCount++;
    if (this.state === 'warmup') {
      this.warmup -= dt;
      if (this.warmup <= 0) this.startMatch();
    } else if (this.state === 'active' && this.sim) {
      // route inputs from players to sim
      for (const p of this.players.values()) {
        if (p.input && !p.isBot) {
          p.simInput = p.input;
        }
      }
      this.sim.tickAll(dt);
      // broadcast state every tick
      this.broadcastState();
      // match end -> schedule restart
      if (this.sim.state === 'ended') {
        if (!this.endTimer) this.endTimer = 8;
        this.endTimer -= dt;
        if (this.endTimer <= 0) {
          this.endTimer = null;
          this.startMatch();
        }
      }
    } else if (this.state === 'lobby') {
      // ping bots alive
    }
  }

  broadcastState() {
    const sim = this.sim;
    if (!sim) return;
    const players = {};
    for (const p of this.players.values()) {
      players[p.id] = {
        id: p.id, name: p.name, team: p.team, isBot: !!p.isBot,
        pos: p.pos ? [p.pos[0], p.pos[1], p.pos[2]] : [0, 0, 0],
        vel: p.vel ? [p.vel[0], p.vel[1], p.vel[2]] : [0, 0, 0],
        yaw: p.yaw || 0, pitch: p.pitch || 0,
        hp: p.hp || 0, ap: p.ap || 0, alive: !!p.alive,
        stance: p.stance, weapon: p.weapon,
        ammo: p.ammo ? { mag: p.ammo[p.weapon]?.mag || 0, reserve: p.ammo[p.weapon]?.reserve || 0 } : { mag: 0, reserve: 0 },
        score: p.score || 0, kills: p.kills || 0, deaths: p.deaths || 0, assists: p.assists || 0,
        streak: p.streak || 0,
      };
    }
    const flags = Object.values(sim.flags || {}).map(f => ({ id: f.id, x: f.x, z: f.z, team: f.team }));
    const entities = sim.entities.filter(e => e.type === 'tag' || e.type === 'carepackage').map(e => ({
      type: e.type, id: e.id, x: e.x, y: e.y || 1, z: e.z, team: e.ownerTeam, owner: e.owner,
    }));
    const events = sim.events.splice(0, 12);
    const data = {
      seq: sim.tick, t: Date.now(), mode: this.mode, map: this.map,
      players, flags, entities, events,
      scores: sim.scores, timeLeft: Math.ceil(sim.timeLeft),
      state: sim.state, round: sim.round,
    };
    this.broadcastToAll(MSG.STATE, data);
  }

  // ---------- messaging ----------
  sendTo(playerId, t, d) {
    const p = this.players.get(playerId);
    if (p && !p.isBot && p.ws) {
      p.ws.send(JSON.stringify({ t, d }));
    }
  }

  broadcastToAll(t, d) {
    const msg = JSON.stringify({ t, d });
    for (const p of this.players.values()) {
      if (!p.isBot && p.ws && p.ws.readyState === 1) {
        p.ws.send(msg);
      }
    }
  }

  roomState() {
    return {
      code: this.code, mode: this.mode, map: this.map, state: this.state,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, isBot: !!p.isBot, ready: !!p.ready,
        level: levelFromXp(p.totalXp || 0),
      })),
      max: this.maxPlayers,
    };
  }
}

// Matchmaking registry
export class RoomRegistry {
  constructor() {
    this.rooms = new Map();
    this.idCounter = 1;
  }

  create(mode, map) {
    const id = 'room-' + this.idCounter++;
    const room = new Room({ id, mode, map, maxPlayers: 12, persistence: this.persistence });
    this.rooms.set(id, room);
    return room;
  }

  findOrCreate(mode, map) {
    for (const room of this.rooms.values()) {
      if (room.state !== 'active' && room.mode === mode && room.map === map && room.players.size < room.maxPlayers) {
        return room;
      }
    }
    return this.create(mode, map);
  }

  findByCode(code) {
    for (const room of this.rooms.values()) if (room.code === code) return room;
    return null;
  }

  remove(id) {
    this.rooms.delete(id);
  }

  tickAll(dt) {
    for (const room of this.rooms.values()) room.tick(dt);
    // prune empty rooms
    for (const [id, room] of this.rooms) {
      let humans = 0;
      for (const p of room.players.values()) if (!p.isBot) humans++;
      if (humans === 0 && room.tickCount > 30) this.remove(id);
    }
  }
}
