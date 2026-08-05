// DUSTLINE account persistence — Postgres-backed when DATABASE_URL is set,
// otherwise falls back to an atomic-write JSON file store (local dev).
// Account shape is shared with client/progression.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newStats, levelFromXp } from '../shared/progression.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const FILE = join(DATA_DIR, 'accounts.json');

export class Persistence {
  constructor({ pool = null } = {}) {
    this.pool = pool;
    this.accounts = new Map();
    this.dirty = false;
    this.saveInterval = setInterval(() => this.save(), 5000);
    this.saveInterval.unref?.();
    this.load();
  }

  isPg() { return !!this.pool; }

  load() {
    if (this.isPg()) return;
    try {
      if (existsSync(FILE)) {
        const raw = readFileSync(FILE, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) this.accounts.set(k, v);
      }
    } catch (e) {
      console.error('[persistence] load failed', e.message);
    }
  }

  close() {
    clearInterval(this.saveInterval);
    this.save();
  }

  save() {
    if (this.isPg()) return;
    if (!this.dirty) return;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const obj = {};
      for (const [k, v] of this.accounts) obj[k] = v;
      writeFileSync(FILE, JSON.stringify(obj, null, 2));
      this.dirty = false;
    } catch (e) {
      console.error('[persistence] save failed', e.message);
    }
  }

  async getOrCreate(deviceId, name) {
    if (this.isPg()) {
      const pg = await import('./pgstore.js');
      let acc = await pg.getAccount(this.pool, deviceId);
      if (!acc) {
        acc = await pg.createAccount(this.pool, { deviceId, name });
      } else if (name && name !== acc.name) {
        await pg.createAccount(this.pool, { deviceId, name });
        acc.name = name.slice(0, 16);
      }
      return acc;
    }
    let acc = this.accounts.get(deviceId);
    if (!acc) {
      acc = {
        deviceId, name: name || 'OPERATIVE', totalXp: 0, stats: newStats(),
        loadout: { primary: 'm4', secondary: 'pistol' },
        unlockedWeapons: ['m4', 'pistol', 'knife'],
        prestige: 0, lastSeen: Date.now(),
      };
      this.accounts.set(deviceId, acc);
      this.dirty = true;
    } else {
      acc.lastSeen = Date.now();
      if (name && name !== acc.name) acc.name = name.slice(0, 16);
      this.dirty = true;
    }
    return acc;
  }

  async touch(deviceId) {
    if (this.isPg()) {
      await import('./pgstore.js').then((m) => m.touchAccount(this.pool, deviceId));
      return;
    }
    const acc = this.accounts.get(deviceId);
    if (acc) { acc.lastSeen = Date.now(); this.dirty = true; }
  }

  // Merge end-of-match stats + xp into account. Returns updated account.
  async applyMatchResult(deviceId, { kills, deaths, assists, won, score, xp }) {
    if (this.isPg()) {
      return await import('./pgstore.js').then((m) => m.applyMatchResultToAccount(this.pool, deviceId, { kills, deaths, assists, won, score, xp }));
    }
    const acc = await this.getOrCreate(deviceId, 'OPERATIVE');
    const s = acc.stats;
    s.kills += kills; s.deaths += deaths; s.assists += assists;
    s.score += score; s.games++;
    if (won) s.wins++; else s.losses++;
    if (s.kills > s.bestStreak) s.bestStreak = Math.max(s.bestStreak, kills);
    acc.totalXp += xp;
    // unlock weapons by level
    const lvl = levelFromXp(acc.totalXp);
    const all = { m4: 1, pistol: 1, knife: 1, mp5: 3, shotgun: 5, ak: 8, m249: 12, sniper: 16 };
    for (const [w, l] of Object.entries(all)) {
      if (lvl >= l && !acc.unlockedWeapons.includes(w)) acc.unlockedWeapons.push(w);
    }
    this.dirty = true;
    return acc;
  }

  async setLoadout(deviceId, loadout) {
    if (this.isPg()) {
      await import('./pgstore.js').then((m) => m.saveLoadout(this.pool, deviceId, loadout));
      return null;
    }
    const acc = await this.getOrCreate(deviceId, 'OPERATIVE');
    if (loadout) {
      acc.loadout = { primary: loadout.primary || acc.loadout.primary, secondary: loadout.secondary || acc.loadout.secondary };
      this.dirty = true;
    }
    return acc;
  }

  // ---- auth (username/password + sessions) ----
  async getAccountByName(username) {
    if (this.isPg()) {
      return await import('./pgstore.js').then((m) => m.getAccountByName(this.pool, username));
    }
    const lower = (username || '').toLowerCase();
    for (const acc of this.accounts.values()) {
      if (acc.username && acc.username.toLowerCase() === lower) return acc;
    }
    return null;
  }

  async setAccountCredentials(deviceId, username, passwordHash) {
    if (this.isPg()) {
      const pg = await import('./pgstore.js');
      await pg.setPassword(this.pool, deviceId, passwordHash);
      await this.pool.query('UPDATE accounts SET username = $2 WHERE device_id = $1', [deviceId, username]);
      const acc = await pg.getAccount(this.pool, deviceId);
      if (acc) acc.username = username;
      return acc;
    }
    const acc = await this.getOrCreate(deviceId, username);
    acc.username = username;
    acc.passwordHash = passwordHash;
    this.dirty = true;
    return acc;
  }

  async createSession(deviceId, token, ttlMs) {
    if (this.isPg()) {
      await import('./pgstore.js').then((m) => m.createSession(this.pool, deviceId, token, ttlMs));
      return;
    }
    if (!this.sessions) this.sessions = new Map();
    this.sessions.set(token, { token, deviceId, expiresAt: Date.now() + ttlMs });
    this.dirty = true;
  }

  async getSession(token) {
    if (this.isPg()) {
      return await import('./pgstore.js').then((m) => m.getSession(this.pool, token));
    }
    const s = this.sessions?.get(token);
    if (s && s.expiresAt > Date.now()) return s;
    if (s) this.sessions.delete(token);
    return null;
  }

  async deleteSession(token) {
    if (this.isPg()) {
      await import('./pgstore.js').then((m) => m.deleteSession(this.pool, token));
      return;
    }
    this.sessions?.delete(token);
    this.dirty = true;
  }
}
