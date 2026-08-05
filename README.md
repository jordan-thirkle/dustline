# DUSTLINE

A sun-baked military skirmish FPS built with **Three.js**, developed via the **Gauntlet Loop** (split → build → judge with a harsh independent critic → repeat against a real Call of Duty bar).

Play it: `npm run dev` (serves at http://localhost:4173) — server on :3000.

## Run

```bash
# terminal 1 — game server (authoritative sim, rooms, bots, XP, persistence)
node server/index.js

# terminal 2 — static web server
npm run dev
```

Open http://localhost:4173, click **DEPLOY**, and fight a full bot match. Multiplayer rooms, loadouts, XP/levels/unlocks, and 5 modes (TDM / Domination / Kill Confirmed / Search & Destroy / Free For All) are wired.

## Architecture

- **shared/** — single source of truth: math, protocol (WS messages), movement (client+server identical), weapons, progression (XP curve, unlocks, prestige), modes, map data (AABBs + visuals from one file).
- **server/** — authoritative 30Hz sim (Node + ws): physics, hitscan, damage, bots, mode scoring, XP, JSON persistence (`server/data/accounts.json`). Rooms fill to 8 simulated players so matches start solo.
- **client/** — Three.js renderer (sun rig, contact shadows, procedural pavement/grime/materials), viewmodel (procedural M4/AK/MP5/M249/shotgun/sniper with construction cues), characters, FX (pooled particles, all procedural), audio (100% WebAudio synth), networking (prediction + interpolation), UI (HUD, loadout, scoreboard, chat, settings, XP screens).
- **src/main.js** — client boot + wiring.
- **tools/** — `cdp-shot.js` headless-Chrome screenshot harness (the gauntlet critic's eyes), `shot.js`.

## Public project workflow

DUSTLINE follows `WORKFLOW.md`, combining a Genex-inspired public project surface with the Gauntlet Loop: build in parallel, publish receipts, judge real output independently, and iterate.

## The Gauntlet Loop (how this was built)

1. **Goal + bar**: match a real Call of Duty frame, blind A/B.
2. **Split**: smallest independently-judgeable pieces (lighting, ground, weapons, props, characters, HUD).
3. **Build + judge**: builders fan out; a separate harsh critic (`visual-critic` agent, fresh context, vision-capable) grades real rendered pixels and returns surgical work orders.
4. **Repeat** until the critic passes frames. See `.commandcode/agents/visual-critic.md`.

## Model mix (cost-optimal)

- **gpt-5.6-luna** — session + all quality work (frontier reasoning + vision, 50% off).
- **deepseek-v4-pro** — cache-heavy bulk loops (75% off).
- **mimo-v2.5-pro** — mechanical bulk work (99% off, permanent).
- Never deepseek-v4-flash.

## Screenshot QA

```bash
node tools/cdp-shot.js --cam=plaza   # captures shots/plaza.png, reports console errors
# cams: plaza alley market tower gun
```

The critic reads these PNGs and grades them. Iterate until it stops failing.
