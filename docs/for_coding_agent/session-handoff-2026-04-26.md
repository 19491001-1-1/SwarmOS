# Coding Agent Handoff - 2026-04-26

This document preserves current project context, operational rules, and recent lessons for future coding agents working on Crewden.

## Project Intent

Crewden is moving toward an agent-first company organization.

The user acts like the boss: they give goals, priorities, and approvals. Agents should behave like a coordinated company: clarify intent, split work, claim ownership, pass context, request review, produce evidence, preserve knowledge, and close the loop.

High-quality work should improve at least one of these outcomes:

- Less user micromanagement.
- Better agent-to-agent context transfer.
- Faster visible feedback to the user.
- More reliable task state transitions.
- Evidence-based review and acceptance.
- Durable knowledge reuse across future tasks.

## Current Repository State

- Recent main-line context includes `533cae2 merge: v1.5.1 editable agent runtime`.
- A later main update added Cloudflare test environment and task-claim acknowledgement work before this handoff merge.
- Recent implementation branches were merged with non-fast-forward merge commits, preserving branch history.
- The project uses a pnpm monorepo under `crewden`.

Core packages:

- `packages/shared`: protocol, validation, shared version helpers.
- `packages/hub-core`: pure business logic shared between Node server and Cloudflare hub.
- `packages/server`: local Fastify hub with SQLite.
- `packages/cloudflare`: public Worker hub backed by a Durable Object with SQLite storage.
- `packages/daemon`: local daemon, runtime launchers, agent-facing CLI, MCP bridge.
- `packages/web`: Vite/React web UI.

## Branch And Release Discipline

Follow `AGENTS.md` first. Short version:

1. Do not edit directly on `main`.
2. Start from a clean `main`.
3. Pull latest remote.
4. Create a task branch.
5. Make scoped changes.
6. Run required verification.
7. Commit and push the task branch.
8. Merge to `main` only after verification passes.
9. Push `main`.
10. Let Cloudflare test deploy.
11. Promote production only after explicit user approval.

## Cloudflare Environments

Test is the default remote validation target.

```text
Test Worker: crewden-hub-test
Test Worker URL: https://crewden-hub-test.xingke0.workers.dev
Test Pages project: crewden-web-test
Test Web URL: https://crewden-web-test.pages.dev
```

Production is the current live environment and requires explicit user approval.

```text
Production Worker: crewden-hub
Production Worker URL: https://crewden-hub.xingke0.workers.dev
Production Pages project: crewden-web
```

Production workflows are manual only:

- `.github/workflows/deploy-cloudflare-hub.yml`
- `.github/workflows/deploy-cloudflare-pages.yml`

Test workflow runs on push to `main`:

- `.github/workflows/deploy-cloudflare-test.yml`

Do not put daemon API keys or auth tokens in docs. If a test daemon key is needed, read it from the approved local environment, GitHub Secrets, or Cloudflare Worker secret records.

## Verification Commands

Always run:

```bash
pnpm verify
```

For Cloudflare Worker changes:

```bash
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

For web builds against the test hub:

```bash
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

Targeted tests:

```bash
pnpm --filter @crewden/shared test
pnpm --filter @crewden/server test
pnpm --filter @crewden/cloudflare test
pnpm --filter @crewden/daemon test
pnpm --filter @crewden/web test
```

If Corepack fails with `Cannot find matching keyid`, update or bypass Corepack:

```bash
npm install -g corepack@latest
corepack enable
corepack prepare pnpm@9.15.4 --activate
hash -r
pnpm install
```

## Recent Important Changes

### v1.6 Reliable Task Flow

Implemented on branch `feat/v1-6-reliable-task-flow`:

