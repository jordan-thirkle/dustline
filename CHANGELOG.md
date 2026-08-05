# DUSTLINE changelog

All notable changes to DUSTLINE are documented here.

## [0.3.0] — 2026-08-05

### Added

- Operative accounts: sign up / sign in / log out from the in-game menu, with session restore on reconnect.
- Postgres-backed account persistence via Fly Managed Postgres (`server/pgstore.js`), with a JSON file fallback for local dev.
- Match-result persistence: XP, stats, and score are written to the account at the end of every match.
- `server/auth.js` — scrypt password hashing and session tokens (30-day sessions).

### Fixed

- Combat crash: a missing `hx` reference in the tracer event crashed the server whenever a shot missed. Tracers now use the last ray direction.
- `Dockerfile.server` now copies `runtime-config.js` (was 404 in production).
- `PCFSoftShadowMap` deprecated in three r185 → `PCFShadowMap`.
- Signup response now includes the chosen username.
- `tools/test-modes.js` awaits the async `createServer` bootstrap.

### Operations

- Fly Managed Postgres provisioned and attached (`DATABASE_URL` secret on `dustline-server`).
- `GAME_SERVER_URL` repo variable set to the Fly endpoint for GitHub Pages cross-origin play.
- Removed stray Fly-generated `Dockerfile`/`.dockerignore` that conflicted with `Dockerfile.server`.

## [0.2.0] — 2026-08-05

### Added

- AAA-oriented byjtt.com splash and staged boot experience.
- Professional field-update modal with persistent changelog access.
- Explicit pointer capture/release and working WASD movement in normal play.
- Genex-inspired public play/remix/project-receipts portal.
- Player-safe boot recovery with retry and safe mode.
- Five selectable game modes: Team Deathmatch, Domination, Kill Confirmed, Search & Destroy, and Free For All.
- Persistent XP, levels, unlocks, loadouts, perks, killstreaks, chat, scoreboard, and match-end progression.
- Public progress portal with rendered frames, changelog, AI build archive, and play instructions.
- Machine-readable update manifest for in-game update notices.
- Deterministic QA pilot profile and CI mode checks.

### Fixed

- Localhost startup deadlock caused by registering the load event after an awaited module import.
- Missing UI initialization during client boot.
- Browser module resolution and Three.js vendor loading.
- Server and persistence timers that prevented clean test shutdown.
- Runtime account data accidentally being tracked by Git.

### Operations

- Added Docker and Fly.io server deployment scaffolding.
- Added GitHub Actions validation for syntax and all game modes.
- Added reusable hosting and scaling documentation.

## [0.1.0] — 2026-08-04

### Added

- Authoritative Node/WebSocket multiplayer server.
- Procedural Three.js environment, characters, weapons, effects, audio, and HUD.
- Bot-filled rooms and deterministic map collision contracts.
- Six procedural weapon families and a complete shared protocol.
- Sixteen Gauntlet Loop visual review rounds with independent critic feedback.

[0.2.0]: https://github.com/jordan-thirkle/dustline/compare/0.1.0...HEAD
[0.1.0]: https://github.com/jordan-thirkle/dustline/releases/tag/0.1.0
