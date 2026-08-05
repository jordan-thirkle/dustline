// DUSTLINE client networking — WebSocket to authoritative server, input send,
// state interpolation for remote players, and local prediction of the player.
import { MSG, pack, parse, INPUT_RATE, SERVER_PORT, TEAMS } from '../shared/protocol.js';
import { integratePlayer, STANCE, eyeHeight } from '../shared/movement.js';
import { WEAPONS } from '../shared/weapons.js';
import { damp, lerp, angleLerp } from '../shared/math.js';

export function createNet({ url, onWelcome, onState, onEvent, onKillfeed, onScore, onXp, onMatchEnd, onRoom, onChat, onDamage, onHit, onError, onStatus }) {
  const net = {
    ws: null,
    playerId: null,
    connected: false,
    inputSeq: 0,
    inputs: [],   // unacknowledged inputs
    lastInput: defaultInput(),
    send(t, d) { if (this.ws && this.ws.readyState === 1) this.ws.send(pack(t, d)); },
    connect(name, deviceId, loadout, joinOpts = {}) {
      return new Promise((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.hostname}:${SERVER_PORT}`);
        this.ws = ws;
        onStatus && onStatus('connecting');
        ws.onopen = () => {
          this.connected = true;
          this.send(MSG.HELLO, { name, deviceId, loadout });
          // Join immediately — server matchmakes + starts match, then sends WELCOME
          this.send(MSG.JOIN, joinOpts);
          onStatus && onStatus('online');
          resolve();
        };
        ws.onmessage = (e) => {
          const m = parse(e.data);
          if (!m) return;
          switch (m.t) {
            case MSG.WELCOME:
              this.playerId = m.d.playerId;
              onWelcome && onWelcome(m.d);
              onStatus && onStatus('online');
              resolve(m.d);
              break;
            case MSG.STATE: onState && onState(m.d); break;
            case MSG.EVENT: onEvent && onEvent(m.d); break;
            case MSG.KILLFEED: onKillfeed && onKillfeed(m.d); break;
            case MSG.SCORE: onScore && onScore(m.d); break;
            case MSG.XP: onXp && onXp(m.d); break;
            case MSG.MATCH_END: onMatchEnd && onMatchEnd(m.d); break;
            case MSG.ROOM: onRoom && onRoom(m.d); break;
            case MSG.CHAT_SRV: onChat && onChat(m.d); break;
            case MSG.DAMAGE: onDamage && onDamage(m.d); break;
            case MSG.HIT: onHit && onHit(m.d); break;
            case MSG.ERROR: onError && onError(m.d); break;
            case MSG.PONG: /* rtt calc handled in loop */ break;
            default: break;
          }
        };
        ws.onclose = () => { this.connected = false; onStatus && onStatus('offline'); };
        ws.onerror = (err) => { onError && onError({ msg: 'net_error' }); };
      });
    },
    join(code) { this.send(MSG.JOIN, { code }); },
    setLoadout(l) { this.send(MSG.LOADOUT, { loadout: l }); },
    chat(text) { this.send(MSG.CHAT, { text }); },
    ping() { this.send(MSG.PING, { t: performance.now() }); },
    sendInput() {
      const i = this.lastInput;
      i.seq = ++this.inputSeq;
      i.t = performance.now();
      this.inputs.push({ seq: i.seq, t: i.t });
      if (this.inputs.length > 40) this.inputs.shift();
      this.send(MSG.INPUT, i);
    },
    disconnect() { if (this.ws) this.ws.close(); },
  };
  return net;
}

export function defaultInput() {
  return {
    seq: 0, t: 0, mx: 0, mz: 0, yaw: 0, pitch: 0,
    sprint: false, jump: false, crouch: false, slide: false,
    fire: false, ads: false, reload: false, melee: false,
    weapon: 'm4', grenade: false, stim: false,
  };
}

// --- local player prediction ---
// We keep our own authoritative-feeling copy of the local player and integrate
// inputs each frame; server state corrects minor drift via soft snap.
export function createLocalPlayer(world) {
  return {
    id: null,
    name: 'OPERATIVE',
    team: TEAMS.NONE,
    pos: [0, 1.62, 0],
    vel: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    stance: STANCE.STAND,
    slideT: 0,
    grounded: true,
    sprint: 0,
    moveMult: 1,
    hp: 100,
    ap: 50,
    alive: true,
    weapon: 'm4',
    weapons: { primary: 'm4', secondary: 'pistol' },
    ammo: {},
    ads: false,
    firing: false,
    fireT: 0,
    reloadT: 0,
    reloading: false,
    meleeT: 0,
    grenadeT: 0,
    lastFireSeq: 0,
    world,
  };
}

export function resetLocalWeapon(local, wId) {
  const w = WEAPONS[wId];
  local.weapon = wId;
  if (w) {
    local.ammo[wId] = { mag: w.mag, reserve: w.reserve };
  }
}

export function predictLocal(local, input, dt) {
  // stance/slide from input handled in integratePlayer via slide flag
  const world = local.world;
  local.yaw = input.yaw;
  local.pitch = input.pitch;
  const before = [local.pos[0], local.pos[1], local.pos[2]];
  integratePlayer(local, input, dt, world);
  return { moved: (local.pos[0] !== before[0] || local.pos[2] !== before[2]), grounded: local.grounded };
}

// Interpolate a remote snapshot toward a target over network latency.
export function createInterp(snapshots, lerpTime = 0.09) {
  return { snapshots, lerpTime, current: null };
}
