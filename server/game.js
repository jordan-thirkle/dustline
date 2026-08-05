// DUSTLINE authoritative game simulation — one 30Hz tick simulates physics,
// hitscan, damage, modes, bots, XP. Shared contracts drive everything.
import { integratePlayer, STANCE, eyeHeight, BODY_W, BODY_DEPTH, JUMP_V } from '../shared/movement.js';
import { WEAPONS, damageAtRange, shotInterval, pelletsFor } from '../shared/weapons.js';
import { XP, levelFromXp, UNLOCKS, newStats, LOADOUT_SLOTS } from '../shared/progression.js';
import { modeById } from '../shared/modes.js';
import { mapById, aabbs, spawnYaw } from '../shared/map.js';
import { clamp, dist2, rayAABB, mulberry32 } from '../shared/math.js';
import { MSG, TEAMS } from '../shared/protocol.js';

const HEAD_H = 1.55;     // head hitbox center height
const BODY_R = 0.42;     // body hit radius
const HEAD_R = 0.16;

export class GameSim {
  constructor({ mode, map, onBroadcast, onMessage }) {
    this.modeId = mode;
    this.mapId = map;
    this.map = mapById(map);
    this.mode = modeById(mode);
    this.world = { colliders: aabbs(this.map), bounds: this.map.bounds, groundY: () => 0 };
    this.onBroadcast = onBroadcast;   // (msgType, data, opts) => broadcast to players
    this.onMessage = onMessage;       // player-bound sends handled by room layer
    this.players = new Map();
    this.entities = [];               // tags, bombs, care packages
    this.flags = {};                  // dom
    this.state = 'warmup';
    this.timeLeft = 15;
    this.scores = { tan: 0, green: 0, ffa: 0 };
    this.round = 0;
    this.matchTime = 0;
    this.events = [];
    this.bomb = null;                 // snd
    this.roundWinner = null;
    this.startTime = Date.now();
    this.tick = 0;
    this.spawnPointIdx = 0;
    this._entityId = 1;
    this.botRng = mulberry32(42);

    if (this.mode.id === 'dom') {
      for (const [id, [x, z]] of Object.entries(this.map.domFlags)) this.flags[id] = { id, x, z, team: TEAMS.NONE, t: 0 };
    }
  }

