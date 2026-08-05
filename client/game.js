// DUSTLINE game controller — client state machine + main loop.
// Wires renderer, viewmodel, fx, audio, ui, net, local prediction.
import * as THREE from 'three';
import { createRenderer, createWorld, updateDust, QUALITY } from './renderer.js';
import { createViewmodel, createMuzzleFlash } from './viewmodel.js';
import { createSoldier, animateSoldier, faceSoldier } from './characters.js';
import { createNet, createLocalPlayer, resetLocalWeapon, predictLocal } from './net.js';
import { MSG, TEAMS, TEAM_NAMES } from '../shared/protocol.js';
import { WEAPONS, damageAtRange } from '../shared/weapons.js';
import { clamp, damp, lerp } from '../shared/math.js';
import { MODES, modeById } from '../shared/modes.js';
import { mapById, aabbs } from '../shared/map.js';
import { STANCE, eyeHeight } from '../shared/movement.js';

export function createGame({ container, ui, audio, fx }) {
  const game = {
    container, ui, audio, fx,
    state: 'boot', // boot | menu | connecting | match | end
    quality: QUALITY.high,
    renderer: null, scene: null, camera: null, world: null,
    vm: null, net: null, local: null,
    remote: new Map(), // id -> { soldier, snapshot, interpPos, interpYaw }
    input: null,
    match: null,
    settings: {
      sensitivity: 1.0,
      fov: 75,
      volume: 0.8,
      invertY: false,
      quality: 'high',
      crosshair: '#ffffff',
      damageNumbers: true,
      motionBlur: false,
    },
    keys: new Set(),
    mouse: { down: false, rmb: false },
    raf: 0,
    lastT: 0,
    screenshake: 0,
    ping: 0,
    pings: [],
    uiReady: false,
  };

  game.init = () => {
    game.scene = new THREE.Scene();
    game.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    game.camera.rotation.order = 'YXZ';
    game.renderer = createRenderer(container, game.quality);
    game.world = createWorld(game.renderer, game.scene, 'dustline', game.quality);
    game.vm = createViewmodel(game.scene, game.camera);
    game.vm.setWeapon('m4', true);
    game.input = {
      mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false,
      crouch: false, slide: false, fire: false, ads: false, reload: false,
      melee: false, weapon: 'm4', grenade: false, stim: false,
    };
    bindInput(game);
    bindResize(game);
    game.state = 'menu';
    game.loop();
  };

  // ---- networking callbacks ----
  game.setupNet = () => {
    game.net = createNet({
      url: '',
      onWelcome: (d) => {
        game.local = createLocalPlayer(game.worldColliders());
        game.local.id = d.playerId;
        game.local.name = d.name;
        game.local.team = d.team;
        game.local.weapon = d.weapon;
        game.match = { mode: d.mode, map: d.map, teams: d.teams };
        game.uiReady && game.ui.showHUD();
        game.uiReady && game.ui.hideMenu();
        game.state = 'match';
        game.ui && game.ui.setConnection('online');
        game.ui && game.ui.setAimCapture && game.ui.setAimCapture(document.pointerLockElement === game.renderer?.domElement);
      },
      onState: (d) => {
        if (!game.local) return;
        applyState(game, d);
      },
      onEvent: (d) => {
        game.ui && game.ui.toast && game.ui.toast(d.type);
        if (d.type === 'uav') game.pings = [{ x: 0, z: 0, r: 40, t: performance.now() + 8000 }];
        if (d.type === 'explosion') {
          game.fx && game.fx.spawn && game.fx.spawn('explosion', [d.x, d.y, d.z], [0, 1, 0], { scale: d.r || 3 });
          game.addShake(0.4);
        }
        if (d.type === 'capture' && game.ui && game.ui.scorePop) game.ui.scorePop('+CAPTURE', 0.5, 0.3, 'obj');
      },
      onKillfeed: (d) => {
        game.ui && game.ui.killfeedEntry && game.ui.killfeedEntry(d);
      },
      onScore: (d) => {
        if (game.ui && game.ui.scorePop) {
          const dx = (d.x - game.camera.position.x);
          const dy = (d.y - game.camera.position.y);
          const dz = (d.z - game.camera.position.z);
          if (Math.hypot(dx, dy, dz) < 30) {
            const sx = 0.5 + (dx / 100);
            const sy = 0.5 - (dy / 100);
            game.ui.scorePop(d.reason + (d.delta > 0 ? ' +' + d.delta : ''), clamp(sx, 0.2, 0.8), clamp(sy, 0.2, 0.8), 'score');
          }
        }
      },
      onXp: (d) => {
        game.ui && game.ui.levelUp && game.ui.levelUp(d);
      },
      onMatchEnd: (d) => {
        game.state = 'end';
        game.ui && game.ui.showMatchEnd && game.ui.showMatchEnd(d);
      },
      onRoom: (d) => { game.ui && game.ui.roomUpdate && game.ui.roomUpdate(d); },
      onChat: (d) => { game.ui && game.ui.chatAdd && game.ui.chatAdd(d); },
      onDamage: (d) => {
        if (game.local) game.local.hp = Math.max(0, game.local.hp - d.dmg);
        game.ui && game.ui.damageFlash && game.ui.damageFlash(clamp(d.dmg / 60, 0, 1));
        game.audio && game.audio.play && game.audio.play('hitTaken');
        game.addShake(clamp(d.dmg / 60, 0, 0.5));
      },
      onHit: (d) => {
        game.ui && game.ui.hitmarker && game.ui.hitmarker(d.headshot ? 'head' : 'hit');
        game.audio && game.audio.play && game.audio.play(d.headshot ? 'headshot' : 'hitmarker');
      },
      onError: (d) => { game.ui && game.ui.showToast && game.ui.showToast('Connection error'); },
      onStatus: (s) => {
        game.ui && game.ui.setConnection && game.ui.setConnection(s);
        if (s === 'offline' && game.state === 'connecting') {
          game.state = 'menu';
          game.ui && game.ui.showMenu && game.ui.showMenu();
        }
      },
    });
  };

  // ---- input ----
  function bindInput(game) {
    document.addEventListener('keydown', (e) => {
      game.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyR') game.input.reload = true;
      if (e.code === 'KeyG') game.input.grenade = true;
      if (e.code === 'KeyF') game.input.melee = true;
      if (e.code === 'Tab') { e.preventDefault(); game.ui && game.ui.toggleScoreboard && game.ui.toggleScoreboard(true); }
      if (e.code === 'Escape') {
        game.ui && game.ui.toggleScoreboard && game.ui.toggleScoreboard(false);
        game.mouse.down = false;
        game.mouse.rmb = false;
        game.input.fire = false;
        game.input.ads = false;
        if (document.pointerLockElement) document.exitPointerLock?.();
      }
      if (e.code === 'Enter') { game.ui && game.ui.openChat && game.ui.openChat(); }
    });
    document.addEventListener('keyup', (e) => {
      game.keys.delete(e.code);
      if (e.code === 'KeyR') game.input.reload = false;
      if (e.code === 'KeyG') game.input.grenade = false;
      if (e.code === 'KeyF') game.input.melee = false;
    });
    document.addEventListener('mousedown', (e) => {
      if (game.state === 'match' && document.pointerLockElement !== game.renderer?.domElement) game.renderer?.domElement?.requestPointerLock?.();
      if (e.button === 0) { game.mouse.down = true; game.input.fire = true; }
      if (e.button === 2) { game.mouse.rmb = true; game.input.ads = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { game.mouse.down = false; game.input.fire = false; }
      if (e.button === 2) { game.mouse.rmb = false; game.input.ads = false; }
    });
    document.addEventListener('pointerlockchange', () => {
      if (game.state !== 'match') return;
      game.ui && game.ui.setAimCapture && game.ui.setAimCapture(document.pointerLockElement === game.renderer?.domElement);
    });
    document.addEventListener('mousemove', (e) => {
      if (game.state !== 'match') return;
      const sens = 0.0022 * game.settings.sensitivity;
      const invert = game.settings.invertY ? -1 : 1;
      game.input.yaw -= e.movementX * sens;
      game.input.pitch -= e.movementY * sens * invert;
      game.input.pitch = clamp(game.input.pitch, -1.5, 1.5);
    });
    document.addEventListener('wheel', (e) => {
      if (game.state !== 'match') return;
      const weapons = ['m4', 'ak', 'mp5', 'm249', 'shotgun', 'sniper', 'pistol', 'knife'];
      const idx = weapons.indexOf(game.input.weapon);
      const next = e.deltaY > 0 ? Math.min(weapons.length - 1, idx + 1) : Math.max(0, idx - 1);
      game.input.weapon = weapons[next];
      game.vm && game.vm.setWeapon(game.input.weapon);
      game.net && game.net.send && game.net.send(MSG.LOADOUT, { loadout: { primary: 'm4', secondary: 'pistol', weapon: game.input.weapon } });
    });
  }

  function bindResize(game) {
    window.addEventListener('resize', () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      game.renderer.setSize(w, h);
      game.camera.aspect = w / h;
      game.camera.updateProjectionMatrix();
    });
  }

  game.worldColliders = () => {
    const map = mapById(game.match && game.match.map || 'dustline');
    const c = aabbs(map);
    return {
      colliders: c,
      bounds: map.bounds,
      groundY: () => 0,
    };
  };

  // ---- state application ----
  function applyState(game, d) {
    const local = game.local;
    if (!local) return;
    // our authoritative position from server
    const me = d.players && d.players[local.id];
    if (me) {
      // soft correction only if we drift (lag-comp)
      const dx = me.pos[0] - local.pos[0], dz = me.pos[2] - local.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist > 2.5) {
        local.pos[0] = me.pos[0];
        local.pos[1] = me.pos[1];
        local.pos[2] = me.pos[2];
      }
      local.hp = me.hp;
      local.ap = me.ap;
      local.alive = me.alive;
      local.stance = me.stance;
      local.weapon = me.weapon;
      if (me.ammo) local.ammo = me.ammo;
      if (me.sprint !== undefined) local.sprint = me.sprint;
    }
    // remote players
    syncRemote(game, d.players);
    // HUD
    if (game.ui && game.ui.updateHUD) {
      const mag = local.ammo && local.ammo[local.weapon] ? local.ammo[local.weapon].mag : 0;
      const reserve = local.ammo && local.ammo[local.weapon] ? local.ammo[local.weapon].reserve : 0;
      game.ui.updateHUD({
        hp: local.hp, ap: local.ap, mag, reserve, weaponName: WEAPONS[local.weapon]?.name || '',
        crosshairSpread: local.ads ? 2 : 14,
        ads: local.ads, sprint: local.sprint, stance: local.stance,
        objective: 'HOLD THE LINE',
        timeLeft: d.timeLeft, mode: d.mode, map: d.map,
        score: d.scores, killstreak: me ? me.streak : 0,
      });
    }
    // minimap
    if (game.ui && game.ui.setMinimap) {
      const plist = Object.values(d.players).map(p => ({
        x: p.pos[0], z: p.pos[2], team: p.team, isYou: p.id === local.id, dir: p.yaw,
      }));
      const flags = (d.flags || []).map(f => ({ id: f.id, x: f.x, z: f.z, team: f.team }));
      game.ui.setMinimap(plist, flags, { x: local.pos[0], z: local.pos[2] });
    }
    if (game.ui && game.ui.setCompass) {
      game.ui.setCompass(local.yaw, (local.yaw * 180 / Math.PI + 360) % 360, game.pings);
    }
    if (game.ui && game.ui.setScoreboard && game.ui.scoreboardOpen) {
      const rows = Object.values(d.players).map(p => ({
        name: p.name, team: p.team, kills: p.kills, deaths: p.deaths,
        score: p.score, ping: p.ping || 0, isYou: p.id === local.id, level: p.level || 1,
      }));
      game.ui.setScoreboard(rows, d.mode, d.timeLeft);
    }
    // ping smoothing
    if (d.seq && game.net) {
      // simple heuristic: server echoes seq; measure via pong instead
    }
    // events queue drain
    if (d.events && d.events.length) {
      d.events.forEach(ev => {
        game.ui && game.ui.toast && game.ui.toast(ev.type);
      });
    }
  }

  function syncRemote(game, players) {
    const map = new Map();
    if (players) {
      Object.entries(players).forEach(([id, p]) => {
        if (id === game.local.id) return;
        map.set(id, p);
        let ent = game.remote.get(id);
        if (!ent) {
          ent = { soldier: createSoldier(p.team), pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.yaw, pitch: p.pitch, hp: p.hp };
          game.scene.add(ent.soldier);
          game.remote.set(id, ent);
        }
        // interpolate
        ent.pos[0] = lerp(ent.pos[0], p.pos[0], 0.4);
        ent.pos[1] = lerp(ent.pos[1], p.pos[1], 0.4);
        ent.pos[2] = lerp(ent.pos[2], p.pos[2], 0.4);
        ent.yaw = p.yaw;
        ent.pitch = p.pitch;
        ent.hp = p.hp;
        ent.alive = p.alive;
        ent.team = p.team;
        ent.soldier.position.set(ent.pos[0], ent.pos[1] - 0.92, ent.pos[2]);
        ent.soldier.visible = p.alive;
        if (p.alive) {
          faceSoldier(ent.soldier, p.yaw, 0.1);
          const speed = Math.hypot(p.vel ? p.vel[0] : 0, p.vel ? p.vel[2] : 0);
          animateSoldier(ent.soldier, 0.016, { move: speed / 7, sprint: speed > 6, alive: true });
        }
      });
    }
    // remove stale
    game.remote.forEach((ent, id) => {
      if (!map.has(id)) {
        game.scene.remove(ent.soldier);
        game.remote.delete(id);
      }
    });
  }

  // ---- main loop ----
  game.loop = () => {
    game.raf = requestAnimationFrame(game.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - (game.lastT || now)) / 1000);
    game.lastT = now;

    // derive movement from the live keyboard state every frame
    if (game.state === 'match') {
      game.input.mx = (game.keys.has('KeyD') ? 1 : 0) - (game.keys.has('KeyA') ? 1 : 0);
      game.input.mz = (game.keys.has('KeyW') ? 1 : 0) - (game.keys.has('KeyS') ? 1 : 0);
      game.input.sprint = game.keys.has('ShiftLeft') || game.keys.has('ShiftRight');
      game.input.jump = game.keys.has('Space');
      game.input.crouch = game.keys.has('KeyC');
      game.input.slide = game.input.crouch && game.input.sprint;
    }

    // send input at rate
    if (game.state === 'match' && game.net && game.local && game.local.alive) {
      game.input.yaw = game.local.yaw;
      game.input.pitch = game.local.pitch;
      game.input.weapon = game.local.weapon;
      game.net.lastInput = game.input;
      game.net.sendInput && game.net.sendInput();
      // predict
      predictLocal(game.local, game.input, dt);
    }

    // camera from local
    if (game.local) {
      const eye = eyeHeight(game.local.stance);
      const bob = viewBob(game.local);
      game.camera.position.set(
        game.local.pos[0],
        game.local.pos[1] + eye + bob.y,
        game.local.pos[2]
      );
      // screenshake
      if (game.screenshake > 0.001) {
        game.screenshake = Math.max(0, game.screenshake - dt * 2.2);
        game.camera.position.x += (Math.random() - 0.5) * game.screenshake * 0.12;
        game.camera.position.y += (Math.random() - 0.5) * game.screenshake * 0.12;
        game.camera.position.z += (Math.random() - 0.5) * game.screenshake * 0.12;
      }
      game.camera.rotation.set(game.local.pitch, game.local.yaw, 0);
    }

    // viewmodel
    if (game.vm && game.local) {
      const speed = Math.hypot(game.local.vel[0], game.local.vel[2]);
      game.vm.update(dt, {
        moveSpeed: speed, sprint: game.local.sprint > 0.5, ads: game.input.ads,
        firing: game.input.fire, reloading: game.local.reloading, melee: game.local.meleeT > 0,
        grounded: game.local.grounded, velY: game.local.vel[1],
      });
    }

    // dust
    game.world && updateDust(game.world.dust, dt);

    // fx + audio ambient
    game.fx && game.fx.update && game.fx.update(dt);
    game.audio && game.audio.ambientTick && game.audio.ambientTick(dt, game.state);

    // render
    game.renderer.render(game.scene, game.camera);
  };

  function viewBob(local) {
    if (!local.grounded) return { y: 0 };
    const speed = Math.hypot(local.vel[0], local.vel[2]);
    if (speed < 0.5) return { y: Math.sin(performance.now() / 600) * 0.002 };
    const t = performance.now() / 1000;
    return { y: Math.abs(Math.sin(t * (6 + speed * 0.9))) * (0.008 + speed * 0.002) };
  }

  game.addShake = (i) => { game.screenshake = Math.min(1, game.screenshake + i); };

  game.start = () => {
    if (!game.net) game.setupNet();
    game.state = 'connecting';
    game.ui && game.ui.showLoading && game.ui.showLoading(30);
    const name = localStorage.getItem('dustline_name') || 'OPERATIVE';
    const deviceId = localStorage.getItem('dustline_device') || (localStorage.setItem('dustline_device', Math.random().toString(36).slice(2)), localStorage.getItem('dustline_device'));
    const loadout = { primary: 'm4', secondary: 'pistol' };
    const mode = localStorage.getItem('dustline_mode') || 'tdm';
    const map = 'dustline';
    game.net.connect(name, deviceId, loadout, { mode, map }).then(() => {
      game.ui && game.ui.showLoading && game.ui.showLoading(100);
      setTimeout(() => game.ui && game.ui.hideLoading && game.ui.hideLoading(), 300);
    }).catch(() => {
      game.ui && game.ui.showToast && game.ui.showToast('Could not reach server');
      game.state = 'menu';
    });
  };

  game.dispose = () => {
    cancelAnimationFrame(game.raf);
    game.net && game.net.disconnect && game.net.disconnect();
    game.world && game.world.dispose && game.world.dispose();
  };

  return game;
}

function viewBob2() { return { y: 0 }; }
