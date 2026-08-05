// DUSTLINE client entry — boot, wire UI, start.
import { createGame } from '../client/game.js';
import { createLocalPlayer } from '../client/net.js';
import { createSoldier } from '../client/characters.js';
import { AudioFX } from '../client/audio.js';
import { FX } from '../client/fx.js';

const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setBootProgress(percent, phase, tip) {
  const loading = $('#loading');
  const bar = $('#loadbar');
  const status = $('#load-status');
  const phaseEl = $('#load-phase');
  const tipEl = $('#load-tip');
  const progress = Math.max(0, Math.min(100, Math.round(percent)));
  if (bar) bar.style.width = `${progress}%`;
  if (bar?.parentElement) bar.parentElement.setAttribute('aria-valuenow', String(progress));
  if (status) status.textContent = `${progress}%`;
  if (phaseEl) phaseEl.textContent = phase;
  if (tipEl) tipEl.textContent = tip;
}

function finishBoot() {
  const loading = $('#loading');
  if (!loading) return;
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 700);
}

function failBoot(error) {
  console.error('[DUSTLINE] boot failed', error);
  const loading = $('#loading');
  const message = $('#load-error');
  const raw = String(error?.message || '');
  const kind = raw.includes('WebGL') ? 'RENDERER INITIALIZATION FAILED' : raw.includes('fetch') || raw.includes('module') ? 'CONTENT LOAD FAILED' : raw.includes('TIMEOUT') ? 'LOCAL SERVER DID NOT RESPOND' : 'FIELD SYSTEMS FAILED TO INITIALIZE';
  if (loading) loading.classList.add('failed');
  if (message) message.innerHTML = `${kind}.<br><span>Retry the boot sequence or continue in safe mode.</span>`;
  setBootProgress(0, 'BOOT FAILED', 'RETRY OR CONTINUE IN SAFE MODE');
  const retry = $('#load-retry');
  if (retry) {
    retry.onclick = () => window.location.reload();
    retry.focus();
  }
  const safe = $('#load-safe');
  if (safe) safe.onclick = () => {
    window.localStorage.setItem('dustline_quality', 'low');
    window.location.reload();
  };
}

async function boot() {
  setBootProgress(8, 'LOADING INTERFACE', 'ASSEMBLING FIELD DISPLAY');
  const uiModule = await import('../client/ui.js');
  const ui = uiModule.UI;
  ui.init();

  setBootProgress(24, 'LOADING RENDERER', 'CALIBRATING LIGHT AND MATERIAL RESPONSE');
  await sleep(40);
  const fx = FX.init ? FX : null;
  const audio = AudioFX;
  const container = $('#app');
  const game = createGame({ container, ui, audio, fx });
  game.uiReady = true;

  setBootProgress(42, 'BUILDING WORLD', 'GENERATING PROCEDURAL FIELD ASSETS');
  game.init();

  setBootProgress(68, 'CALIBRATING COMBAT', 'LOADING WEAPONS, MOVEMENT, AND CONTACT');
  ui.onChatSend = (text) => game.net && game.net.chat && game.net.chat(text);
  ui.onRetry = () => game.start();
  ui.onLogin = (u, p) => { audio && audio.play && audio.play('click'); game.login(u, p); };
  ui.onSignup = (u, p) => { audio && audio.play && audio.play('click'); game.signup(u, p); };
  ui.onLogout = () => { audio && audio.play && audio.play('click'); game.logout(); };
  ui.setWeaponList(
    ['m4', 'ak', 'mp5', 'm249', 'shotgun', 'sniper'],
    ['pistol', 'knife'],
    ['m4', 'pistol', 'knife'],
    { primary: 'm4', secondary: 'pistol' },
    (loadout) => {
      game.local && (game.local.weapons = { primary: loadout.primary, secondary: loadout.secondary });
      game.net && game.net.setLoadout && game.net.setLoadout(loadout);
    }
  );
  const applySettings = () => {
    const settings = ui.getSettings();
    game.settings = { ...game.settings, ...settings };
    if (game.vm) game.vm.setFov(settings.fov);
    if (game.camera) game.camera.fov = settings.fov;
    audio && audio.setVolume && audio.setVolume(settings.volume);
  };
  ui.bindSettings = applySettings;
  applySettings();

  setBootProgress(82, 'VERIFYING FIELD', 'CHECKING INPUT, AUDIO, AND HUD SYSTEMS');
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
    const camera = CAMS[cam] || CAMS.plaza;
    $('#hud')?.classList.add('hidden');
    game.state = 'match';
    game.local = createLocalPlayer(game.worldColliders());
    game.local.pos = [...camera.pos];
    const dx = camera.target[0] - camera.pos[0];
    const dy = camera.target[1] - camera.pos[1];
    const dz = camera.target[2] - camera.pos[2];
    game.local.yaw = Math.atan2(dx, -dz);
    game.local.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (cam === 'gun') {
      game.vm.setWeapon('m4', true);
      game.vm.gun.visible = true;
    }
    const spawnBots = [
      { id: 'qa1', pos: [4, 0, 6], yaw: -Math.PI / 2, team: 1 },
      { id: 'qa2', pos: [-6, 0, 10], yaw: Math.PI / 3, team: 2 },
      { id: 'qa3', pos: [8, 0, -4], yaw: 0.4, team: 1 },
      { id: 'qa4', pos: [-3, 0, 16], yaw: -1, team: 2 },
    ];
    spawnBots.forEach((bot) => {
      const entity = { soldier: createSoldier(bot.team), pos: [...bot.pos], yaw: bot.yaw, hp: 100, alive: true, team: bot.team };
      entity.soldier.position.set(bot.pos[0], 0, bot.pos[2]);
      entity.soldier.rotation.y = bot.yaw + Math.PI / 2;
      game.scene.add(entity.soldier);
      game.remote.set(bot.id, entity);
    });
  }

  const unlock = () => {
    audio && audio.unlock && audio.unlock();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);

  $('#btn-play')?.addEventListener('click', () => {
    audio && audio.play && audio.play('click');
    game.start();
  });
  $('#btn-restart')?.addEventListener('click', () => game.start());

  window.__DUSTLINE__ = game;
  if (!cam) ui.showMenu();

  // Restore a saved session token in the background so returning players see their account.
  const savedToken = localStorage.getItem('dustline_token');
  if (!cam && savedToken) {
    if (!game.net) game.setupNet();
    game.sessionToken = savedToken;
    game.net.token = savedToken;
    game.net.authConnect().then(() => {
      game.net.restoreSession(savedToken);
    }).catch(() => {
      // server unreachable at boot — leave token for the next deploy attempt
    });
  }

  if (!cam) fetch('/update.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((update) => {
    if (!update || !update.latestVersion) return;
    const seen = localStorage.getItem('dustline_seen_version');
    if (seen !== update.latestVersion) {
      localStorage.setItem('dustline_seen_version', update.latestVersion);
      ui.showUpdate(update);
    }
  }).catch((error) => console.warn('[DUSTLINE] update check skipped', error.message));
  setBootProgress(100, 'READY', 'FIELD SYSTEMS ONLINE');
  await sleep(350);
  finishBoot();
}

const bootPromise = Promise.race([
  boot(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('BOOT TIMEOUT · LOCAL SERVER DID NOT RESPOND')), 20000)),
]).catch(failBoot);
window.__DUSTLINE_BOOT__ = bootPromise;
