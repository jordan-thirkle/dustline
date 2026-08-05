# DUSTLINE reusable game workflow

This is the operating contract for DUSTLINE and future byjtt.com browser games.

## Model routing

- **GPT-5.6 Luna:** main orchestrator, architecture, integration, design decisions, visual review, and any quality-critical work.
- **DeepSeek V4 Pro / MiMo V2.5 Pro:** only for mechanical, cache-heavy, repetitive, or bulk tasks when independently verified afterward.
- **Never use DeepSeek V4 Flash.**
- Model choice never replaces validation: every builder result requires tests or a fresh-context critic.

## Genex-inspired public project loop

Every game should be packaged as a live public project, not only a repository:

1. One-click playable browser URL.
2. Public project/portal page with title, current build, screenshots, play action, source, changelog, and build archive.
3. Remixable scaffold: shared contracts, run instructions, deployment files, and clear extension points.
4. Visible receipts: rendered frames, test results, progress history, and AI decisions.
5. Update discovery: machine-readable manifest plus an in-game release modal.
6. Reusable asset/process archive: what was generated, what was learned, and what future games can copy.

## Gauntlet Loop gates

1. Define the artifact and a concrete reference bar.
2. Split into independently judgeable systems.
3. Fan out builders with isolated file ownership.
4. Run automated checks immediately after each builder returns.
5. Run a separate fresh-context critic on the real output, not a summary.
6. Fix the critic's single highest-impact gap.
7. Capture a new screenshot or test artifact.
8. Repeat until the quality bar passes or the critic identifies a genuine asset-pipeline ceiling.
9. Run a smoothing pass across the complete product so independently improved pieces feel like one game.
10. Record the result in `CHANGELOG.md`, `progress.html`, and `ai-build-archive.md`.

## Required evidence per feature

- **Gameplay:** deterministic test, browser smoke test, and server logs or state assertion.
- **Visual:** real screenshot, viewport/device check, and independent critic verdict.
- **Live-service:** changelog entry, update manifest change, and in-game notice check.
- **Deployment:** local run, container/static validation, CI check, and health endpoint.
- **Public launch:** portal link, playable link, source link, screenshots, and rollback notes.

## Quality gates before calling a build ready

- Normal boot shows a real menu and never gets stuck on a fake progress bar.
- Deploy resolves only after authoritative server welcome/spawn.
- WASD, mouse capture, Esc release, fire, reload, and reconnect/retry are verified.
- All declared game modes initialize and run.
- Update modal and changelog are discoverable in-game.
- `npm run check` and `npm run test:modes` pass.
- `git status` is clean and the public remote is current.
- No runtime account data, secrets, screenshots, or browser profiles are committed.

## Current DUSTLINE surfaces

- Game: `/`
- Public portal: `/portal.html`
- Build progress: `/progress.html`
- Changelog: `/CHANGELOG.md`
- AI archive: `/ai-build-archive.md`
- Update manifest: `/update.json`
- Source: `https://github.com/jordan-thirkle/dustline`