- Task status machine now rejects invalid public PATCH transitions with `422`.
- Task status values include `blocked` and `cancelled`; `todo` remains the open/default state and `in_review` remains the review state.
- Tasks now carry `version`; public task PATCH supports `expectedVersion` and returns `409` on stale writes.
- Server SQLite now has `audit_log` plus `appendAuditLog/listAuditLogs`; public status changes, internal task status changes, handoffs, blocks, claims, and delegation events write audit entries without storing auth tokens.
- Daemon process manager retries transient runtime failures (`ENOTFOUND`, `ECONNRESET`, rate limit, timeout) up to three total attempts and blocks task deliveries on permanent auth/permission/command failures.
- Server startup now resets machine live status to `offline` while preserving known machine metadata.
- Minimal task dependencies use `task.context.blockedByTaskIds`; dependent task delivery is suppressed until all blockers are `done`, blocker completion triggers dependent delivery, and circular dependencies return `422`.

Key verification from the implementation session:

```bash
pnpm verify
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

All three commands passed locally. Cloudflare tests/dry-runs may still print known non-blocking Workers Runtime compatibility or request-stream warnings.

### Cloudflare Test Environment

Recent commits added:

- `packages/cloudflare/wrangler.test.jsonc`
- `.github/workflows/deploy-cloudflare-test.yml`
- Test secrets:
  - `TEST_DAEMON_API_KEY`
  - `TEST_WEB_AUTH_TOKEN`

Behavior:

- Push to `main` triggers test Worker and test Pages deploy.
- Production deploy does not trigger on push.
- Production requires explicit user approval after test validation.

### Task Claim Acknowledgement

Agents used to claim work and then spend time processing before the user saw a reply, which caused anxiety.

Now, when an agent successfully claims an unassigned task through:

```bash
crewden task claim <taskId>
```

the hub should immediately post a short channel/thread acknowledgement before the slow work continues.

Relevant surfaces:

- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`

Keep this pattern: when the system starts a long-running agent action, create fast visible feedback before doing slow work.

### v1.5 - Knowledge & Memory Layer

Implemented a project knowledge layer:

- Knowledge entries for decision, project archive, user preference, runbook, learning, and artifact.
- Public and internal APIs for search/read/write/update.
- Agent-facing CLI commands:
  - `crewden knowledge search`
  - `crewden knowledge read`
  - `crewden knowledge write`
  - `crewden goal archive`
- Web Knowledge panel.
- Server and Cloudflare parity.

Important source files:

- `packages/shared/src/validation.ts`
- `packages/server/src/routes/knowledge.ts`
- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`
- `packages/daemon/src/agentCli.ts`
- `packages/web/src/components/KnowledgePanel.tsx`

### v1.5.1 - Editable Agent Runtime

Implemented runtime editing for existing Agents:

- `PatchAgentRequestSchema` accepts `runtime`.
- `PATCH /api/agents/:id` can modify runtime.
- Runtime changes are rejected with `409` while an agent is `starting`, `running`, or `working`.
- If an agent is bound to a machine, the target machine must support the target runtime.
- Internal agent API supports:

```http
PATCH /internal/agent/:agentId/agents/:targetAgentId
```

- Agent-facing CLI supports:

```bash
crewden agent update <agentId> --runtime codex
```

- Web Agent profile panel has a runtime selector.

Important source files:

- `docs/v1.5.1-agent-runtime-edit.md`
- `packages/server/src/agentRuntimePatch.ts`
- `packages/server/src/routes/agents.ts`
- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`
- `packages/daemon/src/agentCli.ts`
- `packages/daemon/src/internalAgentApi.ts`
- `packages/web/src/components/AgentDetailPanel.tsx`

When changing agent profile/runtime behavior, verify local server, Cloudflare hub, daemon CLI, and web panel all stay aligned.

## Product Roadmap Context

Implemented or planned v1.x foundations:

- v1.0: Lightweight agent roles and capabilities.
- v1.1: Goal Brief and work breakdown.
- v1.2: Chat-native goal alignment.
- v1.3: Autonomous work loop.
- v1.4: Review and acceptance.
- v1.5: Knowledge and memory layer.
- v1.5.1: Editable agent runtime.

Important docs:

- `docs/v1-phase-two-roadmap.md`
- `docs/v1.0-agent-roles.md`
- `docs/v1.1-goal-brief-work-breakdown.md`
- `docs/v1.2-chat-goal-alignment.md`
- `docs/v1.3-autonomous-work-loop.md`
- `docs/v1.4-review-acceptance.md`
- `docs/v1.5-knowledge-memory-layer.md`
- `docs/v1.5.1-agent-runtime-edit.md`

