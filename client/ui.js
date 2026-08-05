// DUSTLINE UI module — DOM HUD, menus, loadout editor, scoreboard, match-end
// + XP screens, killstreak bar, chat, settings. Pure DOM; no three import.
// API consumed by client/game.js and src/main.js (see signatures at bottom).

const $ = (s) => document.querySelector(s);

export const UI = {
  initialized: false,
  scoreboardOpen: false,
  chatOpen: false,
  loadout: { primary: 'm4', secondary: 'pistol', perks: [] },
  settings: {
    volume: 0.8, sensitivity: 1.0, fov: 75, quality: 'high',
    crosshair: '#ffffff', damageNumbers: true, motionBlur: false, invertY: false,
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.build();
    this.bind();
  },

  build() {
    // ensure containers exist
    const app = $('#app');
    // Menu already in index.html; add loadout + settings + scoreboard + chat + killstreak panels
    const menu = $('#menu');
    if (menu) {
      // Loadout section
      const loadoutSec = document.createElement('div');
      loadoutSec.id = 'loadout-panel';
      loadoutSec.className = 'panel hidden';
      loadoutSec.innerHTML = `
        <div class="panel-title">LOADOUT</div>
        <div class="loadout-cols">
          <div class="col"><div class="col-head">PRIMARY</div><div id="primary-grid" class="wgrid"></div></div>
          <div class="col"><div class="col-head">SECONDARY</div><div id="secondary-grid" class="wgrid"></div></div>
        </div>
        <div class="col-head" style="margin-top:14px">PERKS</div>
        <div id="perk-grid" class="perk-grid"></div>
        <button class="btn small" id="btn-loadout-done">BACK</button>
      `;
      menu.appendChild(loadoutSec);

      // Settings section
      const settingsSec = document.createElement('div');
      settingsSec.id = 'settings-panel';
      settingsSec.className = 'panel hidden';
      settingsSec.innerHTML = `
        <div class="panel-title">SETTINGS</div>
        <div class="set-row"><label>Volume</label><input type="range" id="set-volume" min="0" max="100" value="80"></div>
        <div class="set-row"><label>Sensitivity</label><input type="range" id="set-sens" min="10" max="300" value="100"></div>
        <div class="set-row"><label>FOV</label><input type="range" id="set-fov" min="50" max="110" value="75"></div>
        <div class="set-row"><label>Quality</label><select id="set-quality"><option>low</option><option>med</option><option selected>high</option><option>ultra</option></select></div>
        <div class="set-row"><label>Damage numbers</label><input type="checkbox" id="set-dmg" checked></div>
        <div class="set-row"><label>Invert Y</label><input type="checkbox" id="set-invy"></div>
        <button class="btn small" id="btn-settings-done">BACK</button>
      `;
      menu.appendChild(settingsSec);
    }

    // Scoreboard
    if (!$('#scoreboard')) {
      const sb = document.createElement('div');
      sb.id = 'scoreboard';
      sb.className = 'overlay hidden';
      sb.innerHTML = `
        <div class="sb-head"><span id="sb-mode"></span><span id="sb-time"></span><span id="sb-map"></span></div>
        <div class="sb-cols"><div id="sb-list" class="sb-list"></div></div>
      `;
      document.body.appendChild(sb);
    }

    // Chat
    if (!$('#chat')) {
      const chat = document.createElement('div');
      chat.id = 'chat';
      chat.className = 'hidden';
      chat.innerHTML = `
        <div id="chat-log" class="chat-log"></div>
        <input id="chat-input" type="text" maxlength="140" placeholder="Message...">
      `;
      document.body.appendChild(chat);
    }

    // Killstreak bar
    if (!$('#streakbar')) {
      const kb = document.createElement('div');
      kb.id = 'streakbar';
      kb.innerHTML = `
        <div class="streak-label" id="streak-label"></div>
        <div class="streak-track"><div class="streak-fill" id="streak-fill"></div></div>
        <div class="streak-callouts">
          <span data-cost="4">UAV</span><span data-cost="6">CARE</span><span data-cost="8">NAPALM</span><span data-cost="10">GUNSHIP</span>
        </div>
      `;
      document.body.appendChild(kb);
    }

    // Connection status
    if (!$('#conn')) {
      const c = document.createElement('div');
      c.id = 'conn';
      c.className = 'hidden';
      document.body.appendChild(c);
    }
  },

  bind() {
    const btnPlay = $('#btn-play');
    if (btnPlay) btnPlay.addEventListener('click', () => { /* game.start handled by main */ });
    const btnRestart = $('#btn-restart');
    if (btnRestart) btnRestart.addEventListener('click', () => { /* handled */ });

    // loadout
    const btnLoadout = $('#btn-loadout');
    if (btnLoadout) btnLoadout.addEventListener('click', () => this.togglePanel('loadout'));
    const btnLoadoutDone = $('#btn-loadout-done');
    if (btnLoadoutDone) btnLoadoutDone.addEventListener('click', () => this.togglePanel('loadout'));

    // settings
    const btnSettings = $('#btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', () => this.togglePanel('settings'));
    const btnSettingsDone = $('#btn-settings-done');
    if (btnSettingsDone) btnSettingsDone.addEventListener('click', () => this.togglePanel('settings'));

    // settings inputs
    const bindRange = (id, key, fn) => {
      const el = $(id);
      if (el) el.addEventListener('input', () => {
        if (el.id === 'set-fov') this.settings.fov = parseFloat(el.value);
        else if (el.id === 'set-sens') this.settings.sensitivity = parseFloat(el.value) / 100;
        else if (el.id === 'set-volume') this.settings.volume = parseFloat(el.value) / 100;
        fn && fn(this.settings);
        this.bindSettings && this.bindSettings();
      });
    };
    bindRange('#set-volume', 'volume');
    bindRange('#set-sens', 'sensitivity');
    bindRange('#set-fov', 'fov');
    const q = $('#set-quality'); if (q) q.addEventListener('change', () => { this.settings.quality = q.value; this.bindSettings && this.bindSettings(); });
    const dmg = $('#set-dmg'); if (dmg) dmg.addEventListener('change', () => { this.settings.damageNumbers = dmg.checked; this.bindSettings && this.bindSettings(); });
    const invy = $('#set-invy'); if (invy) invy.addEventListener('change', () => { this.settings.invertY = invy.checked; this.bindSettings && this.bindSettings(); });

    // mode select
    const modeSel = $('#mode-select');
    if (modeSel) {
      modeSel.value = localStorage.getItem('dustline_mode') || 'tdm';
      modeSel.addEventListener('change', () => {
        localStorage.setItem('dustline_mode', modeSel.value);
        this.mode = modeSel.value;
      });
    }

    // scoreboard toggle (Tab handled by game.js; this is display only)
    // chat Enter
    const chatInput = $('#chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim()) {
          this.onChatSend && this.onChatSend(chatInput.value.trim());
          chatInput.value = '';
          this.closeChat();
        }
        if (e.key === 'Escape') this.closeChat();
      });
    }
  },

  togglePanel(which) {
    const panel = $('#' + which + '-panel');
    const menu = $('#menu');
    if (!panel) return;
    const isOpen = !panel.classList.contains('hidden');
    // close all panels
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    if (!isOpen) {
      panel.classList.remove('hidden');
      if (which === 'loadout') this.renderLoadout();
      if (menu) menu.querySelector('.title').classList.add('hidden');
    } else {
      if (menu) menu.querySelector('.title').classList.remove('hidden');
    }
  },

  // ---- loadout ----
  setWeaponList(primary, secondary, unlocked, current, onSelect) {
    this.weaponList = { primary, secondary, unlocked, current, onSelect };
    this.renderLoadout();
  },

  renderLoadout() {
    if (!this.weaponList) return;
    const { primary, secondary, unlocked, current } = this.weaponList;
    const gridP = $('#primary-grid');
    const gridS = $('#secondary-grid');
    const perkGrid = $('#perk-grid');
    if (!gridP || !gridS) return;
    gridP.innerHTML = '';
    gridS.innerHTML = '';
    const render = (grid, list, slot) => {
      list.forEach((id) => {
        const locked = !unlocked.includes(id);
        const btn = document.createElement('button');
        btn.className = 'wbtn' + (locked ? ' locked' : '') + (current[slot] === id ? ' sel' : '');
        btn.innerHTML = `<span class="wname">${id.toUpperCase()}</span>${locked ? '<span class="wlock">LVL ' + (this.lockLevels[id] || '?') + '</span>' : ''}`;
        btn.addEventListener('click', () => {
          if (locked) return;
          this.loadout[slot] = id;
          this.renderLoadout();
          this.weaponList.onSelect && this.weaponList.onSelect({ ...this.loadout });
        });
        grid.appendChild(btn);
      });
    };
    render(gridP, primary, 'primary');
    render(gridS, secondary, 'secondary');
    // perks
    if (perkGrid) {
      perkGrid.innerHTML = '';
      ['flak', 'ghost', 'dexterity', 'tracker'].forEach((pid) => {
        const b = document.createElement('button');
        const active = this.loadout.perks.includes(pid);
        b.className = 'pbtn' + (active ? ' sel' : '');
        b.textContent = pid.toUpperCase();
        b.addEventListener('click', () => {
          this.loadout.perks = active ? this.loadout.perks.filter(x => x !== pid) : [...this.loadout.perks, pid];
          this.renderLoadout();
          this.weaponList.onSelect && this.weaponList.onSelect({ ...this.loadout });
        });
        perkGrid.appendChild(b);
      });
    }
  },

  // ---- HUD ----
  showHUD() { $('#hud').classList.remove('hidden'); $('#menu').classList.add('hidden'); },
  hideHUD() { $('#hud').classList.add('hidden'); },
  showMenu() { $('#menu').classList.remove('hidden'); },
  hideMenu() { $('#menu').classList.add('hidden'); },
  showLoading(pct) { const b = $('#loadbar'); if (b) b.style.width = Math.min(100, pct) + '%'; },
  hideLoading() { const l = $('#loading'); if (l) l.style.opacity = '0'; setTimeout(() => l && l.remove(), 500); },

  updateHUD(state) {
    const hp = $('#hp-fill'), hpN = $('#hp-num'), ap = $('#ap-fill'), apN = $('#ap-num');
    if (hp) { hp.style.width = state.hp + '%'; hp.classList.toggle('low', state.hp < 35); }
    if (hpN) hpN.textContent = Math.ceil(state.hp);
    if (ap) ap.style.width = state.ap + '%';
    if (apN) apN.textContent = Math.ceil(state.ap);
    const mag = $('#mag'), res = $('#reserve'), gun = $('#gunname');
    if (mag) { mag.textContent = state.mag; mag.parentElement.classList.toggle('low', state.mag <= 10 && state.mag > 0); }
    if (res) res.textContent = state.reserve;
    if (gun) gun.textContent = state.weaponName;
    // crosshair spread
    const ch = $('#crosshair');
    if (ch) ch.style.setProperty('--spread', (state.crosshairSpread || 4) + 'px');
    // objective
    const obj = $('#objective');
    if (obj) obj.textContent = state.objective || 'HOLD THE LINE';
    // wave/round
    if (state.waveOrRound) { const w = $('#wave-text'); if (w) w.textContent = state.waveOrRound; }
    // killstreak HUD
    const ks = state.killstreak || 0;
    const streakLabel = $('#streak-label');
    const streakFill = $('#streak-fill');
    if (streakLabel) {
      if (ks >= 2) streakLabel.textContent = ks + ' KILL STREAK';
      else streakLabel.textContent = '';
    }
    if (streakFill) streakFill.style.width = Math.min(100, (ks / 10) * 100) + '%';
    document.querySelectorAll('.streak-callouts span').forEach((el) => {
      const cost = parseInt(el.dataset.cost || '0', 10);
      el.classList.toggle('lit', ks >= cost);
    });
  },

  hitmarker(kind) {
    const hm = $('#hitmarker');
    if (!hm) return;
    hm.style.opacity = '1';
    hm.classList.remove('kind-head', 'kind-kill');
    if (kind === 'head') hm.classList.add('kind-head');
    if (kind === 'kill') hm.classList.add('kind-kill');
    hm.style.transform = 'translate(-50%,-50%) scale(1.3)';
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => {
      hm.style.opacity = '0';
      hm.style.transform = 'translate(-50%,-50%) scale(1)';
    }, 160);
  },

  damageFlash(intensity) {
    const d = $('#damage');
    if (!d) return;
    d.classList.add('hit');
    clearTimeout(this._dfT);
    this._dfT = setTimeout(() => d.classList.remove('hit'), 120);
  },

  killfeedEntry({ killer, victim, weapon, headshot }) {
    const kf = $('#killfeed');
    if (!kf) return;
    const el = document.createElement('div');
    el.className = 'kill-item';
    const wname = (weapon || '').toUpperCase();
    el.innerHTML = `<span>${killer}</span> <b>${headshot ? '☠' : '✕'}</b> <span class="vic">${victim}</span> ${wname}`;
    kf.appendChild(el);
    while (kf.children.length > 5) kf.removeChild(kf.firstChild);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
  },

  scorePop(text, x, y, kind) {
    if (!this.settings.damageNumbers) return;
    const sp = $('#scorepop');
    if (!sp) return;
    const el = document.createElement('div');
    el.className = 'pop' + (kind ? ' pop-' + kind : '');
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.left = (x * 100) + '%';
    el.style.top = (y * 100) + '%';
    sp.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  },

  setCompass(yaw, headingDeg, pings) {
    const c = $('#compass');
    if (!c) return;
    // rotate tick marks: simple 8-tick compass
    c.innerHTML = '';
    const deg = headingDeg || 0;
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = -3; i <= 3; i++) {
      const t = document.createElement('div');
      t.className = 'tick' + (i === 0 ? ' major' : '');
      const pos = ((i * 30) % 360 + 360) % 360;
      const angle = deg - pos;
      const x = 190 + (angle * 1.2);
      t.style.left = x + 'px';
      c.appendChild(t);
    }
  },

  setMinimap(players, flags, you) {
    // canvas radar
    let mm = $('#minimap');
    if (!mm) {
      mm = document.createElement('canvas');
      mm.id = 'minimap';
      mm.width = 160; mm.height = 160;
      document.body.appendChild(mm);
    }
    const g = mm.getContext('2d');
    g.clearRect(0, 0, 160, 160);
    g.fillStyle = 'rgba(16,15,13,0.7)';
    g.fillRect(0, 0, 160, 160);
    g.strokeStyle = 'rgba(214,198,168,0.3)';
    g.strokeRect(0.5, 0.5, 159, 159);
    const scale = 160 / 130;
    const cx = you ? you.x : 0, cz = you ? you.z : 0;
    const px = (x) => 80 + (x - cx) * scale;
    const pz = (z) => 80 + (z - cz) * scale;
    (players || []).forEach((p) => {
      if (p.isYou) {
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(80, 80, 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.beginPath(); g.arc(80, 80, 8, 0, Math.PI * 2); g.stroke();
      } else {
        g.fillStyle = p.team === 2 ? '#7fae6a' : '#c2452c';
        g.beginPath(); g.arc(px(p.x), pz(p.z), 2.5, 0, Math.PI * 2); g.fill();
      }
    });
    (flags || []).forEach((f) => {
      const fx = px(f.x), fz = pz(f.z);
      if (fx < -10 || fx > 170 || fz < -10 || fz > 170) return;
      g.fillStyle = f.team === 2 ? '#7fae6a' : f.team === 1 ? '#c2452c' : '#999';
      g.fillRect(fx - 2, fz - 2, 4, 4);
      g.font = '8px sans-serif';
      g.fillText(f.id, fx + 3, fz + 3);
    });
  },

  setScoreboard(rows, mode, timeLeft) {
    const sb = $('#scoreboard');
    if (!sb) return;
    const modeEl = $('#sb-mode'), timeEl = $('#sb-time'), list = $('#sb-list');
    if (modeEl) modeEl.textContent = (mode || '').toUpperCase();
    if (timeEl) timeEl.textContent = timeLeft ? Math.ceil(timeLeft) + 's' : '';
    if (list) {
      list.innerHTML = '';
      const sorted = [...rows].sort((a, b) => b.score - a.score);
      const head = document.createElement('div');
      head.className = 'sb-row head';
      head.innerHTML = `<span>NAME</span><span>K</span><span>D</span><span>SCORE</span><span>PING</span>`;
      list.appendChild(head);
      sorted.forEach((r) => {
        const el = document.createElement('div');
        el.className = 'sb-row' + (r.isYou ? ' you' : '');
        el.innerHTML = `<span>${r.name}</span><span>${r.kills}</span><span>${r.deaths}</span><span>${r.score}</span><span>${r.ping}</span>`;
        list.appendChild(el);
      });
    }
  },

  toggleScoreboard(open) {
    const sb = $('#scoreboard');
    if (!sb) return;
    this.scoreboardOpen = open !== undefined ? open : !this.scoreboardOpen;
    sb.classList.toggle('hidden', !this.scoreboardOpen);
  },

  showMatchEnd(result) {
    const ss = $('#scorescreen');
    if (!ss) return;
    ss.classList.add('show');
    const title = $('#ss-title');
    if (title) title.textContent = result.winner ? result.winner.toUpperCase() + ' WINS' : 'MATCH OVER';
    const wave = $('#ss-wave');
    if (wave) wave.innerHTML = `<b>${result.mode.toUpperCase()}</b> · <b>${result.map.toUpperCase()}</b>`;
    const kills = $('#ss-kills');
    const me = (result.stats || []).find(s => s.id === result.myId);
    if (kills) kills.textContent = `KILLS ${me ? me.kills : 0} · DEATHS ${me ? me.deaths : 0} · SCORE ${me ? me.score : 0}`;
    const acc = $('#ss-acc');
    if (acc && result.mvp) acc.textContent = `MVP ${result.mvp.name} — ${result.mvp.kills} KILLS`;
    // XP panel
    if (result.xp) this.showXpBreakdown(result.xp);
  },

  showXpBreakdown(xp) {
    const ss = $('#scorescreen');
    if (!ss) return;
    let el = $('#xp-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'xp-panel';
      ss.appendChild(el);
    }
    el.innerHTML = `
      <div class="xp-title">LEVEL ${xp.level || 1}</div>
      <div class="xp-bar"><div class="xp-fill" style="width:${Math.min(100, (xp.xpInLevel || 0) / (xp.xpForNext || 1) * 100)}%"></div></div>
      <div class="xp-detail">+${xp.gained || 0} XP THIS MATCH</div>
      ${(xp.unlocks || []).length ? '<div class="xp-unlock">UNLOCKED: ' + xp.unlocks.map(u => u.toUpperCase()).join(', ') + '</div>' : ''}
    `;
  },

  levelUp(xp) {
    const ss = $('#scorescreen');
    if (ss && ss.classList.contains('show')) return this.showXpBreakdown(xp);
    this.showToast('LEVEL ' + (xp.level || 1) + ' — +' + xp.gained + ' XP');
    if (xp.unlocks && xp.unlocks.length) {
      setTimeout(() => this.showToast('UNLOCKED: ' + xp.unlocks.map(u => u.toUpperCase()).join(', ')), 1200);
    }
  },

  chatAdd({ from, text }) {
    const log = $('#chat-log');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'chat-line';
    el.innerHTML = `<b>${from}:</b> ${text}`;
    log.appendChild(el);
    while (log.children.length > 30) log.removeChild(log.firstChild);
  },

  openChat() {
    const chat = $('#chat');
    if (!chat) return;
    chat.classList.remove('hidden');
    this.chatOpen = true;
    const inp = $('#chat-input');
    if (inp) inp.focus();
  },
  closeChat() {
    const chat = $('#chat');
    if (chat) chat.classList.add('hidden');
    this.chatOpen = false;
  },
  isChatOpen() { return this.chatOpen; },

  setConnection(status) {
    const c = $('#conn');
    if (!c) return;
    c.className = 'conn-' + status;
    c.textContent = status.toUpperCase();
    c.classList.remove('hidden');
  },

  showToast(text) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2500);
  },

  roomUpdate(room) {
    this.showToast('ROOM ' + room.code + ' — ' + room.players.length + ' PLAYERS');
  },

  getLoadout() { return { ...this.loadout }; },
  getSettings() { return { ...this.settings }; },
  setSettings(s) { if (s) Object.assign(this.settings, s); },
  onChatSend: null,
  lockLevels: { m4: 1, pistol: 1, knife: 1, mp5: 3, shotgun: 5, ak: 8, m249: 12, sniper: 16 },
};
