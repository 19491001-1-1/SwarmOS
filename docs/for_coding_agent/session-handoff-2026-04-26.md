# Coding Agent Session Handoff — 2026-04-26

This document captures useful context from the recent Xoxiang coding sessions so future coding agents can start with less rediscovery.

## Current Repository State

- Main branch latest known merge after this session: `533cae2 merge: v1.5.1 editable agent runtime`.
- Recent implementation branches were merged with non-fast-forward merge commits, preserving branch history.
- The project uses a pnpm monorepo under `agent-workspace`.
- The core packages are:
  - `packages/shared`: protocol, validation, shared version helpers.
  - `packages/hub-core`: pure business logic shared between Node server and Cloudflare hub.
  - `packages/server`: local Fastify hub with SQLite.
  - `packages/cloudflare`: public Worker hub backed by a Durable Object with SQLite storage.
  - `packages/daemon`: local daemon, runtime launchers, agent-facing CLI, MCP bridge.
  - `packages/web`: Vite/React web UI.

## Recent Version Work

### v1.5 — Knowledge & Memory Layer

Implemented a project knowledge layer:

- Knowledge entries for decision, project archive, user preference, runbook, learning, and artifact.
- Public and internal APIs for search/read/write/update.
- Agent-facing CLI commands:
  - `xoxiang knowledge search`
  - `xoxiang knowledge read`
  - `xoxiang knowledge write`
  - `xoxiang goal archive`
- Web Knowledge panel.
- Server and Cloudflare parity.

Important source files:

- `packages/shared/src/validation.ts`
- `packages/server/src/routes/knowledge.ts`
- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`
- `packages/daemon/src/agentCli.ts`
- `packages/web/src/components/KnowledgePanel.tsx`

### v1.5.1 — Editable Agent Runtime

Implemented runtime editing for existing Agents:

- `PatchAgentRequestSchema` now accepts `runtime`.
- `PATCH /api/agents/:id` can modify runtime.
- Runtime changes are rejected with `409` while an agent is `starting`, `running`, or `working`.
- If an agent is bound to a machine, the target machine must support the target runtime.
- Internal agent API supports:

```http
PATCH /internal/agent/:agentId/agents/:targetAgentId
```

- Agent-facing CLI supports:

```bash
xoxiang agent update <agentId> --runtime codex
```

- Web Agent profile panel has a runtime selector.

Important source files:

- `packages/server/src/agentRuntimePatch.ts`
- `packages/server/src/routes/agents.ts`
- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`
- `packages/daemon/src/agentCli.ts`
- `packages/daemon/src/internalAgentApi.ts`
- `packages/web/src/components/AgentDetailPanel.tsx`

## Branch And Verification Workflow

The required workflow is codified in `AGENTS.md`.

For each task:

```bash
git switch main
git pull --ff-only
git switch -c <type>/<short-task-name>
```

After implementation:

```bash
pnpm verify
```

If Cloudflare Worker code changed:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

If Web code or Pages deploy behavior changed:

```bash
VITE_API_BASE=https://xoxiang-hub-test.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

Then commit, push the task branch, merge to `main`, rerun required verification on `main` when the merge touched active code, and push `main`.

## Common Commands

Install dependencies:

```bash
pnpm install
```

If Corepack fails with `Cannot find matching keyid`, update or bypass Corepack:

```bash
npm install -g corepack@latest
corepack enable
corepack prepare pnpm@9.15.4 --activate
hash -r
pnpm install
```

Run the full verification gate:

```bash
pnpm verify
```

Targeted tests:

```bash
pnpm --filter @mini-slock/shared test
pnpm --filter @mini-slock/server test
pnpm --filter @mini-slock/cloudflare test
pnpm --filter @mini-slock/daemon test
pnpm --filter @mini-slock/web test
```

Cloudflare dry-runs:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

Web build against test hub:

```bash
VITE_API_BASE=https://xoxiang-hub-test.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

## Cloudflare Notes

Cloudflare deployment is split between test and production:

- Test Worker: `xoxiang-hub-test`
- Test Worker URL: `https://xoxiang-hub-test.xingke0.workers.dev`
- Test Pages project: `xoxiang-web-test`
- Production Worker: `xoxiang-hub`
- Production Worker URL: `https://xoxiang-hub.xingke0.workers.dev`
- Production Pages project: `xoxiang-web`

