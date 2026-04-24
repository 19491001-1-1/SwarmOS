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

## Deploy

Authenticate once:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler login
```

Deploy:

```bash
pnpm --filter @mini-slock/cloudflare deploy
```

The default daemon API key is `dev-machine-key`. For a real public deployment, set a secret:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler secret put DAEMON_API_KEY
```

## Connect Daemons

After deployment, start each machine's daemon against the Worker URL:

```bash
pnpm --filter @mini-slock/daemon start -- \
  --server-url https://xoxiang-hub.<account>.workers.dev \
  --api-key <your-key>
```

Each daemon persists a local machine identity at `~/.xoxiang/machine-id`, so one physical machine remains one machine record across restarts.

## Web UI

For local web development pointed at the Cloudflare hub:

```bash
VITE_API_BASE=https://xoxiang-hub.<account>.workers.dev pnpm --filter @mini-slock/web dev
```

For a static production web build:

```bash
VITE_API_BASE=https://xoxiang-hub.<account>.workers.dev pnpm --filter @mini-slock/web build
```

The web app will use:

- `VITE_API_BASE/api/*` for REST
- `VITE_API_BASE/ws` for realtime browser events

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
