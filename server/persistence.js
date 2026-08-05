// DUSTLINE account persistence — JSON file store. Accounts keyed by deviceId.
// No DB; a simple atomic-write JSON file keeps it deployable anywhere.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newStats, levelFromXp } from '../shared/progression.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const FILE = join(DATA_DIR, 'accounts.json');

export class Persistence {
  constructor() {
    this.accounts = new Map();
    this.dirty = false;
    this.saveInterval = setInterval(() => this.save(), 5000);
    this.saveInterval.unref?.();
    this.load();
  }

  load() {
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

  getOrCreate(deviceId, name) {
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

  touch(deviceId) {
    const acc = this.accounts.get(deviceId);
    if (acc) { acc.lastSeen = Date.now(); this.dirty = true; }
  }

  // Merge end-of-match stats + xp into account. Returns updated account.
  applyMatchResult(deviceId, { kills, deaths, assists, won, score, xp }) {
    const acc = this.getOrCreate(deviceId, 'OPERATIVE');
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

  setLoadout(deviceId, loadout) {
    const acc = this.getOrCreate(deviceId, 'OPERATIVE');
    if (loadout) {
      acc.loadout = { primary: loadout.primary || acc.loadout.primary, secondary: loadout.secondary || acc.loadout.secondary };
      this.dirty = true;
    }
    return acc;
  }
}