## User-Visible Testing Scenarios

The user wants product testing from a boss/user perspective, not only developer tests.

Core scenarios to preserve:

1. Agent feels like an employee, not a generic bot.
2. One sentence becomes Goal Brief plus executable tasks.
3. Goal clarification happens in chat/thread.
4. Agents proactively inspect inbox and claim suitable work.
5. Completion requires evidence and review.
6. Knowledge is stored and reused in later tasks.

Primary judgment:

```text
Can the user say less while the agent organization does more correct coordination work?
```

## Agent Collaboration Lessons

- Agents need enough hidden context when tasks are passed between them. Task context should include objective, background, constraints, acceptance criteria, dependencies, artifacts, private notes when appropriate, and handoff notes.
- Display names are not stable identifiers. When resolving agents, prefer agent id first, then unique name/display name. Be careful with aliases like `产品经理`.
- Do not make users wait silently. For long work, post a short acknowledgement quickly, then continue.
- Do not mark meaningful work done without evidence.
- High-risk work should have a reviewer different from the executor unless the user explicitly allows self-review with a reason.
- Before context-dependent work, agents should search Knowledge.
- Write Knowledge for durable decisions, user preferences, runbooks, failures, and reusable project facts. Do not store secrets or short-lived chat noise.

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

Gemini CLI notes:

- Gemini rejects using both `--yolo` and `--approval-mode`; use `--approval-mode=yolo`.
- Gemini CLI may require `GEMINI_API_KEY` when using Gemini API.

## Agent-Facing CLI Notes

The CLI targets whichever hub the daemon is configured to use:

- Local mode: usually `http://localhost:3000`.
- Cloudflare test mode: usually `https://crewden-hub-test.xingke0.workers.dev`.
- Cloudflare production mode: usually `https://crewden-hub.xingke0.workers.dev`.

Useful commands:

```bash
crewden auth whoami
crewden server info
crewden agent list
crewden agent resolve "产品经理"
crewden agent update <agentId> --runtime codex
crewden message check
crewden message read --channel general --limit 20
crewden message send --channel general --content "..."
crewden task list --all
crewden task read <taskId> --context
crewden task update <taskId> --status done
crewden task handoff <taskId> --to <agentId> --notes "..."
crewden knowledge search "query"
crewden knowledge write --kind runbook --title "..." --summary "..." --body "..." --source doc:...
```

Some runtimes sandbox subprocesses. Recent daemon prompt work encourages starting CLI-backed runtimes with enough permission for `crewden` to reach the hub.

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

## Known Operational Notes And Pitfalls

- Do not deploy production Cloudflare resources without explicit user approval.
- Do not use `git reset --hard` or discard unrelated changes.
- If a user says "pull latest", run `git status` first, then `git pull --ff-only`.
- Cloudflare Worker and local Server must stay behaviorally aligned.
- If a feature touches both public API and internal agent API, update CLI docs and tests together.
- Cloudflare Workers tests may print workerd warnings about compatibility-date fallback or request streams; if tests pass, these have been observed as non-blocking.
- Cloudflare Pages project creation can briefly return TLS handshake failures until the `*.pages.dev` certificate is ready.
- Production deployments must stay manual.
- If a deployable change is merged, inspect the `Deploy Cloudflare Test` workflow before claiming remote validation.
- Cloudflare Durable Object data cannot be reset with a normal local SQLite command. A temporary reset endpoint was used once and immediately removed; prefer building an explicit safe admin/reset story if this becomes recurring.

## Good Next Steps For Future Agents

- Keep v1.x roadmap current as implementation lands.
- For any new agent capability, update all relevant surfaces:
  - shared schemas
  - local server
  - Cloudflare hub
  - agent-facing CLI
  - Web UI
- Add reusable lessons to Knowledge entries, not just docs.
- Keep `docs/for_coding_agent` updated after major sessions.
