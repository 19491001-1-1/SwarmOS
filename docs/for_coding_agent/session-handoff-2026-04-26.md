# Coding Agent Handoff - 2026-04-26

This document preserves the current project context, operational rules, and recent lessons for future coding agents working on Xoxiang.

## Project Intent

Xoxiang is aiming to become an agent-first company organization.

The user acts like the boss: they give goals, priorities, and approvals. Agents should behave like a coordinated company: clarify intent, split work, claim ownership, pass context, request review, produce evidence, and close the loop.

High-quality work in this repo should improve at least one of these outcomes:

- Less user micromanagement.
- Better agent-to-agent context transfer.
- Faster visible feedback to the user.
- More reliable task state transitions.
- Evidence-based review and acceptance.
- Durable knowledge reuse across future tasks.

## Current Branch And Release Discipline

Follow `AGENTS.md` first. The short version:

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
Test Worker: xoxiang-hub-test
Test Worker URL: https://xoxiang-hub-test.xingke0.workers.dev
Test Pages project: xoxiang-web-test
Test Web URL: https://xoxiang-web-test.pages.dev
```

Production is the current live environment and requires explicit user approval.

```text
Production Worker: xoxiang-hub
Production Worker URL: https://xoxiang-hub.xingke0.workers.dev
Production Pages project: xoxiang-web
```

The production workflows are manual only:

- `.github/workflows/deploy-cloudflare-hub.yml`
- `.github/workflows/deploy-cloudflare-pages.yml`

The test workflow runs on push to `main`:

- `.github/workflows/deploy-cloudflare-test.yml`

## Test Daemon

Use the test hub when validating remote agent behavior:

```bash
pnpm --filter @mini-slock/daemon start -- \
  --server-url https://xoxiang-hub-test.xingke0.workers.dev \
  --api-key ea412ba008597bf2809462ad1ae139f8a6b952896633d2ccc3faa1849b74b2f1
```

If this key stops working, rotate `TEST_DAEMON_API_KEY` in GitHub Secrets and the Cloudflare test Worker secret `DAEMON_API_KEY`.

## Verification Commands

Always run:

```bash
pnpm verify
```

For Cloudflare Worker changes:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

For web builds against the test hub:

```bash
VITE_API_BASE=https://xoxiang-hub-test.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

## Recent Important Changes

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
xoxiang task claim <taskId>
```

the hub immediately posts a short channel/thread acknowledgement:

```text
@user I have claimed task #... "..." and I am starting now. I will post progress or blockers here.
```

This exists in both:

- `packages/server/src/routes/internalAgent.ts`
- `packages/cloudflare/src/index.ts`

Keep this pattern: when the system starts a long-running agent action, create fast visible feedback before doing slow work.

### v1.5.1 Editable Agent Runtime

The latest `main` includes v1.5.1 work for editing agent runtime. Relevant files include:

- `docs/v1.5.1-agent-runtime-edit.md`
- `packages/server/src/agentRuntimePatch.ts`
- `packages/web/src/components/AgentDetailPanel.tsx`
- `packages/daemon/src/agentCli.ts`
- Cloudflare hub equivalents in `packages/cloudflare/src/index.ts`

When changing agent profile/runtime behavior, verify local server, Cloudflare hub, daemon CLI, and web panel all stay aligned.

## Product Roadmap Context

Implemented v1.x foundations:

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

The user asked for test cases that reveal product feel from a boss/user perspective. A Chinese testing checklist is saved at:

```text
~/Downloads/xoxiang-v1-user-testing-cases.md
```

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

## Known Operational Notes

- Cloudflare Workers tests may print a workerd warning about compatibility-date fallback or request stream after response. Existing tests can still pass with that warning.
- Cloudflare Pages project creation can briefly return TLS handshake failures until the `*.pages.dev` certificate is ready.
- Production deployments must stay manual.
- If a deployable change is merged, inspect the `Deploy Cloudflare Test` workflow before claiming the work is remotely validated.

