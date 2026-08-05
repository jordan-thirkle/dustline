# Long-term hosting plan

## Recommended portfolio stack

- **Client and generated assets:** Cloudflare Pages backed by Cloudflare R2 for screenshots, replay files, generated content, and large assets.
- **Edge/API:** Cloudflare Workers for authentication, matchmaking requests, rate limits, feature flags, and API routing.
- **Authoritative realtime rooms:** Fly.io Machines, deployed regionally from `Dockerfile.server` using `fly.toml`.
- **Persistent profile/progression data:** Fly Managed Postgres for production. The current JSON store is local-development only.
- **Future dedicated-server scale:** Amazon GameLift Servers when measured concurrency, fleet placement, or regional operations justify it.

## DUSTLINE local run

```bash
node server/index.js
npm run dev
```

Open `http://localhost:4173`.

## Fly server deployment

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=... SESSION_SECRET=...
fly deploy
```

Do not deploy the JSON account store as the production source of truth. Move `Persistence` behind a Postgres repository before public accounts, purchases, ranked state, or moderation data are enabled.

## Cloudflare Pages

Deploy the repository root as a static site. The current client uses an import map and does not need a build step. Configure the production WebSocket endpoint through a runtime configuration module before publishing a public client; local development currently targets the same host on port `3000`.

## Scaling milestones

1. Single Fly region, one always-on Machine, Postgres, and Pages.
2. Add a matchmaking Worker and a room-allocation service.
3. Add regional Fly Machines and route players to the lowest-latency region.
4. Add Redis-compatible presence/rate-limit state only when metrics show Postgres is not the right hot path.
5. Evaluate GameLift for large session fleets and automated placement.

## Operational requirements before public launch

- Database-backed profiles with migrations and backups.
- Authentication and device/account linking.
- Rate limits and abuse controls at the Worker and WebSocket boundary.
- Structured logs, error tracking, latency metrics, room occupancy, tick drift, and disconnect reasons.
- Health endpoint checks and rolling deploys.
- Automated browser smoke test and server mode test in CI.
