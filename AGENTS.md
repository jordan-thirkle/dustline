# DUSTLINE project conventions

## Model mix (cost-optimal — always)
- gpt-5.6-luna for the session and ALL quality-critical work (frontier reasoning + vision, 50% off).
- deepseek-v4-pro (75% off) or mimo-v2.5-pro (99% off) ONLY for cache-heavy or mechanical bulk sub-agent loops.
- Never use deepseek-v4-flash.

## Gauntlet Loop rules
- Every visual system is judged by a SEPARATE harsh critic with fresh context (agent: visual-critic).
- The critic grades REAL rendered pixels from tools/cdp-shot.js screenshots — never a builder's summary.
- Blind A/B against real Call of Duty frames. If ours loses, fix the single biggest gap and re-run.
- Builders never grade their own work.

## Code rules
- shared/ is the single source of truth — server and client import from it, never redefine.
- All assets procedural (canvas textures + geometry); no external files.
- AABBs from shared/map.js are the collision truth — visuals must stay within them.
- ESM with .js extensions everywhere. Static server (python http.server), no bundler — import map maps 'three' to /vendor/three.module.js.

## Workflow
- Read `WORKFLOW.md` before multi-file game, UI, deployment, or public-launch work.
- Combine Genex-inspired public project packaging with the Gauntlet Loop: playable URL, source/remix scaffold, visible receipts, independent critic, and repeated evidence-backed iteration.
- Run the server + static server, capture screenshots with node tools/cdp-shot.js --cam=<view>, feed to critic, iterate.
- Keep the client/server data contracts in shared/protocol.js in sync.
