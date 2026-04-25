# Cloudflare Central Hub

Xoxiang can run in two modes:

- Local mode: web, server, and daemon all run on one machine through `start.sh`.
- Cloudflare hub mode: a centralized Worker is deployed publicly; every daemon connects to that Worker.

## Architecture

```
Browser / Web UI
  -> https://<worker>/api/*
  -> wss://<worker>/ws

Daemon on each machine
  -> wss://<worker>/daemon/connect?key=<api-key>

Cloudflare Worker
  -> Durable Object: API state, messages, agents, machines, WebSocket fanout
```

The Cloudflare hub is intentionally separate from `packages/server`. The local server uses Fastify and local SQLite; the Cloudflare hub uses a Durable Object with SQLite storage because Workers cannot use local filesystem SQLite or Node `ws` servers.

## Development Record

This document captures the bypass/centralized deployment work that was added after local SQLite persistence.

### Goal

Make a public centralized Xoxiang service on Cloudflare so multiple machines can connect their local daemons to one shared hub.

The local mode remains unchanged:

```bash
./start.sh
```

The Cloudflare mode is a side path:

```bash
daemon(s) -> public Worker hub <- browser/web UI
```

### Why not deploy `packages/server` directly?

`packages/server` is a Node/Fastify app that depends on:

- local filesystem SQLite through libSQL file URLs
- Node server sockets
- `ws` / Fastify websocket handling

Cloudflare Workers do not run a long-lived Node server and cannot use local SQLite files. The Cloudflare hub therefore lives in `packages/cloudflare` and reimplements the same REST/WebSocket surface using Worker-native primitives:

- Worker `fetch()` for HTTP routing
- Durable Object WebSocket handling for `/ws` and `/daemon/connect`
- Durable Object SQLite storage for channels, messages, agents, and machines

### Files Added Or Changed

- `packages/cloudflare/`
  - `src/index.ts`: Worker + Durable Object hub implementation.
  - `wrangler.jsonc`: Worker name, compatibility settings, Durable Object binding and migration.
  - `package.json`: `dev`, `deploy`, `typecheck` scripts.
  - `worker-configuration.d.ts`: generated-style Env binding declarations.
- `packages/web/src/api.ts`
  - Adds `VITE_API_BASE`, allowing the web app to call a remote hub instead of same-origin `/api`.
- `packages/web/src/App.tsx`
  - Builds `/ws` URL from `VITE_API_BASE` when present.
- `packages/web/src/vite-env.d.ts`
  - Adds Vite env typings for `import.meta.env`.
- `.env.example`
  - Documents `VITE_API_BASE` and `XOXIANG_MACHINE_ID`.
- `README.md`
  - Adds a short Cloudflare hub section.

## Environments

Cloudflare deploys are split into test and production. Test is the default target for remote
validation; production is promoted manually only after explicit user approval.

| Environment | Worker | Worker URL | Pages project | Purpose |
|-------------|--------|------------|---------------|---------|
| Test | `xoxiang-hub-test` | `https://xoxiang-hub-test.xingke0.workers.dev` | `xoxiang-web-test` | Validate deployable changes before release |
| Production | `xoxiang-hub` | `https://xoxiang-hub.xingke0.workers.dev` | `xoxiang-web` | Current live environment |

Promotion rule:

1. Merge verified work to `main`.
2. Let the `Deploy Cloudflare Test` workflow deploy Worker and Pages.
3. Validate the user-facing behavior on the test Pages URL.
4. Ask the user for production approval.
5. Manually trigger production workflows only after approval.

## Current Production Deployment

Current Worker URL:

```text
https://xoxiang-hub.xingke0.workers.dev
```

Current Worker name:

```text
xoxiang-hub
```

Current deployment command:

```bash
pnpm --filter @mini-slock/cloudflare run deploy:prod
```

Health check:

```bash
curl -sf https://xoxiang-hub.xingke0.workers.dev/api/channels
```

Expected result includes the default `general` channel.

## Secret Rotation Record

The initial Worker config used:

```json
"vars": {
  "DAEMON_API_KEY": "dev-machine-key"
}
```

