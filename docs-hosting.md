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

## Same-origin playtest deployment

The production entrypoint is `server/static.js`. It serves the client, portal, changelog, update manifest, and WebSocket game server from one HTTPS origin. This is the easiest first public playtest because the browser automatically uses `wss://<host>` and no separate client endpoint configuration is needed.

### Render

The checked-in `render.yaml` is a one-service deployment definition:

1. Open Render and create a Blueprint from this GitHub repository.
2. Select `render.yaml`.
3. Deploy the `dustline-playtest` web service.
4. Open the generated `https://...onrender.com` URL.

The same service handles static files and WebSockets. Upgrade from the starter plan before public traffic or long idle sessions.

### Fly.io

Use `fly.toml` with the same `Dockerfile.server`:

```bash
fly launch --no-deploy
fly deploy
```

## Fly server deployment

```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=... SESSION_SECRET=...
fly deploy
```

Do not deploy the JSON account store as the production source of truth. Move `Persistence` behind a Postgres repository before public accounts, purchases, ranked state, or moderation data are enabled.

## Free public playtest: Koyeb + GitHub Pages

This is the lowest-cost public route for the current prototype.

### Koyeb Free

1. Create a Koyeb account and connect `jordan-thirkle/dustline`.
2. Deploy from `koyeb.yaml`, or create a Web Service from the repository using `Dockerfile.server`.
3. Use the generated Koyeb HTTPS URL as the game server URL.
4. Confirm the service root returns JSON and that WebSocket sessions stay open during a match.

The free instance is a preview/test tier and may sleep or be region-limited. It is not the long-term authoritative production fleet.

### GitHub Pages

1. In GitHub repository Settings → Pages, select **GitHub Actions** as the source.
2. In repository Settings → Secrets and variables → Actions → Variables, add:
   - `GAME_SERVER_URL` = the Koyeb HTTPS service URL, for example `https://your-service.koyeb.app`
3. Run the `DUSTLINE Pages` workflow.
4. Open the generated GitHub Pages URL and click Deploy.

The workflow writes `runtime-config.js`, so the public static client automatically uses `wss://` against the Koyeb host while local development keeps using `ws://localhost:3000`.

## Cloudflare Pages

The same static deployment can later move to Cloudflare Pages. Keep the `GAME_SERVER_URL` runtime configuration pattern and point it at the regional realtime fleet.

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
