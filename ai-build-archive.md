# DUSTLINE AI build archive

This archive records the reusable process, decisions, and assets gathered while building DUSTLINE with Command Code.

## Method

- **Gauntlet Loop:** split the work into independently judgeable systems, build in parallel, inspect real rendered pixels with a fresh critic, and iterate against a hard reference bar.
- **Quality bar:** grounded modern military-shooter presentation, compared against real Call of Duty frames.
- **Aesthetic constraint:** no neon, purple, glow abuse, or generic AI-game styling.
- **Model workflow:** GPT-5.6 Luna for orchestration and quality-critical review; discounted models only for mechanical bulk work; never DeepSeek V4 Flash.

## Reusable systems

- Shared WebSocket protocol and message contracts.
- Shared player movement and collision math.
- Data-driven weapons, progression, perks, killstreaks, modes, and maps.
- Procedural Three.js renderer with sun, fog, materials, structures, and props.
- Procedural character, weapon viewmodel, particles, audio, and HUD systems.
- Deterministic CDP screenshot harness for visual QA.
- Local QA profile seed and mode simulation checks.
- Public progress page and machine-readable update manifest.

## Review history

Sixteen visual review rounds were run. The independent critic repeatedly identified material response, contact grounding, shadow coherence, silhouette hierarchy, and weapon integration as the remaining AAA gaps. The project is now a playable, scalable prototype with an honest record of where a real PBR asset pipeline is still required.

## Future reuse

For future games, copy the following patterns rather than the game-specific content:

1. `shared/protocol.js`, `shared/modes.js`, and `shared/progression.js` as contracts.
2. `tools/test-modes.js` and `tools/cdp-shot.js` as QA primitives.
3. `CHANGELOG.md`, `update.json`, `progress.html`, and this archive as live-service documentation surfaces.
4. `Dockerfile.server`, `fly.toml`, and `docs-hosting.md` as deployment starting points.
5. The boot state machine in `src/main.js` as the reusable startup/recovery shell.
