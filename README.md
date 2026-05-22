# Crewden

A minimal self-hosted agent workspace: web chat + server + local daemon + long-running CLI agents. Supports Claude Code, Codex CLI, and Gemini CLI.

## Repository Layout

This repository is now organized as a single SwarmOS project root.

- Main code: `packages/`, `tools/`, `scripts/`
- Product and engineering docs: `docs/`

See `docs/guides/project-structure.md` for details.

## Architecture

```
Browser (React/Vite)
    |  HTTP REST + WebSocket (/ws)
    v
Server (Fastify + Node.js)  <-- in-memory store
    |  WebSocket (/daemon/connect)
    v
Daemon (Node.js)
    |  spawn child processes
    v
CLI Agents: claude | codex | gemini
```

The server owns workspaces, channels, messages, agents, and machines. The daemon connects via WebSocket, detects local CLI runtimes, and spawns them as child processes. Agents communicate replies using a simple line-based bridge protocol.

## Install

```bash
pnpm install
```

## Running

### Start server + web UI

```bash
pnpm dev
```

- Server: http://localhost:3000
- Web UI: http://localhost:5173

### Start daemon

```bash
pnpm daemon --server-url http://localhost:3000 --api-key dev-machine-key
```

Or directly:

```bash
pnpm --filter @crewden/daemon start -- --server-url http://localhost:3000 --api-key dev-machine-key
```

### Cloudflare central hub

To run Crewden with a public centralized server, deploy `packages/cloudflare`:

```bash
pnpm --filter @crewden/cloudflare exec wrangler login
pnpm --filter @crewden/cloudflare run deploy
```

Set the daemon and browser auth secrets on the Worker once:

```bash
printf '%s' '<daemon-key>' | pnpm --filter @crewden/cloudflare exec wrangler secret put DAEMON_API_KEY
printf '%s' '<web-token>'  | pnpm --filter @crewden/cloudflare exec wrangler secret put WEB_AUTH_TOKEN
```

Then point daemons and the web UI at the Worker URL:

```bash
pnpm --filter @crewden/daemon start -- --server-url https://crewden-hub.<account>.workers.dev --api-key <daemon-key>
VITE_API_BASE=https://crewden-hub.<account>.workers.dev \
VITE_WEB_AUTH_TOKEN=<web-token> \
pnpm --filter @crewden/web dev
```

#### CI/CD (recommended)

Push to `main` automatically deploys via GitHub Actions. Required secrets in repo Settings:

| Secret                  | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Wrangler auth                                                              |
| `CLOUDFLARE_ACCOUNT_ID` | Your account                                                               |
| `DAEMON_API_KEY`        | Worker secret for daemon connections                                       |
| `WEB_AUTH_TOKEN`        | Worker secret for browser/REST auth (optional but required for public hub) |

To trigger manually:

```bash
gh workflow run deploy-cloudflare-hub.yml
gh workflow run deploy-cloudflare-pages.yml
```

See `docs/specs/cloudflare-central-hub.md` for the full workflow and production notes.

## Versioning

All components expose or carry a version:

- Web: build-time `VITE_APP_VERSION`, shown in the sidebar.
- Server and Cloudflare hub: `GET /api/version`.
- Daemon: `--version`, and the same value is sent as `daemonVersion` in the ready handshake.

Local defaults use the package version. CI/CD injects the Git commit SHA into `CREWDEN_VERSION` and `VITE_APP_VERSION` so every deployed iteration is identifiable.

## Verify (typecheck + tests)

```bash
pnpm verify
```

## Creating your first agent

1. Open http://localhost:5173
2. Start the daemon (see above) — your machine appears in the sidebar
3. Click **+ New** in the Agents panel
4. Fill in name, runtime (claude/codex/gemini), and select your machine
5. Click **Create Agent**, then **Start**
6. In the composer, select the agent from the dropdown and send a message

## Runtime Prerequisites

- **Claude**: `claude --version` must work. Install via `npm install -g @anthropic-ai/claude-code` and authenticate.
- **Codex**: `codex --version` must work. Install via `npm install -g @openai/codex` and set `OPENAI_API_KEY`.
- **Gemini**: `gemini --version` must work. Install via `npm install -g @google/gemini-cli` and authenticate.

Only installed runtimes are reported by the daemon. You can use any subset.

## Agent Bridge Protocol

Agents output replies using a single-line format:

```
[[CREWDEN_SEND_MESSAGE]] {"content":"your reply here"}
```

The daemon parses this line and sends the message to the server. This works uniformly across all three runtimes without requiring MCP.

## Known Limitations

- **No production auth**: only `dev-machine-key` is accepted. Do not expose to the internet.
- **In-memory store**: all data is lost on server restart. SQLite persistence is a planned improvement.
- **Simplified bridge**: uses line-based output parsing, not full MCP. Agents must output the bridge marker to send replies.
- **One-shot per message**: each message delivery spawns a new CLI process with transcript context. Long-running persistent processes are not yet implemented.
- **Local machine only**: the daemon must run on the same machine as the CLI tools.
- **No file browser, billing, or enterprise permissions**.

## Package Structure

```
packages/
  shared/     - Protocol types and Zod validators
  server/     - Fastify HTTP + WebSocket server
  daemon/     - Runtime detector, process manager, CLI drivers
  web/        - React + Vite frontend
```
