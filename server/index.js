// DUSTLINE server entry — HTTP + WebSocket, room registry, persistence,
// input routing, chat, heartbeat. Run: node server/index.js
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { MSG, pack, parse, SERVER_PORT, TICK_RATE, TEAMS, makeRoomCode } from '../shared/protocol.js';
import { RoomRegistry } from './rooms.js';
import { Persistence } from './persistence.js';
import { levelFromXp, UNLOCKS, newStats } from '../shared/progression.js';

const TICK_MS = 1000 / TICK_RATE;
const PING_INTERVAL = 5000;

export function createServer({ port = SERVER_PORT, server: providedServer = null, wss: providedWss = null } = {}) {
  const registry = new RoomRegistry();
  const persistence = new Persistence();
  const clients = new Map(); // ws -> { id, deviceId, name, room, acc, ping }

  const httpServer = providedServer || http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'dustline-server', ok: true }));
  });

  const wss = providedWss || new WebSocketServer({ server: httpServer, path: '/' });
  let ownsListener = !providedServer;

  wss.on('connection', (ws) => {
    const client = { ws, id: null, deviceId: null, name: null, room: null, acc: null, ping: 0, lastPing: 0 };
    clients.set(ws, client);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      const m = parse(raw.toString());
      if (!m || !m.t) return;
      ws.isAlive = true;
      handleMessage(client, m);
    });

    ws.on('close', () => {
      if (client.room) {
        client.room.removePlayer(client.id);
      }
      clients.delete(ws);
    });
  });

  function handleMessage(client, m) {
    switch (m.t) {
      case MSG.HELLO: {
        const { name, deviceId, loadout } = m.d || {};
        const acc = persistence.getOrCreate(deviceId || 'anon-' + Math.random().toString(36).slice(2), name);
        client.id = acc.deviceId;
        client.deviceId = acc.deviceId;
        client.name = acc.name;
        client.acc = acc;
        if (loadout) persistence.setLoadout(client.deviceId, loadout);
        // Welcome/ack happens on JOIN -> match start
        break;
      }
      case MSG.JOIN: {
        if (!client.id) return;
        const { code, mode, map } = m.d || {};
        let room = code ? registry.findByCode(code) : null;
        if (!room) room = registry.findOrCreate(mode || 'tdm', map || 'dustline');
        // leave current
        if (client.room) client.room.removePlayer(client.id);
        const player = makePlayer(client, room);
        client.room = room;
        room.addHuman(player);
        wsSend(client, MSG.ROOM, room.roomState());
        break;
      }
      case MSG.INPUT: {
        if (!client.room || !client.id) return;
        const p = client.room.players.get(client.id);
        if (p && !p.isBot) {
          p.input = {
            ...m.d,
            yaw: clampRad(m.d.yaw),
            pitch: clamp(m.d.pitch, -1.5, 1.5),
          };
        }
        break;
      }
      case MSG.LOADOUT: {
        if (client.deviceId && m.d) persistence.setLoadout(client.deviceId, m.d.loadout || m.d);
        break;
      }
      case MSG.CHAT: {
        const text = String(m.d?.text || '').slice(0, 140);
        if (!text || !client.room) return;
        const msg = { t: MSG.CHAT_SRV, d: { from: client.name, text } };
        client.room.broadcastToAll(MSG.CHAT_SRV, msg.d);
        break;
      }
      case MSG.PING: {
        wsSend(client, MSG.PONG, { t: m.d?.t });
        break;
      }
      case MSG.LEAVE: {
        if (client.room) client.room.removePlayer(client.id);
        client.room = null;
        break;
      }
      default: break;
    }
  }

  function makePlayer(client, room) {
    const acc = client.acc;
    return {
      id: client.id,
      name: client.name,
      ws: client.ws,
      deviceId: client.deviceId,
      loadout: acc ? { ...acc.loadout } : { primary: 'm4', secondary: 'pistol' },
      totalXp: acc ? acc.totalXp : 0,
      stats: acc ? acc.stats : newStats(),
      perks: acc && acc.loadout && acc.loadout.perks ? acc.loadout.perks : { flak: true },
      ready: false,
    };
  }

  // game sim player-bound messages routed back to ws
  // (Room.sendTo uses p.ws; bots have no ws)

  // heartbeat
  const heartbeatInterval = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      ws.isAlive = false;
      ws.ping();
      client.lastPing = Date.now();
    }
  }, PING_INTERVAL);
  heartbeatInterval.unref?.();

  // main tick loop
  const tickInterval = setInterval(() => {
    const dt = 1 / TICK_RATE;
    registry.tickAll(dt);
  }, TICK_MS);

  if (ownsListener) {
    httpServer.listen(port, () => {
      console.log(`DUSTLINE server on :${port} (ws) — tick ${TICK_RATE}Hz`);
    });
  }

  return {
    httpServer, wss, registry, persistence,
    close() {
      clearInterval(tickInterval);
      clearInterval(heartbeatInterval);
      persistence.close();
      if (ownsListener) {
        wss.close();
        httpServer.close();
      }
    },
  };
}

function wsSend(client, t, d) {
  if (client.ws && client.ws.readyState === 1) client.ws.send(pack(t, d));
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function clampRad(v) {
  let x = v % (Math.PI * 2);
  if (x < -Math.PI) x += Math.PI * 2;
  if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

// Allow running directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  createServer();
}
