// DUSTLINE client entry — boot, wire UI, start.
import { createGame } from '../client/game.js';
import { createLocalPlayer } from '../client/net.js';
import { createSoldier } from '../client/characters.js';
import { AudioFX } from '../client/audio.js';
import { FX } from '../client/fx.js';

async function boot() {
  const container = document.getElementById('app');
  const loadbar = document.getElementById('loadbar');
  const ui = await import('../client/ui.js').then(m => m.UI);

  const fx = FX.init ? FX : null;
  const audio = AudioFX;

  const game = createGame({ container, ui, audio, fx });
  game.uiReady = true;
  game.init();

  // wire UI chat + loadout + settings to the game
  ui.onChatSend = (text) => game.net && game.net.chat && game.net.chat(text);
  ui.setWeaponList(
    ['m4', 'ak', 'mp5', 'm249', 'shotgun', 'sniper'],
    ['pistol', 'knife'],
    ['m4', 'pistol', 'knife'], // unlocked defaults; server unlocks more
    { primary: 'm4', secondary: 'pistol' },
    (loadout) => {
      game.local && (game.local.weapons = { primary: loadout.primary, secondary: loadout.secondary });
      game.net && game.net.setLoadout && game.net.setLoadout(loadout);
    }
  );
  // apply settings changes to game
  const applySettings = () => {
    const s = ui.getSettings();
    game.settings = { ...game.settings, ...s };
    if (game.vm) game.vm.setFov(s.fov);
    if (game.camera) game.camera.fov = s.fov;
    audio && audio.setVolume && audio.setVolume(s.volume);
  };
  ui.bindSettings = applySettings;
  applySettings();

  // screenshot QA mode: position camera deterministically and hide HUD
  const params = new URLSearchParams(location.search);
  const cam = params.get('cam');
  if (cam) {
    const CAMS = {
      plaza: { pos: [0, 1.7, -18], target: [0, 1.4, 8] },
      alley: { pos: [-14, 1.7, -10], target: [-6, 1.4, 6] },
      market: { pos: [12, 1.7, 4], target: [-2, 1.3, -6] },
      tower: { pos: [-38, 13.5, 40], target: [0, 1, 0] },
      gun: { pos: [0, 1.7, -2], target: [0, 1.5, 4] },
    };
    const c = CAMS[cam] || CAMS.plaza;
    const hud = document.getElementById('hud');
    if (hud) hud.classList.add('hidden');
    game.qaCam = c;
    game.state = 'match';
    game.local = createLocalPlayer(game.worldColliders());
    game.local.pos = [...c.pos];
    // point camera at target
    const dx = c.target[0] - c.pos[0], dy = c.target[1] - c.pos[1], dz = c.target[2] - c.pos[2];
    game.local.yaw = Math.atan2(dx, -dz);
    game.local.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (cam === 'gun') {
      game.vm.setWeapon('m4', true);
      game.vm.gun.visible = true;
    }
    // drop some bots into view for life
    const p = game.remote;
    const spawnBots = [
      { id: 'qa1', pos: [4, 0, 6], yaw: -Math.PI / 2, team: 1 },
      { id: 'qa2', pos: [-6, 0, 10], yaw: Math.PI / 3, team: 2 },
      { id: 'qa3', pos: [8, 0, -4], yaw: 0.4, team: 1 },
      { id: 'qa4', pos: [-3, 0, 16], yaw: -1, team: 2 },
    ];
    spawnBots.forEach((b) => {
      const ent = { soldier: createSoldier(b.team), pos: [...b.pos], yaw: b.yaw, hp: 100, alive: true, team: b.team };
      ent.soldier.position.set(b.pos[0], 0, b.pos[2]);
      ent.soldier.rotation.y = b.yaw + Math.PI / 2;
      game.scene.add(ent.soldier);
      p.set(b.id, ent);
    });
  }

  // unlock audio on first gesture
  const unlock = () => {
    audio && audio.unlock && audio.unlock();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);

  // wire menu buttons
  const btnPlay = document.getElementById('btn-play');
  if (btnPlay) btnPlay.addEventListener('click', () => {
    audio && audio.play && audio.play('click');
    game.start();
  });
  const btnRestart = document.getElementById('btn-restart');
  if (btnRestart) btnRestart.addEventListener('click', () => {
    game.start();
  });

  // loading bar animation
  let pct = 0;
  const iv = setInterval(() => {
    pct = Math.min(92, pct + Math.random() * 12);
    if (loadbar) loadbar.style.width = pct + '%';
  }, 120);
  window.addEventListener('load', () => {
    clearInterval(iv);
    if (loadbar) loadbar.style.width = '100%';
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) { loading.style.opacity = '0'; setTimeout(() => loading.remove(), 600); }
    }, 200);
  });

  // expose for debugging
  window.__DUSTLINE__ = game;
}

boot();