This was removed because public deployments should not keep daemon auth keys in versioned config.

The deployed Worker now uses a Cloudflare secret named:

```text
DAEMON_API_KEY
```

The key was rotated to:

```text
63da594e0ad55bf22a52068a61b54942337ec5137703f9e5658ecb93a7905f2f
```

Rotation commands used:

```bash
openssl rand -hex 32
pnpm --filter @mini-slock/cloudflare run deploy
printf '%s' '<new-key>' | pnpm --filter @mini-slock/cloudflare exec wrangler secret put DAEMON_API_KEY
```

Important operational note: Cloudflare will reject `wrangler secret put DAEMON_API_KEY` if `DAEMON_API_KEY` is still present as a plain `vars` binding in `wrangler.jsonc`. Remove the plain var and deploy once before creating the same-name secret.

## Deploy

Authenticate once:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler login
```

Deploy test Worker:

```bash
pnpm --filter @mini-slock/cloudflare run deploy:test
```

Deploy production Worker after approval:

```bash
pnpm --filter @mini-slock/cloudflare run deploy:prod
```

Set or rotate the daemon API key as a Cloudflare secret:

```bash
printf '%s' '<new-key>' | pnpm --filter @mini-slock/cloudflare exec wrangler secret put DAEMON_API_KEY
```

For the test Worker, pass the test config:

```bash
printf '%s' '<test-key>' | pnpm --filter @mini-slock/cloudflare exec wrangler secret put DAEMON_API_KEY --config wrangler.test.jsonc
```

Set or rotate the browser auth token (required by `/api/*` and `/ws`):

```bash
printf '%s' '<new-web-token>' | pnpm --filter @mini-slock/cloudflare exec wrangler secret put WEB_AUTH_TOKEN
```

For the test Worker:

```bash
printf '%s' '<test-web-token>' | pnpm --filter @mini-slock/cloudflare exec wrangler secret put WEB_AUTH_TOKEN --config wrangler.test.jsonc
```

Generate a fresh token with `openssl rand -hex 32`. Browser clients must send this token as
`Authorization: Bearer <token>` for REST and as `?token=<token>` for the `/ws` upgrade.
Daemon connections continue to use `DAEMON_API_KEY`.

Worker integration tests live in `packages/cloudflare/test/hub.test.ts` and cover auth, validation,
and daemon-machine flow. Run them with:

```bash
pnpm --filter @mini-slock/cloudflare test
```

Dry-run packaging validation:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

Typecheck:

```bash
pnpm --filter @mini-slock/cloudflare typecheck
```

Full repo verification:

```bash
pnpm verify
```

## CI/CD

GitHub Actions workflows are in `.github/workflows/`. Push to `main` triggers CI and the test
Cloudflare deployment. Production deployment is manual only.

### Required GitHub Secrets

Configure in repo **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Wrangler auth — needs Workers Scripts Edit + Cloudflare Pages Edit + Durable Objects Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DAEMON_API_KEY` | Uploaded to the production Worker as a Cloudflare secret |
| `WEB_AUTH_TOKEN` | Embedded into the production Pages build and uploaded to the production Worker |
| `TEST_DAEMON_API_KEY` | Uploaded to the test Worker as `DAEMON_API_KEY` |
| `TEST_WEB_AUTH_TOKEN` | Embedded into the test Pages build and uploaded to the test Worker as `WEB_AUTH_TOKEN` |

### Workflows

| File | Trigger | What it does |
|------|---------|-------------|
| `ci.yml` | PRs + push to `main` | typecheck, test, Worker dry-run (no secrets needed) |
| `deploy-cloudflare-test.yml` | push to `main` + manual | verify, upload test secrets, deploy test Worker, build and deploy test Pages |
| `deploy-cloudflare-hub.yml` | manual only | verify, upload production `DAEMON_API_KEY`, deploy production Worker |
| `deploy-cloudflare-pages.yml` | manual only | build web, deploy to production Cloudflare Pages |

The deploy workflows inject the current Git commit SHA as the runtime/build version:

- Worker hub: `XOXIANG_VERSION`, `XOXIANG_COMMIT_SHA`, `XOXIANG_BUILD_ID`
- Web UI: `VITE_APP_VERSION`, `VITE_COMMIT_SHA`

The web sidebar displays the web and hub versions. The hub exposes its value at `GET /api/version`.

### First-time Setup: Configure GitHub Secrets

Go to repo **Settings → Secrets and variables → Actions → New repository secret**, or use `gh`:

```bash
gh secret set CLOUDFLARE_API_TOKEN   # Cloudflare API token with Workers + Pages Edit
gh secret set CLOUDFLARE_ACCOUNT_ID  # Found in Cloudflare dashboard sidebar
gh secret set DAEMON_API_KEY         # Production daemon key. Generate: openssl rand -hex 32
gh secret set WEB_AUTH_TOKEN         # Production browser token. Generate: openssl rand -hex 32
gh secret set TEST_DAEMON_API_KEY    # Test daemon key. Generate: openssl rand -hex 32
gh secret set TEST_WEB_AUTH_TOKEN    # Test browser token. Generate: openssl rand -hex 32
```

Cloudflare API token recommended permissions:
- Account: Workers Scripts Edit
- Account: Cloudflare Pages Edit
- Account: Durable Objects Edit

### Manual Trigger

```bash
gh workflow run deploy-cloudflare-test.yml
gh workflow run deploy-cloudflare-hub.yml
gh workflow run deploy-cloudflare-pages.yml
```

Run the production workflows only after the test environment has been validated and the user has
approved production promotion.

The test Pages workflow creates `xoxiang-web-test` automatically if it does not already exist. A
fresh Cloudflare Pages project can take a short time before its `*.pages.dev` TLS certificate is
ready; retry the Pages URL after the workflow succeeds if the first request reports a TLS handshake
failure.

### Check Recent Runs

```bash
gh run list --limit 10
gh run watch <run-id>
gh run view <run-id> --log-failed
```

Successful deploy signs:
- **Hub**: workflow shows `✓ Deployed` with a `*.workers.dev` URL
- **Pages**: workflow outputs a `*.pages.dev` URL that loads the web UI

### Local Deployment (still works)

```bash
# Deploy Worker
pnpm --filter @mini-slock/cloudflare run deploy:test

# Deploy production Worker after approval
pnpm --filter @mini-slock/cloudflare run deploy:prod

# Deploy Pages
pnpm deploy:web:pages
```

## Connect Daemons

After deployment, start each machine's daemon against the Worker URL:

```bash
pnpm --filter @mini-slock/daemon start -- \
  --server-url https://xoxiang-hub.xingke0.workers.dev \
  --api-key 63da594e0ad55bf22a52068a61b54942337ec5137703f9e5658ecb93a7905f2f
```

Each daemon persists a local machine identity at `~/.xoxiang/machine-id`, so one physical machine remains one machine record across restarts.

## Web UI

The Cloudflare hub requires `WEB_AUTH_TOKEN` for all browser traffic. Local web must pass the same token via `VITE_WEB_AUTH_TOKEN`.

For local web development pointed at the Cloudflare hub:

```bash
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev \
VITE_WEB_AUTH_TOKEN=<web-token> \
pnpm --filter @mini-slock/web dev
```

For a static production web build:

```bash
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev \
VITE_WEB_AUTH_TOKEN=<web-token> \
pnpm --filter @mini-slock/web build
```

The web app will use:

- `VITE_API_BASE/api/*` for REST, with `Authorization: Bearer <VITE_WEB_AUTH_TOKEN>`
- `VITE_API_BASE/ws?token=<VITE_WEB_AUTH_TOKEN>` for realtime browser events

If `VITE_WEB_AUTH_TOKEN` is empty, the web app still works against the local server (which does
not enforce browser auth), but every Cloudflare request will receive 401.

### Deploy Static Web To Cloudflare Pages

Use the standalone deploy script:

```bash
pnpm deploy:web:pages
```

The script runs:

1. `wrangler whoami` to verify Cloudflare authentication.
2. Validates that `VITE_WEB_AUTH_TOKEN` is set when targeting the public hub, and fails fast if not.
3. `VITE_API_BASE=<hub-url> VITE_WEB_AUTH_TOKEN=<token> pnpm --filter @mini-slock/web build`.
4. `wrangler pages deploy packages/web/dist`.
5. If the Pages project does not exist yet, `wrangler pages project create` creates it and the deploy is retried.

Set the token before running:

```bash
export VITE_WEB_AUTH_TOKEN=<web-token>
pnpm deploy:web:pages
```

The script does not echo the full token to stdout; only the configured length is logged.

Defaults:

```text
CLOUDFLARE_PAGES_PROJECT=xoxiang-web
CLOUDFLARE_PAGES_BRANCH=main
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev
```

Override when needed:

```bash
CLOUDFLARE_PAGES_PROJECT=my-xoxiang-web \
CLOUDFLARE_PAGES_BRANCH=production \
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev \
pnpm deploy:web:pages
```

Direct script path:

```bash
scripts/deploy-cloudflare-pages.sh
```

## API Surface Implemented

The Worker currently mirrors the local server endpoints needed by the existing web and daemon:

```text
GET    /api/channels
GET    /api/version
GET    /api/channels/:id/messages
POST   /api/channels/:id/messages

GET    /api/agents
POST   /api/agents
PATCH  /api/agents/:id
POST   /api/agents/:id/start
POST   /api/agents/:id/stop

GET    /api/machines

GET    /ws
GET    /daemon/connect?key=<api-key>
```

Realtime behavior:

- browser websocket clients receive `message:new`, `agent:update`, and `machine:update`
- daemon websocket clients send `ready`, `agent:status`, and `agent:message`
- hub sends daemon `agent:start`, `agent:stop`, and `agent:deliver`

## Machine Identity

Daemon machine identity is handled on the daemon side, not the Worker side.

Implementation:

- file: `packages/daemon/src/machineIdentity.ts`
- default identity path: `~/.xoxiang/machine-id`
- override env var: `XOXIANG_MACHINE_ID`

This avoids creating a new machine record on every daemon restart.

The Worker also merges duplicate machine rows for the same `hostname + os` when a stable daemon `machineId` appears, and rebinds agents from duplicate machine ids to the stable id.

## Design Notes

The Durable Object is currently a single central object:

```ts
env.HUB.getByName("central")
```

This is intentional for the current product shape: one shared workspace, one central event bus, one set of channels/agents/machines.

If the product later adds multiple workspaces, the routing should become:

```ts
env.HUB.getByName(workspaceId)
```

and workspace identity/auth should be added to every API and WebSocket route.

## Troubleshooting

### `pnpm --filter @mini-slock/cloudflare deploy` fails

Use:

```bash
pnpm --filter @mini-slock/cloudflare run deploy
```

`pnpm deploy` is a reserved pnpm command and expects a deploy target parameter.

### `wrangler secret put DAEMON_API_KEY` says binding already in use

Cause: `DAEMON_API_KEY` still exists in `wrangler.jsonc` under `vars`.

Fix:

1. Remove `DAEMON_API_KEY` from `vars`.
2. Deploy once with `pnpm --filter @mini-slock/cloudflare run deploy`.
3. Run `wrangler secret put DAEMON_API_KEY`.

### Worker health check works but daemon cannot connect

Check:

- daemon `--server-url` must be `https://xoxiang-hub.xingke0.workers.dev`
- daemon `--api-key` must match the Cloudflare `DAEMON_API_KEY` secret
- Worker `/daemon/connect` expects a WebSocket upgrade, so plain `curl` is not a daemon-connect test

### Web UI still talks to localhost

Set `VITE_API_BASE` before starting or building the web app:

```bash
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev pnpm --filter @mini-slock/web dev
```

## Current Scope

Implemented:

- channels
- messages
- agents
- machines
- browser websocket fanout
- daemon websocket connection
- agent start/stop/deliver flow
- Durable Object persistence

Not yet implemented:

- production user authentication for browser users
- custom domain / Pages hosting automation
- data migration between local SQLite and Cloudflare Durable Object storage
