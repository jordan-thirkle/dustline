// DUSTLINE — client/audio.js
// 100% procedural WebAudio synthesis. No audio files, no external assets.
// Every sound is built from oscillators + noise buffers at call time.
//
// Usage (after the user gesture that unlocks audio):
//   AudioFX.init();
//   AudioFX.unlock();            // call on every click (resume-safe)
//   AudioFX.play('gunshot', { weapon: 'm4', pos: [x, y, z], distance: 60 });
//   AudioFX.play('footstep', { surface: 'concrete' });
//   AudioFX.setMuted(true); AudioFX.setVolume(0.8);
//   AudioFX.duckMusic(true);     // auto-restores after ~1.2s
//   AudioFX.setAmbient(true);    // wind + distant firefight
//
// All named 'sfx' sources go through the sfxBus -> compressor -> masterBus.
// The optional music/ambient buses duck underneath SFX during combat.

export const AudioFX = (() => {
  'use strict';

  const TAU = Math.PI * 2;
  const R = (a, b) => a + Math.random() * (b - a); // uniform
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  // ---- internal state (all lazily created) ----
  const state = {
    ctx: null,
    master: null,   // masterBus -> destination
    sfx: null,      // per-sfx volume bus
    music: null,    // ducked under sfx
    ambient: null,  // ducked under sfx
    comp: null,     // DynamicsCompressorNode
    compOn: true,
    muted: false,
    volume: 1,
    noiseBuf: null,
    noiseBuf2: null, // second noise buffer (decorrelated, for wind layer)
    unlocked: false,
    ambientOn: false,
    duckTimer: null,
    ducked: false,
    lastLeft: false,   // footstep alternate L/R
    lastShotAt: 0,     // shotgun pump cooldown
    lastGrenadeAt: 0,  // grenade bounce cooldown
    boltAt: 0,
    firefight: null,   // { timer, nextAt, timeout }
    windNodes: null,   // { src, filt, lfo, lfoGain }
  };

  // ---- noise buffers (shared) ----
  function ensureNoise() {
    const ctx = state.ctx;
    if (!ctx) return null;
    if (!state.noiseBuf) {
      const len = ctx.sampleRate * 2;
      state.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = state.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (!state.noiseBuf2) {
      const len = ctx.sampleRate * 1.5;
      state.noiseBuf2 = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = state.noiseBuf2.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return state.noiseBuf;
  }

  // 2s white-noise burst with a fast attack / exponential decay envelope.
  function noiseBurst(opts = {}) {
    const ctx = state.ctx;
    const buf = ensureNoise();
    const dur = opts.dur ?? 0.5;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    const g0 = opts.gain ?? 0.5;
    gain.gain.setValueAtTime(g0, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(g0 * 0.0006, 0.00001), t0 + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = opts.filterType ?? 'lowpass';
    filt.frequency.setValueAtTime(opts.freq ?? 4000, t0);
    if (opts.freqEnd != null) filt.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 40), t0 + dur);
    filt.Q.value = opts.Q ?? 0.8;
    src.connect(filt).connect(gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return { out: gain, t0, dur, stop: () => src.stop() };
  }

  // Stereo noise burst (for wide/moving sounds like sniper tail, UAV sweep).
  function noiseBurstStereo(opts = {}) {
    const ctx = state.ctx;
    const buf = ensureNoise();
    const dur = opts.dur ?? 0.4;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.4, t0);
    g.gain.exponentialRampToValueAtTime(Math.max((opts.gain ?? 0.4) * 0.0006, 0.00001), t0 + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(opts.freq ?? 2500, t0);
    if (opts.freqEnd != null) filt.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd, 60), t0 + dur);
    filt.Q.value = 0.6;
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(filt).connect(g);
    g.connect(p);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return { out: p, t0, dur };
  }

  // Tonal ping with a pitch glide (oscillator).
  function tone(opts) {
    const ctx = state.ctx;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.15;
    const type = opts.type ?? 'sine';
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 0.1), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(opts.gain ?? 0.3, 0.0001), t0 + (opts.attack ?? 0.004));
    gain.gain.exponentialRampToValueAtTime(Math.max((opts.gain ?? 0.3) * 0.001, 0.00001), t0 + dur);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return { out: gain, t0, dur };
  }

  // Short filtered noise "thud" — sub percussion, footsteps, impacts.
  function thud(opts = {}) {
    const ctx = state.ctx;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.12;
    const src = ctx.createBufferSource();
    src.buffer = ensureNoise();
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    const g0 = opts.gain ?? 0.3;
    gain.gain.setValueAtTime(g0, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(g0 * 0.001, 0.00001), t0 + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(opts.freq ?? 320, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(opts.freqEnd ?? opts.freq * 0.35, 50), t0 + dur);
    src.connect(filt).connect(gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = opts.pitch ?? 120;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f0 * 0.5, 30), t0 + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(Math.max(opts.body ?? 0.35, 0.0001), t0 + 0.005);
    og.gain.exponentialRampToValueAtTime(0.00001, t0 + dur);
    osc.connect(og);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return { out: gain, t0, dur };
  }

  // Small metallic "tick" (bouncing grenade, casing).
  function tick(opts = {}) {
    const ctx = state.ctx;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.05;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const f0 = opts.freq ?? 2600;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f0 * 0.6, 200), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(opts.gain ?? 0.12, 0.0001), t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.00001, t0 + dur);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return { out: gain, t0, dur };
  }

  // Quick band-passed noise "whoosh" with a downward sweep (melee, knife).
  function whoosh(opts = {}) {
    const ctx = state.ctx;
    const t0 = opts.t ?? ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.18;
    const src = ctx.createBufferSource();
    src.buffer = ensureNoise();
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(opts.gain ?? 0.35, 0.0001), t0 + (opts.attack ?? 0.03));
    gain.gain.exponentialRampToValueAtTime(0.00001, t0 + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.4;
    filt.frequency.setValueAtTime(opts.f0 ?? 1100, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(opts.f1 ?? 250, 40), t0 + dur);
    src.connect(filt).connect(gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return { out: gain, t0, dur };
  }

  // Distant gunshot: heavy lowpass (500Hz), extra low-frequency energy, reverb-like
  // smear via delayed noise taps. Used by the ambient firefight loop and the
  // low-volume far-gunshot variant of play().
  function distantGunshot(opts = {}) {
    const ctx = state.ctx;
    const t0 = opts.t ?? ctx.currentTime;
    const buf = ensureNoise();
    const body = noiseBurst({
      t: t0, dur: R(0.3, 0.5), gain: R(0.12, 0.3), freq: 480, freqEnd: 110, rate: R(0.8, 1.2),
    });
    const reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.4);
    }
    reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.22;
    body.out.connect(reverb);
    reverb.connect(rg);
    const sub = tone({ t: t0, dur: 0.3, type: 'sine', f0: 62, f1: 40, gain: 0.16, attack: 0.002 });
    return { out: [body.out, rg, sub.out], t0, dur: 0.7 };
  }

  // ---- routing helpers ----
  function duckSfx() {
    if (!state.ctx || !state.sfx) return;
    state.sfx.gain.cancelScheduledValues(state.ctx.currentTime);
    state.sfx.gain.setValueAtTime(state.sfx.gain.value, state.ctx.currentTime);
    state.sfx.gain.linearRampToValueAtTime(0.55, state.ctx.currentTime + 0.02);
    clearTimeout(state.duckTimer);
    state.duckTimer = setTimeout(() => {
      if (!state.ctx || !state.sfx) return;
      state.sfx.gain.cancelScheduledValues(state.ctx.currentTime);
      state.sfx.gain.setValueAtTime(state.sfx.gain.value, state.ctx.currentTime);
      state.sfx.gain.linearRampToValueAtTime(1, state.ctx.currentTime + 0.3);
    }, 900);
  }

  // ---- fireSound synth: gunshot per weapon class ----
  function gunshotAr(opts) {
    const g = opts.gain ?? 0.9;
    const n = noiseBurst({ dur: 0.09, gain: g * 0.9, freq: 5200, freqEnd: 480, Q: 0.9 });
    const crack = noiseBurst({ dur: 0.014, gain: g * 1.1, freq: 9000, freqEnd: 2200, filterType: 'highpass' });
    const body = tone({ dur: 0.08, type: 'sine', f0: 165, f1: 85, gain: g * 0.3 });
    return [n.out, crack.out, body.out];
  }
  function gunshotAk(opts) {
    const g = opts.gain ?? 1.0;
    const n = noiseBurst({ dur: 0.12, gain: g * 0.85, freq: 3400, freqEnd: 300, Q: 1.0 });
    const crack = noiseBurst({ dur: 0.02, gain: g * 1.0, freq: 5600, freqEnd: 1500, filterType: 'highpass' });
    const body = tone({ dur: 0.12, type: 'sine', f0: 130, f1: 60, gain: g * 0.4 });
    return [n.out, crack.out, body.out];
  }
  function gunshotSmg(opts) {
    const g = opts.gain ?? 0.85;
    const n = noiseBurst({ dur: 0.07, gain: g * 0.75, freq: 4200, freqEnd: 620, Q: 1.0 });
    const crack = noiseBurst({ dur: 0.012, gain: g * 0.8, freq: 6800, freqEnd: 2200, filterType: 'highpass' });
    const body = tone({ dur: 0.07, type: 'sine', f0: 190, f1: 100, gain: g * 0.25 });
    return [n.out, crack.out, body.out];
  }
  function gunshotLmg(opts) {
    const g = opts.gain ?? 1.05;
    const n = noiseBurst({ dur: 0.16, gain: g * 0.95, freq: 2600, freqEnd: 260, Q: 1.0 });
    const crack = noiseBurst({ dur: 0.022, gain: g * 1.05, freq: 5200, freqEnd: 1300, filterType: 'highpass' });
    const body = tone({ dur: 0.16, type: 'sine', f0: 110, f1: 50, gain: g * 0.45 });
    return [n.out, crack.out, body.out];
  }
  function gunshotSniper(opts) {
    const g = opts.gain ?? 1.2;
    const crack = noiseBurst({ dur: 0.03, gain: g * 1.0, freq: 7000, freqEnd: 1300, filterType: 'highpass' });
    const n = noiseBurst({ dur: 0.7, gain: g * 0.9, freq: 2400, freqEnd: 200, Q: 0.8 });
    const body = tone({ dur: 0.5, type: 'sine', f0: 92, f1: 34, gain: g * 0.6 });
    const tail = noiseBurstStereo({ dur: 0.4, gain: g * 0.3, freq: 900, freqEnd: 220, rate: 0.6 });
    return [crack.out, n.out, body.out, tail.out];
  }
  function gunshotShotgun(opts) {
    const g = opts.gain ?? 1.15;
    const boom = noiseBurst({ dur: 0.28, gain: g * 1.1, freq: 2100, freqEnd: 170, Q: 1.2 });
    const body = tone({ dur: 0.25, type: 'sine', f0: 96, f1: 38, gain: g * 0.65 });
    const crack = noiseBurst({ dur: 0.02, gain: g * 0.85, freq: 4600, freqEnd: 1700, filterType: 'highpass' });
    return [boom.out, body.out, crack.out];
  }
  function gunshotPistol(opts) {
    const g = opts.gain ?? 0.8;
    const crack = noiseBurst({ dur: 0.016, gain: g * 0.95, freq: 6500, freqEnd: 1600, filterType: 'highpass' });
    const n = noiseBurst({ dur: 0.07, gain: g * 0.55, freq: 3600, freqEnd: 520, Q: 1.0 });
    const body = tone({ dur: 0.06, type: 'sine', f0: 210, f1: 120, gain: g * 0.22 });
    return [crack.out, n.out, body.out];
  }
  function gunshotKnife(opts) {
    const g = opts.gain ?? 0.6;
    const w = whoosh({ dur: 0.16, gain: g * 0.5, f0: 2200, f1: 500, attack: 0.04 });
    const w2 = whoosh({ dur: 0.12, gain: g * 0.3, f0: 3600, f1: 1400, attack: 0.02, delay: 0.045 });
    return [w.out, w2.out];
  }

  const FIRESOUND = {
    ar: gunshotAr, ak: gunshotAk, smg: gunshotSmg, lmg: gunshotLmg,
    sniper: gunshotSniper, shotgun: gunshotShotgun, pistol: gunshotPistol, knife: gunshotKnife,
  };

  // ---- reload: small step sequencer ----
  function reloadAr(opts) {
    const seq = [0, 0.28, 0.58];
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const outs = [
      // mag out: a dull clunk with a soft ring
      thud({ t: t0, dur: 0.1, gain: 0.3, freq: 380, freqEnd: 140, pitch: 150, body: 0.4 }).out,
      tone({ t: t0, dur: 0.045, type: 'triangle', f0: 520, f1: 240, gain: 0.06 }).out,
      // mag in: heavier thunk + harder ring
      thud({ t: t0 + seq[1], dur: 0.11, gain: 0.4, freq: 420, freqEnd: 120, pitch: 110, body: 0.5 }).out,
      tone({ t: t0 + seq[1], dur: 0.06, type: 'triangle', f0: 340, f1: 160, gain: 0.05 }).out,
      // bolt rack: metallic clack, two quick ticks
      tick({ t: t0 + seq[2], dur: 0.035, freq: 2200, gain: 0.14 }).out,
      tick({ t: t0 + seq[2] + 0.05, dur: 0.05, freq: 1500, gain: 0.17 }).out,
    ];
    return outs;
  }
  function reloadSniper(opts) {
    const seq = [0, 0.6, 1.15];
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const outs = [
      tick({ t: t0, dur: 0.045, freq: 2500, gain: 0.15 }).out,
      thud({ t: t0 + 0.1, dur: 0.12, gain: 0.35, freq: 340, freqEnd: 120, pitch: 140, body: 0.45 }).out,
      tick({ t: t0 + seq[1], dur: 0.04, freq: 1800, gain: 0.13 }).out,
      tick({ t: t0 + seq[1] + 0.07, dur: 0.05, freq: 2400, gain: 0.16 }).out,
      thud({ t: t0 + seq[2], dur: 0.12, gain: 0.4, freq: 300, freqEnd: 100, pitch: 90, body: 0.5 }).out,
    ];
    return outs;
  }
  function reloadShotgun(opts) {
    const seq = [0, 0.42, 0.84, 1.26];
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const outs = [
      tick({ t: t0, dur: 0.05, freq: 1600, gain: 0.15 }).out,
      tick({ t: t0 + seq[1], dur: 0.05, freq: 2100, gain: 0.18 }).out,
      tick({ t: t0 + seq[2], dur: 0.05, freq: 2400, gain: 0.18 }).out,
      tick({ t: t0 + seq[3], dur: 0.07, freq: 1800, gain: 0.2 }).out,
    ];
    return outs;
  }
  function reloadDefault(opts) {
    const seq = [0, 0.32, 0.64];
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const outs = [
      thud({ t: t0, dur: 0.1, gain: 0.3, freq: 400, freqEnd: 150, pitch: 160, body: 0.35 }).out,
      thud({ t: t0 + seq[1], dur: 0.11, gain: 0.38, freq: 440, freqEnd: 130, pitch: 120, body: 0.45 }).out,
      tick({ t: t0 + seq[2], dur: 0.04, freq: 2600, gain: 0.14 }).out,
      tick({ t: t0 + seq[2] + 0.045, dur: 0.05, freq: 1700, gain: 0.16 }).out,
    ];
    return outs;
  }

  // ---- single sounds ----
  function footstep(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const surf = opts.surface ?? 'dirt';
    const left = state.lastLeft = !state.lastLeft;
    const pan = left ? -0.25 : 0.25;
    const p = state.ctx.createStereoPanner();
    p.pan.value = pan;
    const th = thud({
      t: t0, dur: 0.09, gain: 0.28, freq: 330, freqEnd: 120, pitch: 130, body: 0.3,
    });
    th.out.connect(p);
    if (surf === 'metal') {
      tick({ t: t0 + 0.01, dur: 0.03, freq: 2600, gain: 0.04 });
    } else if (surf === 'concrete') {
      const n = noiseBurst({ t: t0, dur: 0.05, gain: 0.05, freq: 1800, freqEnd: 700 });
      n.out.connect(p);
    }
    return p;
  }
  function jump(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const w = whoosh({ t: t0, dur: 0.14, gain: 0.1, f0: 900, f1: 350 });
    return w.out;
  }
  function land(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const th = thud({ t: t0, dur: 0.13, gain: 0.32, freq: 280, freqEnd: 90, pitch: 110, body: 0.35 });
    const n = noiseBurst({ t: t0 + 0.005, dur: 0.06, gain: 0.07, freq: 900, freqEnd: 300 });
    return [th.out, n.out];
  }
  function melee(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const w1 = whoosh({ t: t0, dur: 0.16, gain: 0.5, f0: 1500, f1: 280, attack: 0.05 });
    const w2 = whoosh({ t: t0 + 0.14, dur: 0.12, gain: 0.3, f0: 1000, f1: 300, attack: 0.03 });
    const th = thud({ t: t0 + 0.13, dur: 0.09, gain: 0.3, freq: 450, freqEnd: 150, pitch: 200, body: 0.3 });
    return [w1.out, w2.out, th.out];
  }
  function hitmarker(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t = tone({ t: t0, dur: 0.07, type: 'square', f0: 1150, f1: 900, gain: 0.05 });
    const t2 = tone({ t: t0 + 0.045, dur: 0.07, type: 'square', f0: 1750, f1: 1400, gain: 0.04 });
    return [t.out, t2.out];
  }
  function headshot(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t = tone({ t: t0, dur: 0.09, type: 'square', f0: 1650, f1: 1200, gain: 0.05 });
    const t2 = tone({ t: t0 + 0.05, dur: 0.09, type: 'square', f0: 2300, f1: 1750, gain: 0.045 });
    return [t.out, t2.out];
  }
  function killConfirm(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t1 = tone({ t: t0, dur: 0.12, type: 'square', f0: 660, f1: 620, gain: 0.05 });
    const t2 = tone({ t: t0 + 0.1, dur: 0.16, type: 'square', f0: 990, f1: 940, gain: 0.05 });
    return [t1.out, t2.out];
  }
  function damageTaken(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const th = thud({ t: t0, dur: 0.16, gain: 0.5, freq: 260, freqEnd: 80, pitch: 95, body: 0.55 });
    const n = noiseBurst({ t: t0 + 0.01, dur: 0.1, gain: 0.12, freq: 1400, freqEnd: 300 });
    return [th.out, n.out];
  }
  function explosion(opts) {
    const g = opts.gain ?? 1.0;
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const boom = noiseBurst({ t: t0, dur: 1.2, gain: g * 0.9, freq: 1900, freqEnd: 110, Q: 0.9 });
    const sub = tone({ t: t0, dur: 1.1, type: 'sine', f0: 70, f1: 24, gain: g * 0.8, attack: 0.003 });
    const dirt = noiseBurst({ t: t0 + 0.1, dur: 0.7, gain: g * 0.4, freq: 900, freqEnd: 150 });
    return [boom.out, sub.out, dirt.out];
  }
  function grenadeBounce(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const p = state.ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    const t1 = tick({ t: t0, dur: 0.04, freq: 2900, gain: 0.1 });
    const t2 = tick({ t: t0 + 0.07, dur: 0.04, freq: 2100, gain: 0.09 });
    const t3 = tick({ t: t0 + 0.16, dur: 0.045, freq: 1600, gain: 0.08 });
    t1.out.connect(p); t2.out.connect(p); t3.out.connect(p);
    return p;
  }
  function uav(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const o = tone({ t: t0, dur: 1.6, type: 'sawtooth', f0: 520, f1: 1040, gain: 0.035 });
    const f = state.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3.5;
    f.frequency.setValueAtTime(700, t0);
    f.frequency.exponentialRampToValueAtTime(2200, t0 + 1.6);
    o.out.disconnect();
    o.out.connect(f);
    return f;
  }
  function capture(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t1 = tone({ t: t0, dur: 0.11, type: 'triangle', f0: 392, f1: 392, gain: 0.05 });
    const t2 = tone({ t: t0 + 0.12, dur: 0.11, type: 'triangle', f0: 494, f1: 494, gain: 0.05 });
    const t3 = tone({ t: t0 + 0.24, dur: 0.11, type: 'triangle', f0: 587, f1: 587, gain: 0.05 });
    const t4 = tone({ t: t0 + 0.36, dur: 0.2, type: 'triangle', f0: 740, f1: 740, gain: 0.05 });
    return [t1.out, t2.out, t3.out, t4.out];
  }
  function deny(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t1 = tone({ t: t0, dur: 0.11, type: 'triangle', f0: 587, f1: 587, gain: 0.05 });
    const t2 = tone({ t: t0 + 0.12, dur: 0.11, type: 'triangle', f0: 494, f1: 494, gain: 0.05 });
    const t3 = tone({ t: t0 + 0.24, dur: 0.11, type: 'triangle', f0: 392, f1: 392, gain: 0.05 });
    const t4 = tone({ t: t0 + 0.36, dur: 0.2, type: 'triangle', f0: 311, f1: 311, gain: 0.05 });
    return [t1.out, t2.out, t3.out, t4.out];
  }
  function matchStart(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t1 = tone({ t: t0, dur: 0.3, type: 'triangle', f0: 98, f1: 98, gain: 0.16 });
    const t2 = tone({ t: t0 + 0.3, dur: 0.3, type: 'triangle', f0: 147, f1: 147, gain: 0.16 });
    const t3 = tone({ t: t0 + 0.6, dur: 0.55, type: 'triangle', f0: 196, f1: 196, gain: 0.16 });
    return [t1.out, t2.out, t3.out];
  }
  function matchEnd(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t1 = tone({ t: t0, dur: 0.3, type: 'triangle', f0: 196, f1: 196, gain: 0.16 });
    const t2 = tone({ t: t0 + 0.3, dur: 0.3, type: 'triangle', f0: 147, f1: 147, gain: 0.16 });
    const t3 = tone({ t: t0 + 0.6, dur: 0.55, type: 'triangle', f0: 98, f1: 92, gain: 0.16 });
    return [t1.out, t2.out, t3.out];
  }
  function levelUp(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const notes = [523, 659, 784, 1047];
    const outs = [];
    notes.forEach((f, i) => outs.push(tone({ t: t0 + i * 0.09, dur: 0.22, type: 'triangle', f0: f, f1: f, gain: 0.05 }).out));
    return outs;
  }
  function uiClick(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const t = tone({ t: t0, dur: 0.05, type: 'square', f0: 880, f1: 700, gain: 0.03 });
    return t.out;
  }
  function shotgunPump(opts) {
    const t0 = state.ctx.currentTime + (opts.delay ?? 0);
    const ck1 = tick({ t: t0, dur: 0.05, freq: 1900, gain: 0.14 });
    const ck2 = tick({ t: t0 + 0.14, dur: 0.05, freq: 2400, gain: 0.15 });
    const ck3 = tick({ t: t0 + 0.24, dur: 0.05, freq: 1400, gain: 0.13 });
    return [ck1.out, ck2.out, ck3.out];
  }

  const SFX = {
    gunshot: (opts) => {
      const id = (opts && (opts.weapon || opts.fireSound)) || 'm4';
      // accept either a weapon id ('m4') or a fireSound class ('ar')
      const base = WEAPON_SOUNDS[id] || (FIRESOUND[id] ? id : 'ar');
      const fn = FIRESOUND[base] || gunshotAr;
      const g = opts.gain ?? 1;
      const outs = fn({ gain: g });
      const t = state.ctx.currentTime;
      if (base === 'sniper') {
        state.boltAt = t + 0.8;
        tick({ t: t + 0.8, dur: 0.04, freq: 1900, gain: 0.08 });
        tick({ t: t + 0.9, dur: 0.05, freq: 1300, gain: 0.09 });
      }
      if (base === 'shotgun' && state.ctx.currentTime - state.lastShotAt > 1.2) {
        shotgunPump({ delay: 0.75 });
        state.lastShotAt = state.ctx.currentTime;
      }
      return outs;
    },
    reloadAr: reloadAr,
    reloadSniper: reloadSniper,
    reloadShotgun: reloadShotgun,
    reload: reloadDefault,
    footstep: footstep,
    jump: jump,
    land: land,
    melee: melee,
    hitmarker: hitmarker,
    headshot: headshot,
    killConfirm: killConfirm,
    damageTaken: damageTaken,
    explosion: explosion,
    grenadeBounce: grenadeBounce,
    uav: uav,
    capture: capture,
    deny: deny,
    matchStart: matchStart,
    matchEnd: matchEnd,
    levelUp: levelUp,
    uiClick: uiClick,
  };

  // map weapon id -> fireSound class (falls back to 'ar')
  const WEAPON_SOUNDS = {
    m4: 'ar', ak: 'ak', mp5: 'smg', m249: 'lmg', sniper: 'sniper',
    shotgun: 'shotgun', pistol: 'pistol', knife: 'knife',
  };

  // ---- ambient layer ----
  function startWind() {
    const ctx = state.ctx;
    if (state.windNodes || !state.ambient) return;
    const src = ctx.createBufferSource();
    src.buffer = state.noiseBuf2;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 430;
    filt.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // slow LFO modulating the wind's filter cutoff (gusts)
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(filt.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 0.05;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.015;
    lfo2.connect(lfo2Gain).connect(g.gain);
    src.connect(filt).connect(g);
    g.connect(state.ambient);
    src.start();
    lfo.start();
    lfo2.start();
    state.windNodes = { src, filt, g, lfo, lfoGain, lfo2, lfo2Gain };
  }

  function stopWind() {
    if (!state.windNodes) return;
    const ctx = state.ctx;
    const t = ctx.currentTime;
    const { src, filt, g, lfo, lfo2 } = state.windNodes;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.8);
    filt.frequency.setValueAtTime(40, t + 0.8);
    lfo.stop(t + 0.9);
    lfo2.stop(t + 0.9);
    src.stop(t + 0.9);
    state.windNodes = null;
  }

  // Distant firefight: periodic low-volume gunshots at randomized intervals,
  // with occasionally doubled shots (a "burst") for texture.
  function scheduleFirefight() {
    if (!state.ambientOn || !state.ctx) return;
    const ctx = state.ctx;
    const interval = R(1.8, 4.2);
    const timer = setTimeout(() => {
      if (!state.ambientOn || !state.ctx) { state.firefight = null; return; }
      const t0 = ctx.currentTime;
      const layer = distantGunshot({ t: t0 });
      const rout = state.ctx.createGain();
      rout.gain.value = 0.8;
      if (Array.isArray(layer.out)) layer.out.forEach((n) => n.connect(rout));
      else layer.out.connect(rout);
      rout.connect(state.ambient);
      if (Math.random() < 0.35) {
        const layer2 = distantGunshot({ t: t0 + 0.14 });
        if (Array.isArray(layer2.out)) layer2.out.forEach((n) => n.connect(rout));
        else layer2.out.connect(rout);
      }
      // some shots get a faint crack on top
      if (Math.random() < 0.45) {
        const crack = noiseBurst({ t: t0, dur: 0.05, gain: 0.02, freq: 4200, freqEnd: 1200, filterType: 'highpass' });
        crack.out.connect(state.ambient);
      }
      state.firefight = null;
      scheduleFirefight();
    }, interval * 1000);
    state.firefight = { timer, nextAt: ctx.currentTime + interval };
  }

  function stopFirefight() {
    if (state.firefight) {
      clearTimeout(state.firefight.timer);
      state.firefight = null;
    }
  }

  // ---- public API ----
  function init() {
    if (state.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    state.ctx = ctx;
    state.master = ctx.createGain();
    state.master.gain.value = 1;
    state.comp = ctx.createDynamicsCompressor();
    state.comp.threshold.value = -18;
    state.comp.knee.value = 20;
    state.comp.ratio.value = 4;
    state.comp.attack.value = 0.004;
    state.comp.release.value = 0.18;
    state.sfx = ctx.createGain();
    state.sfx.gain.value = 1;
    state.music = ctx.createGain();
    state.music.gain.value = 1;
    state.ambient = ctx.createGain();
    state.ambient.gain.value = 1;
    state.sfx.connect(state.comp);
    state.music.connect(state.comp);
    state.ambient.connect(state.comp);
    state.comp.connect(state.master);
    state.master.connect(ctx.destination);
    ensureNoise();
  }

  // Resume-safe unlock. Call on every click (browser gesture policy).
  function unlock() {
    if (!state.ctx) init();
    if (state.ctx && state.ctx.state === 'suspended') {
      state.ctx.resume().catch(() => {});
    }
    state.unlocked = true;
  }

  function setMuted(m) {
    state.muted = !!m;
    if (state.master) state.master.gain.value = state.muted ? 0 : state.volume;
  }

  function setVolume(v) {
    state.volume = clamp(v, 0, 1);
    if (state.master && !state.muted) state.master.gain.value = state.volume;
  }

  function setCompressor(on) {
    state.compOn = !!on;
    if (!state.ctx || !state.sfx) return;
    // detach everything first to avoid duplicate graph edges
    state.sfx.disconnect();
    state.music.disconnect();
    state.ambient.disconnect();
    if (state.comp) state.comp.disconnect();
    if (state.compOn) {
      state.sfx.connect(state.comp);
      state.music.connect(state.comp);
      state.ambient.connect(state.comp);
      state.comp.connect(state.master);
    } else {
      state.sfx.connect(state.master);
      state.music.connect(state.master);
      state.ambient.connect(state.master);
    }
  }

  function duckMusic(amount = 0.12, restoreMs = 1250) {
    duckMusicInternal(amount, restoreMs);
  }

  function play(name, opts) {
    if (!state.ctx) init();
    if (!state.ctx || state.muted) return;
    if (state.ctx.state === 'suspended') state.ctx.resume().catch(() => {});
    const fn = SFX[name];
    if (!fn) return;
    let gainMul = 1;
    if (opts && typeof opts.distance === 'number') {
      gainMul = Math.pow(clamp(opts.distance, 0, 160) / 160, 1.6);
    }
    const outs = fn(opts || {});
    const apply = (o) => {
      if (!o) return;
      o.connect(state.sfx);
      if (gainMul !== 1 && o.gain && typeof o.gain.setValueAtTime === 'function') {
        try { o.gain.setValueAtTime(o.gain.value * gainMul, state.ctx.currentTime); } catch (e) { /* ignore */ }
      }
    };
    if (Array.isArray(outs)) outs.forEach(apply);
    else apply(outs);
    if (opts && (opts.priority || name === 'gunshot')) duckSfx();
    if (name === 'gunshot' || name === 'explosion') duckMusic(0.12, 1250);
  }

  function playRandomStepwise(name, count, baseInterval, opts) {
    if (!state.ctx) init();
    if (!state.ctx || state.muted) return;
    if (state.ctx.state === 'suspended') state.ctx.resume().catch(() => {});
    const n = Math.max(1, Math.floor(count));
    const fn = SFX[name];
    if (!fn) return;
    for (let i = 0; i < n; i++) {
      const t = baseInterval * i + R(0, baseInterval * 0.2);
      const o = Object.assign({}, opts, { delay: ((opts && opts.delay) || 0) + t });
      const outs = fn(o);
      const apply = (node) => { if (node) node.connect(state.sfx); };
      if (Array.isArray(outs)) outs.forEach(apply);
      else apply(outs);
    }
  }

  function setAmbient(on) {
    state.ambientOn = !!on;
    if (!state.ctx) {
      if (!state.ambientOn) return;
      init();
      if (!state.ctx) return;
    }
    if (state.ambientOn) {
      startWind();
      if (!state.firefight) scheduleFirefight();
    } else {
      stopWind();
      stopFirefight();
    }
  }

  function duckMusicInternal(amount = 0.12, restoreMs = 1250) {
    if (!state.ctx) return;
    const t = state.ctx.currentTime;
    if (state.music) {
      state.music.gain.cancelScheduledValues(t);
      state.music.gain.setValueAtTime(state.music.gain.value, t);
      state.music.gain.linearRampToValueAtTime(amount, t + 0.05);
    }
    if (state.ambient) {
      state.ambient.gain.cancelScheduledValues(t);
      state.ambient.gain.setValueAtTime(state.ambient.gain.value, t);
      state.ambient.gain.linearRampToValueAtTime(amount, t + 0.05);
    }
    clearTimeout(state.duckTimer);
    state.duckTimer = setTimeout(() => {
      if (!state.ctx) return;
      const t2 = state.ctx.currentTime;
      if (state.music) {
        state.music.gain.cancelScheduledValues(t2);
        state.music.gain.setValueAtTime(state.music.gain.value, t2);
        state.music.gain.linearRampToValueAtTime(1, t2 + restoreMs / 1000);
      }
      if (state.ambient) {
        state.ambient.gain.cancelScheduledValues(t2);
        state.ambient.gain.setValueAtTime(state.ambient.gain.value, t2);
        state.ambient.gain.linearRampToValueAtTime(1, t2 + restoreMs / 1000);
      }
    }, restoreMs);
  }

  return {
    init,
    unlock,
    play,
    setMuted,
    setVolume,
    setCompressor,
    duckMusic,
    playRandomStepwise,
    setAmbient,
    fireSound: (name, opts) => { if (!state.ctx) init(); if (!state.ctx) return; const fn = FIRESOUND[name]; if (!fn) return; const outs = fn(opts || {}); if (Array.isArray(outs)) outs.forEach((o) => o && o.connect(state.sfx)); else if (outs) outs.connect(state.sfx); },
  };
})();