Production deployment requires explicit user approval. Do not trigger production workflows or deploy production Pages/Worker just because tests pass.

The Cloudflare hub uses Durable Object SQLite, not local filesystem SQLite. Server and Cloudflare often duplicate routing/storage glue but should share pure logic through `packages/hub-core` when possible.

Cloudflare test output may include a workerd info line like:

```text
Can't read from request stream after response has been sent.
```

If Vitest reports all Cloudflare tests passed, this line has been observed as non-blocking noise.

## Agent Runtime Notes

Supported runtime ids are currently:

- `claude`
- `codex`
- `gemini`

When changing an agent runtime:

- Do not modify runtime while the target agent is `starting`, `running`, or `working`.
- Stop the agent first.
- If `machineId` is set, the machine's `runtimes` must include the target runtime.
- A runtime change does not migrate runtime-specific sessions or model names.

## Agent-Facing CLI Notes

The CLI targets whichever hub the daemon is configured to use:

- Local mode: usually `http://localhost:3000`.
- Cloudflare mode: usually `https://xoxiang-hub*.xingke0.workers.dev`.

Useful commands:

```bash
xoxiang auth whoami
xoxiang server info
xoxiang agent list
xoxiang agent resolve "产品经理"
xoxiang agent update <agentId> --runtime codex
xoxiang message check
xoxiang message read --channel general --limit 20
xoxiang message send --channel general --content "..."
xoxiang task list --all
xoxiang task read <taskId> --context
xoxiang task update <taskId> --status done
xoxiang task handoff <taskId> --to <agentId> --notes "..."
xoxiang knowledge search "query"
xoxiang knowledge write --kind runbook --title "..." --summary "..." --body "..." --source doc:...
```

Some runtimes sandbox subprocesses. Recent daemon prompt work encourages starting CLI-backed runtimes with enough permission for `xoxiang` to reach the hub.

## Knowledge And Memory Guidance

There are three levels of memory:

1. `transcript.txt` in an agent workspace: chronological runtime record.
2. `MEMORY.md` and `notes/`: per-agent durable memory and working notes.
3. Knowledge layer: project-level reusable knowledge, decisions, runbooks, lessons, and archives.

Do not rely on raw transcript alone. Future agents need concise, structured summaries:

- Common tool commands and invocation patterns.
- Project-specific implementation lessons.
- Business/domain knowledge.
- Why an approach worked.
- When to reuse it.
- Caveats and failure modes.

Do not write secrets, auth tokens, API keys, or sensitive private data into memory, notes, docs, or knowledge entries.

## UI Notes

The Web UI intentionally uses a bold/brutalist visual language. Existing constraints from recent work:

- Keep controls compact and operational.
- Avoid turning the product into a marketing-style page.
- Right rail should not become permanently noisy unless the user explicitly asks.
- Agent status/presence must remain visible and accurate in compact surfaces.
- Markdown, mentions, threads, and mobile responsiveness are part of the v0.9 line.

When changing Web UI:

- Add focused tests in `packages/web/test`.
- Build with `VITE_API_BASE` pointed at the test hub if deployable.
- Be careful with text overflow in sidebars and cards.

## Known Pitfalls

- Do not deploy production Cloudflare resources without explicit user approval.
- Do not use `git reset --hard` or discard unrelated changes.
- If a user says "pull latest", run `git status` first, then `git pull --ff-only`.
- Cloudflare Worker and local Server must stay behaviorally aligned.
- If a feature touches both public API and internal agent API, update CLI docs and tests together.
- For runtime launch flags, Gemini rejects using both `--yolo` and `--approval-mode`; use `--approval-mode=yolo`.
- Gemini CLI may require `GEMINI_API_KEY` when using Gemini API.
- Corepack on old Node installs can fail pnpm signature checks; update Corepack or install fixed pnpm.
- Cloudflare Durable Object data cannot be reset with a normal local SQLite command. A temporary reset endpoint was used once and immediately removed; prefer building an explicit safe admin/reset story if this becomes recurring.

## Good Next Steps For Future Agents

- Keep v1.x roadmap current as implementation lands.
- For any new agent capability, update all four surfaces when relevant:
  - shared schemas
  - local server
  - Cloudflare hub
  - agent-facing CLI and Web UI
- Add reusable lessons to Knowledge entries, not just docs.
- Keep `docs/for_coding_agent` updated after major sessions.