  // ---------- players ----------
  addPlayer(p) {
    p.stance = STANCE.STAND;
    p.grounded = true;
    p.slideT = 0;
    p.sprint = 0;
    p.vel = [0, 0, 0];
    p.hp = 100;
    p.ap = 50;
    p.alive = true;
    p.spawnProtect = 2.5;
    p.weapon = p.loadout.primary;
    p.weapons = { primary: p.loadout.primary, secondary: p.loadout.secondary };
    p.ammo = {};
    for (const [slot, id] of Object.entries(p.weapons)) {
      const w = WEAPONS[id];
      p.ammo[id] = { mag: w.mag, reserve: w.reserve };
    }
    p.stance = STANCE.STAND;
    p.reloadT = 0;
    p.reloading = false;
    p.lastShot = 0;
    p.damageT = 0;
    p.streak = 0;
    p.kills = 0; p.deaths = 0; p.assists = 0; p.score = 0;
    p.isBot = !!p.isBot;
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  spawn(p) {
    const list = this.mode.teams ? this.map.spawns[p.team === TEAMS.GREEN ? 'green' : 'tan'] : this.map.spawns.ffa;
    // find a spawn far from enemies, skipping points blocked by colliders
    const blocked = (x, z) => {
      const hw = BODY_W / 2;
      for (const c of this.world.colliders) {
        const [cx, cz, cw, cd, ch] = c;
        if (x + hw > cx - cw && x - hw < cx + cw && z + hw > cz - cd && z - hw < cz + cd && 1.5 < ch) return true;
      }
      return false;
    };
    let best = list[0], bestScore = -1e9;
    for (const [x, z] of list) {
      if (blocked(x, z)) continue;
      let dMin = 1e9;
      for (const o of this.players.values()) {
        if (o.alive && o.id !== p.id) dMin = Math.min(dMin, dist2(x, z, o.pos[0], o.pos[2]));
      }
      const s = dMin + Math.random() * 4;
      if (s > bestScore) { bestScore = s; best = [x, z]; }
    }
    // fallback: nudge away from any collider
    if (blocked(best[0], best[1])) {
      for (let ang = 0; ang < Math.PI * 2; ang += 0.5) {
        const cx = best[0] + Math.cos(ang) * 3, cz = best[1] + Math.sin(ang) * 3;
        if (!blocked(cx, cz)) { best = [cx, cz]; break; }
      }
    }
    p.pos = [best[0], eyeHeight(STANCE.STAND), best[1]];
    p.vel = [0, 0, 0];
    p.yaw = spawnYaw(best[0], best[1]);
    p.pitch = 0;
    p.hp = 100; p.ap = 50;
    p.alive = true;
    p.spawnProtect = 2.5;
    p.stance = STANCE.STAND;
    p.reloading = false;
    p.reloadT = 0;
    this.resetAmmo(p);
    // reset weapon to primary
    p.weapon = p.weapons.primary;
  }

  resetAmmo(p) {
    for (const [slot, id] of Object.entries(p.weapons)) {
      const w = WEAPONS[id];
      p.ammo[id] = { mag: w.mag, reserve: w.reserve };
    }
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  // ---------- tick ----------
  tickAll(dt) {
    this.tick++;
    this.matchTime += dt;
    if (this.state === 'warmup') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.state = 'active'; this.timeLeft = this.mode.duration; this.onBroadcast(MSG.EVENT, { type: 'matchStart' }); }
    } else if (this.state === 'active') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.endMatch(); return; }
    } else if (this.state === 'ended') {
      this.timeLeft -= dt;
      if (this.timeLeft <= -8) this.onBroadcast(MSG.EVENT, { type: 'restart' });
    }

    // snd round flow
    if (this.mode.id === 'snd') {
      this.tickSnd(dt);
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        p.deathT -= dt;
        if (this.mode.respawn && p.deathT <= 0) this.spawn(p);
        continue;
      }
      if (p.spawnProtect > 0) p.spawnProtect -= dt;
      if (p.reloading) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) {
          const w = WEAPONS[p.weapon];
          const ammo = p.ammo[p.weapon];
          const need = w.mag - ammo.mag;
          const take = Math.min(need, ammo.reserve);
          ammo.mag += take;
          ammo.reserve -= take;
          p.reloading = false;
        }
      }
      // regen
      if (p.damageT > 0) p.damageT -= dt;
      if (p.hp < 100 && p.hp > 0 && p.damageT <= 0) p.hp = Math.min(100, p.hp + 14 * dt);
      // weapon switch handling
      if (p.pendingWeapon) {
        p.weapon = p.pendingWeapon;
        p.pendingWeapon = null;
        p.reloading = false;
        p.lastShot = this.matchTime;
      }
      // bots are fully driven by stepBot; humans by stepPlayer
      if (p.isBot) {
        this.stepBot(p, dt);
      } else {
        this.stepPlayer(p, dt);
      }
    }

    // entities (tags)
    for (const e of this.entities) {
      if (e.type === 'tag') {
        e.t += dt;
        if (e.t > 30) e.dead = true;
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          const d = dist2(e.x, e.z, p.pos[0], p.pos[2]);
          if (d < 1.6) {
            // pickup
            if (p.id === e.owner) { /* self tag no score */ }
            else if (e.ownerTeam === TEAMS.NONE || p.team === e.ownerTeam) {
              this.awardScore(p, 100, 'confirm', 'TAG +100', e.x, 1, e.z);
              this.addXp(p, XP.CONFIRM, 'confirm');
              this.pushEvent({ type: 'confirm', x: e.x, y: 1, z: e.z, team: p.team, by: p.id });
            } else {
              this.awardScore(p, 50, 'deny', 'DENY +50', e.x, 1, e.z);
              this.addXp(p, XP.DENY, 'deny');
              this.pushEvent({ type: 'deny', x: e.x, y: 1, z: e.z, by: p.id });
            }
            e.dead = true;
          }
        }
      } else if (e.type === 'carepackage') {
        e.t += dt;
        if (e.t > 40) e.dead = true;
      }
    }
    this.entities = this.entities.filter(e => !e.dead);

    // dom flag ticks
    if (this.mode.id === 'dom') this.tickDom(dt);

    this.checkWin();
  }

  stepPlayer(p, dt) {
    if (!p.input) return;
    const inp = p.input;
    // slide flag for movement
    const slideIn = !!inp.slide;
    const moveInput = {
      mx: inp.mx || 0, mz: inp.mz || 0,
      sprint: inp.sprint, jump: inp.jump, crouch: inp.crouch, slide: slideIn,
    };
    p.yaw = inp.yaw ?? p.yaw;
    p.pitch = clamp(inp.pitch ?? p.pitch, -1.5, 1.5);
    integratePlayer(p, moveInput, dt, this.world);

    // fire
    if (inp.fire && this.mode.id !== 'snd' || inp.fire && this.mode.id === 'snd' && this.roundActive) {
      this.tryFire(p, inp.fireHeld);
    }
    // reload request
    if (inp.reload) this.startReload(p);
    // melee
    if (inp.melee) this.tryMelee(p);
    // grenade
    if (inp.grenade) this.throwGrenade(p);
    // weapon switch
    if (inp.weapon && inp.weapon !== p.weapon && WEAPONS[inp.weapon]) {
      if (p.weapons.primary === inp.weapon || p.weapons.secondary === inp.weapon || inp.weapon === 'knife') {
        p.pendingWeapon = inp.weapon;
      }
    }
  }

  // ---------- weapons ----------
  tryFire(p, held) {
    const w = WEAPONS[p.weapon];
    if (!w) return;
    if (w.mag === 0 || p.reloading) return;
    const interval = shotInterval(w);
    const now = this.matchTime;
    if (now - p.lastShot < interval) return;
    if (!w.auto && !held) return; // semi requires fresh trigger per shot handled by held flag edge in room layer
    p.lastShot = now;
    p.ammo[p.weapon].mag--;

    // spread cone
    const moving = Math.hypot(p.vel[0], p.vel[2]) > 1;
    let spread = (p.ads ? w.adsSpread : w.hipSpread) + (moving ? w.moveSpread : 0);
    // recoil accumulates
    p.recoilPitch = (p.recoilPitch || 0) + w.recoil.up;
    p.recoilYaw = (p.recoilYaw || 0) + (Math.random() - 0.5) * w.recoil.side * 2;
    const totalSpread = spread + p.recoilPitch * 0.35;
    if (p.recoilPitch > 0.12) { p.recoilPitch = 0.12; }
    // recoil decays naturally via pitch clamp in stepPlayer (pitch applied to sim)

    const pellets = pelletsFor(w);
    let hitAny = false, totalDmg = 0, lastHitPoint = null;
    for (let i = 0; i < pellets; i++) {
      const [hx, hy, hz] = this.rayFromPlayer(p, totalSpread * (i === 0 ? 0.4 : 1), i);
      const hit = this.raycast(p.pos[0], p.pos[1] + 1.5, p.pos[2], hx, hy, hz, p, w);
      if (hit) {
        hitAny = true;
        lastHitPoint = [hit.x, hit.y, hit.z];
        if (hit.type === 'player') {
          this.applyDamage(hit.victim, hit.dmg, hit.headshot, p, w, hit.x, hit.y, hit.z);
        } else {
          this.pushEvent({ type: 'impact', x: hit.x, y: hit.y, z: hit.z, mat: 'concrete', owner: p.id });
        }
      }
    }
    // tracer event
    if (lastHitPoint) {
      this.pushEvent({ type: 'tracer', x: p.pos[0], y: p.pos[1] + 1.5, z: p.pos[2], tx: lastHitPoint[0], ty: lastHitPoint[1], tz: lastHitPoint[2], owner: p.id, weapon: p.weapon });
    } else {
      this.pushEvent({ type: 'tracer', x: p.pos[0], y: p.pos[1] + 1.5, z: p.pos[2], tx: hx, ty: hy, tz: hz, owner: p.id, weapon: p.weapon });
    }
    // muzzle event
    this.pushEvent({ type: 'muzzle', x: p.pos[0], y: p.pos[1] + 1.5, z: p.pos[2], owner: p.id, weapon: p.weapon });

    // auto reload
    if (p.ammo[p.weapon].mag === 0) this.startReload(p);
  }

  rayFromPlayer(p, spread, seed) {
    // yaw/pitch + spread cone
    const yaw = p.yaw + (Math.random() - 0.5) * spread * 2;
    const pitch = p.pitch + (Math.random() - 0.5) * spread * 2;
    const dir = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
    const range = 200;
    return [p.pos[0] + dir[0] * range, p.pos[1] + 1.5 + dir[1] * range, p.pos[2] + dir[2] * range];
  }

  raycast(ox, oy, oz, dx, dy, dz, shooter, w) {
    // vs world colliders: [cx, cz, cw, cd, ch]
    let best = 1e9, bestInfo = null;
    for (const c of this.world.colliders) {
      const [cx, cz, cw, cd, ch] = c;
      const minX = cx - cw, maxX = cx + cw;
      const minZ = cz - cd, maxZ = cz + cd;
      const t = rayAABB(ox, oy, oz, dx - ox, dy - oy, dz - oz, minX, 0, minZ, maxX, ch, maxZ);
      if (t !== null && t < best) {
        best = t;
        bestInfo = { type: 'world', t, x: ox + (dx - ox) * t, y: oy + (dy - oy) * t, z: oz + (dz - oz) * t };
      }
    }
    // vs players
    for (const o of this.players.values()) {
      if (!o.alive || o.id === shooter.id) continue;
      // head sphere
      const hx = o.pos[0], hy = o.pos[1] + HEAD_H, hz = o.pos[2];
      let t = sphereRay(ox, oy, oz, dx - ox, dy - oy, dz - oz, hx, hy, hz, HEAD_R);
      if (t !== null && t < best) {
        const dmg = damageAtRange(w, t) * w.dmgHead;
        best = t;
        bestInfo = { type: 'player', t, victim: o, dmg, headshot: true, x: ox + (dx - ox) * t, y: oy + (dy - oy) * t, z: oz + (dz - oz) * t };
      }
      // body capsule (two spheres approximation)
      const bx = o.pos[0], by = o.pos[1] + 0.9, bz = o.pos[2];
      t = sphereRay(ox, oy, oz, dx - ox, dy - oy, dz - oz, bx, by, bz, BODY_R);
      if (t !== null && t < best) {
        const dmg = damageAtRange(w, t);
        best = t;
        bestInfo = { type: 'player', t, victim: o, dmg, headshot: false, x: ox + (dx - ox) * t, y: oy + (dy - oy) * t, z: oz + (dz - oz) * t };
      }
    }
    return bestInfo && bestInfo.type === 'player' ? bestInfo : bestInfo;
  }

  applyDamage(victim, dmg, headshot, attacker, w, x, y, z) {
    if (!victim.alive) return;
    // spawn protection
    if (victim.spawnProtect > 0 && attacker !== victim) return;
    // flak
    if (victim.perks && victim.perks.flak && (w.class === 'explosive')) dmg *= 0.75;
    // armor absorbs 50%
    if (victim.ap > 0) {
      const absorbed = Math.min(victim.ap, dmg * 0.5);
      victim.ap -= absorbed;
      dmg -= absorbed * 0.5; // armor reduces some
    }
    victim.hp -= dmg;
    victim.damageT = 3;
    const isKill = victim.hp <= 0;
    if (isKill) {
      this.kill(victim, attacker, w, headshot, x, y, z);
    } else {
      // damage message to victim
      this.onMessage && this.onMessage(victim.id, MSG.DAMAGE, { dmg, x, y, z, from: attacker.id });
      // hit message to attacker
      this.onMessage && this.onMessage(attacker.id, MSG.HIT, { target: victim.id, dmg, headshot, x, y, z, killer: attacker.id });
      this.pushEvent({ type: 'hit', x, y, z, victim: victim.id, dmg, headshot, from: attacker.id });
      // assist tracking
      if (attacker.id !== victim.id) {
        victim.lastHitBy = attacker.id;
      }
    }
  }

  kill(victim, attacker, w, headshot, x, y, z) {
    victim.alive = false;
    victim.deathT = 3;
    victim.deaths++;
    attacker.kills++;
    attacker.streak++;
    attacker.score += 100;
    victim.streak = 0;
    const killerId = attacker.id;

    // xp
    this.addXp(attacker, headshot ? XP.KILL_HEADSHOT : XP.KILL, 'kill');
    this.addXp(victim, XP.LOSE / 4, 'death');

    this.pushEvent({ type: 'kill', x, y, z, killer: killerId, victim: victim.id, weapon: w.id, headshot });
    this.onBroadcast(MSG.KILLFEED, {
      killer: attacker.name, victim: victim.name, weapon: w.id, headshot,
      killerTeam: attacker.team, victimTeam: victim.team, time: this.matchTime,
    });

    // kc tag drop
    if (this.mode.id === 'kc') {
      this.entities.push({ type: 'tag', x, y: 1, z, t: 0, owner: victim.id, ownerTeam: victim.team, id: this._entityId++ });
    }
    // snd no respawn
    if (this.mode.id === 'snd') {
      this.checkSndRound();
    }
    // assist
    if (victim.lastHitBy && victim.lastHitBy !== attacker.id) {
      const assist = this.players.get(victim.lastHitBy);
      if (assist) {
        assist.assists++;
        this.addXp(assist, XP.ASSIST, 'assist');
      }
    }
    // scoreboard mode scoring
    if (this.mode.id === 'tdm') {
      if (attacker.team === TEAMS.TAN) this.scores.tan++;
      else if (attacker.team === TEAMS.GREEN) this.scores.green++;
      this.checkScoreWin();
    } else if (this.mode.id === 'ffa') {
      this.scores.ffa = Math.max(this.scores.ffa, attacker.score);
      this.checkScoreWin();
    }

    // first blood
    if (!this.firstBlood) { this.firstBlood = true; this.addXp(attacker, XP.FIRST_BLOOD, 'firstBlood'); this.pushEvent({ type: 'firstBlood', killer: killerId }); }
  }

  checkScoreWin() {
    const m = this.mode;
    const target = m.scoreToWin;
    if (m.id === 'tdm' && (this.scores.tan >= target || this.scores.green >= target)) this.endMatch();
    if (m.id === 'ffa') {
      for (const p of this.players.values()) if (p.score >= target) this.endMatch();
    }
  }

  startReload(p) {
    const w = WEAPONS[p.weapon];
    if (!w || w.mag === 0 || p.reloading) {
      if (!w || p.reloading) return;
    }
    const ammo = p.ammo[p.weapon];
    if (ammo.mag >= w.mag || ammo.reserve <= 0) return;
    const t = w.reload;
    p.reloading = true;
    p.reloadT = t;
    this.onMessage && this.onMessage(p.id, MSG.EVENT, { type: 'reloadStart', weapon: p.weapon, t });
  }

  tryMelee(p) {
    const w = WEAPONS.knife;
    const range = 2.6;
    const dir = [Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
    let best = null, bestD = 1e9;
    for (const o of this.players.values()) {
      if (!o.alive || o.id === p.id) continue;
      const d = dist2(o.pos[0], o.pos[2], p.pos[0], p.pos[2]);
      if (d < range && d < bestD) { best = o; bestD = d; }
    }
    this.pushEvent({ type: 'melee', x: p.pos[0], y: p.pos[1] + 1.5, z: p.pos[2], owner: p.id });
    if (best) {
      this.applyDamage(best, w.dmg, false, p, w, best.pos[0], best.pos[1] + 0.9, best.pos[2]);
    }
  }

  throwGrenade(p) {
    if (this.grenadeT && p.id === this.grenadeT) return;
    this.grenadeT = p.id;
    const dir = [Math.sin(p.yaw) * 0.8, 1.2, -Math.cos(p.yaw) * 0.8];
    const start = [p.pos[0] + dir[0], p.pos[1] + 1.4, p.pos[2] + dir[2]];
    const id = this._entityId++;
    this.entities.push({ type: 'grenade', x: start[0], y: start[1], z: start[2], vx: dir[0], vy: dir[1], vz: dir[2], owner: p.id, t: 0, id });
    this.pushEvent({ type: 'grenadeThrow', x: start[0], y: start[1], z: start[2], owner: p.id });
    setTimeout(() => { this.grenadeT = null; }, 1200);
  }

  // ---------- modes ----------
  tickDom(dt) {
    for (const f of Object.values(this.flags)) {
      let counts = { 0: 0, 1: 0, 2: 0 };
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (dist2(f.x, f.z, p.pos[0], p.pos[2]) < 2.5) counts[p.team]++;
      }
      const winner = counts[TEAMS.TAN] > 0 && counts[TEAMS.TAN] > counts[TEAMS.GREEN] ? TEAMS.TAN
        : counts[TEAMS.GREEN] > 0 && counts[TEAMS.GREEN] > counts[TEAMS.TAN] ? TEAMS.GREEN : f.team;
      if (winner !== TEAMS.NONE && counts[winner] > counts[f.team]) {
        f.t += dt;
        if (f.t > 2) {
          if (f.team !== winner) {
            f.team = winner;
            const name = winner === TEAMS.TAN ? 'tan' : 'green';
            this.scores[name]++;
            this.checkScoreWin();
            this.addXpToTeam(winner, XP.CAPTURE, 'capture');
            this.pushEvent({ type: 'capture', x: f.x, y: 0, z: f.z, flag: f.id, team: winner });
          }
        }
      } else {
        f.t = 0;
      }
    }
  }

  addXpToTeam(team, amount, reason) {
    for (const p of this.players.values()) if (p.team === team) this.addXp(p, amount, reason);
  }

  tickSnd(dt) {
    if (this.state !== 'active') return;
    if (!this.roundActive) {
      // round transition
      this.roundTimer -= dt;
      if (this.roundTimer <= 0) this.startSndRound();
      return;
    }
    this.roundTimer -= dt;
    if (this.roundTimer <= 0) {
      // time expired
      this.endSndRound(this.roundWinner === null ? this.defenderTeam() : this.roundWinner, 'time');
    }
    // bomb
    if (this.bomb && this.bomb.state === 'planted') {
      this.bomb.t -= dt;
      if (this.bomb.t <= 0) {
        // explosion -> attackers win
        this.endSndRound(this.bomb.team, 'detonate');
        this.pushEvent({ type: 'explosion', x: this.bomb.x, y: 0, z: this.bomb.z, r: 6 });
      }
    }
  }

  startSndRound() {
    this.round++;
    this.roundActive = true;
    this.roundTimer = this.mode.flags.roundTime;
    this.defender = this.round % 2 === 1 ? TEAMS.GREEN : TEAMS.TAN; // alternate
    // reset bomb
    this.bomb = null;
    // respawn everyone
    for (const p of this.players.values()) if (p.alive === false) this.spawn(p);
    // reset hp/ammo
    for (const p of this.players.values()) { p.hp = 100; p.ap = 50; this.resetAmmo(p); }
    this.pushEvent({ type: 'roundStart', round: this.round, defender: this.defender });
  }

  endSndRound(winner, reason) {
    this.roundActive = false;
    if (winner === TEAMS.TAN) this.scores.tan++;
    else if (winner === TEAMS.GREEN) this.scores.green++;
    this.roundWinner = winner;
    this.addXpToTeam(winner, XP.WIN / 2, 'round');
    this.pushEvent({ type: 'roundEnd', winner, reason, round: this.round });
    this.roundTimer = 4;
    if (this.scores.tan >= this.mode.flags.rounds || this.scores.green >= this.mode.flags.rounds) {
      this.endMatch();
    } else {
      // start next round after pause
      this.roundTimer = 4;
    }
  }

  defenderTeam() { return this.defender; }

  checkSndRound() {
    // check team wipe
    const alive = { 1: 0, 2: 0 };
    for (const p of this.players.values()) if (p.alive) alive[p.team]++;
    if (alive[TEAMS.TAN] === 0) this.endSndRound(TEAMS.GREEN, 'elim');
    if (alive[TEAMS.GREEN] === 0) this.endSndRound(TEAMS.TAN, 'elim');
  }

  plantBomb(p) {
    if (!this.mode.flags.bomb || this.bomb) return;
    for (const site of Object.values(this.map.snd.sites)) {
      if (dist2(p.pos[0], p.pos[2], site[0], site[1]) < 2.5) {
        this.bomb = { x: site[0], z: site[1], team: p.team, state: 'planted', t: this.mode.flags.plantTime };
        this.pushEvent({ type: 'plant', x: site[0], y: 0, z: site[1], team: p.team, by: p.id });
        this.addXp(p, XP.PLANT, 'plant');
        return;
      }
    }
  }

  defuseBomb(p) {
    if (this.bomb && this.bomb.state === 'planted' && dist2(p.pos[0], p.pos[2], this.bomb.x, this.bomb.z) < 2.5) {
      this.bomb.state = 'defusing';
      this.pushEvent({ type: 'defuseStart', x: this.bomb.x, y: 0, z: this.bomb.z, by: p.id });
      setTimeout(() => {
        if (this.bomb && this.bomb.state === 'defusing') {
          this.bomb = null;
          this.addXp(p, XP.DEFUSE, 'defuse');
          this.endSndRound(this.defenderTeam(), 'defuse');
        }
      }, this.mode.flags.defuseTime * 1000);
    }
  }

  // ---------- scoring / xp ----------
  awardScore(p, delta, reason, label, x, y, z) {
    p.score += delta;
    this.onMessage && this.onMessage(p.id, MSG.SCORE, { id: p.id, delta, reason, x, y, z });
  }

  addXp(p, amount, reason) {
    if (!p || amount <= 0) return;
    const before = levelFromXp(p.totalXp);
    p.totalXp += amount;
    const after = levelFromXp(p.totalXp);
    const unlocks = [];
    if (after > before) {
      for (const [wId, lvl] of Object.entries(UNLOCKS)) {
        if (lvl > before && lvl <= after) unlocks.push(wId);
      }
      this.pushEvent({ type: 'levelUp', player: p.id, level: after });
    }
    this.onMessage && this.onMessage(p.id, MSG.XP, {
      gained: amount, reason, before, after,
      level: after, unlocks,
    });
  }

  checkWin() {
    if (this.mode.id === 'dom' && (this.scores.tan >= this.mode.scoreToWin || this.scores.green >= this.mode.scoreToWin)) this.endMatch();
  }

  endMatch() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.timeLeft = 8;
    const mvp = [...this.players.values()].sort((a, b) => b.score - a.score)[0];
    const winner = this.mode.id === 'ffa'
      ? mvp
      : (this.scores.tan > this.scores.green ? { name: TEAMS_NAMES['1'] } : { name: TEAMS_NAMES['2'] });
    // xp for match
    for (const p of this.players.values()) {
      const won = this.mode.id === 'ffa' ? (p === mvp) : (p.team === (this.scores.tan > this.scores.green ? TEAMS.TAN : TEAMS.GREEN));
      this.addXp(p, won ? XP.WIN : XP.LOSE, won ? 'win' : 'loss');
    }
    this.onBroadcast(MSG.MATCH_END, {
      winner: winner.name,
      scores: this.scores,
      mvp: mvp ? { name: mvp.name, score: mvp.score, kills: mvp.kills } : null,
      mode: this.modeId, map: this.mapId,
      stats: [...this.players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, score: p.score })),
      xpApplied: true,
    });
    this.onBroadcast(MSG.EVENT, { type: 'matchEnd' });
  }

  pushEvent(e) { this.events.push(e); }

  // ---------- bots ----------
  stepBot(p, dt) {
    if (!p.isBot || !p.alive) return;
    const target = this.acquireTarget(p);
    if (!target) {
      // push toward enemy half so teams actually meet, with slight wander
      const dir = p.team === TEAMS.GREEN ? -1 : 1; // green holds +x,+z; tan holds -x,-z
      const aimX = dir * 30 + (Math.sin(this.matchTime * 0.7 + p.id.length) * 14);
      const aimZ = dir * 30 + (Math.cos(this.matchTime * 0.5 + p.id.length) * 14);
      if (!p.botWaypoint || dist2(p.pos[0], p.pos[2], p.botWaypoint[0], p.botWaypoint[1]) < 5) {
        p.botWaypoint = [aimX + (Math.random() * 10 - 5), aimZ + (Math.random() * 10 - 5)];
      }
      const dx = p.botWaypoint[0] - p.pos[0], dz = p.botWaypoint[1] - p.pos[2];
      const yaw = Math.atan2(dx, -dz);
      const d = Math.hypot(dx, dz);
      const inp = this.makeBotInput(p, yaw, d > 2 ? 0.85 : 0, false);
      inp.sprint = true;
      this.applyBotInput(p, inp, dt);
      return;
    }
    const dx = target.pos[0] - p.pos[0], dz = target.pos[2] - p.pos[2];
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz);
    const pitch = Math.atan2((target.pos[1] + 1.3) - (p.pos[1] + 1.5), d);
    // reaction + aim noise
    if (p.botReact === undefined) p.botReact = 0.5 + Math.random() * 0.8;
    if (p.botAimError === undefined) p.botAimError = 0.05;
    if (p.botReact > 0) { p.botReact -= dt; }
    // movement: strafe when in range, chase when far
    const strafe = d < 22;
    let mx = 0, mz = 0;
    if (d > 18) mz = 1;
    else {
      mz = d > 9 ? 0.6 : 0.2;
      mx = strafe ? Math.sin(this.botRng() * 2 * Math.PI) * 0.8 : 0;
    }
    const inp = this.makeBotInput(p, yaw, mz, true);
    inp.mx = mx;
    // fire when aimed and in range
    const aimError = (p.botAimError || 0);
    if (d < 40 && p.botReact <= 0 && Math.abs(angleDiff(p.yaw, yaw)) < 0.12 + aimError) {
      inp.fire = true;
      inp.fireHeld = true;
    }
    // avoid overshooting target pitch
    p.botTargetPitch = pitch;
    this.applyBotInput(p, inp, dt);
  }

  makeBotInput(p, yaw, mz, shoot) {
    return { yaw, pitch: p.botTargetPitch || 0, mx: 0, mz, sprint: mz > 0.9, jump: false, crouch: false, slide: false, fire: false, fireHeld: false, reload: false, melee: false, grenade: false, weapon: p.weapon };
  }

  applyBotInput(p, inp, dt) {
    p.input = inp;
    // bots share the same input pipeline
    const moveInput = { mx: inp.mx, mz: inp.mz, sprint: inp.sprint, jump: inp.jump, crouch: inp.crouch, slide: false };
    p.yaw = inp.yaw;
    p.pitch = clamp(inp.pitch, -1.5, 1.5);
    integratePlayer(p, moveInput, dt, this.world);
    if (inp.fire) this.tryFire(p, true);
  }

  acquireTarget(p) {
    let best = null, bestD = 1e9;
    const range = 95; // cover the map so teams actually meet
    for (const o of this.players.values()) {
      if (!o.alive || o.id === p.id) continue;
      if (this.mode.teams && o.team === p.team) continue;
      const d = dist2(o.pos[0], o.pos[2], p.pos[0], p.pos[2]);
      if (d < range && d < bestD) { bestD = d; best = o; }
    }
    return best;
  }
}

function sphereRay(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-8) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 > 0) return t1;
  const t2 = (-b + disc) / (2 * a);
  return t2 > 0 ? t2 : null;
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const TEAMS_NAMES = { 1: 'JACKALS', 2: 'VIPERS' };
