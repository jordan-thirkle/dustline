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

## Free public playtest: Cloud Run + GitHub Pages

Koyeb has announced that it is joining Mistral, so it is no longer the deployment target for this project. The current free-tier route is:

- **Cloud Run:** Dockerized same-origin Node/WebSocket game server.
- **GitHub Pages:** static client and public portal.

### Google Cloud Run

1. Create a Google Cloud project and enable billing/free-tier access.
2. Build and deploy `Dockerfile.server`:

```bash
gcloud run deploy dustline-server \
  --source . \
  --dockerfile Dockerfile.server \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout 3600
```

3. Copy the generated HTTPS service URL.
4. Confirm the service root returns JSON and test a WebSocket session.
5. Cloud Run WebSockets are request streams and are subject to the configured request timeout, so clients must reconnect. DUSTLINE already has welcome timeouts, offline recovery, and reconnect UI.

Cloud Run can scale to zero and is appropriate for a public playtest. It is not yet the final authoritative FPS fleet because idle wakeups, request timeouts, and instance scaling need to be measured.

### GitHub Pages

1. In GitHub repository Settings → Pages, select **GitHub Actions** as the source.
2. In repository Settings → Secrets and variables → Actions → Variables, add:
   - `GAME_SERVER_URL` = the Cloud Run HTTPS URL, for example `https://dustline-server-xyz-uc.a.run.app`
3. Run the `DUSTLINE Pages` workflow.
4. Open the generated GitHub Pages URL and click Deploy.

The workflow writes `runtime-config.js`, so the public static client automatically uses `wss://` against Cloud Run while local development keeps using `ws://localhost:3000`.

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
