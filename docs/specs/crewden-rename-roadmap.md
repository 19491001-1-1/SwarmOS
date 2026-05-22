# Crewden Rename Roadmap

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rename the entire project from Xoxiang / mini-slock / Agent Workspace to Crewden, including code, package names, CLI, environment variables, Cloudflare assets, docs, and user-facing product surfaces, while intentionally leaving the GitHub repository name unchanged for this iteration.

**Architecture:** Treat this as a destructive, whole-project rename rather than a compatibility-preserving rebrand. Perform the rename in small verified stages so each stage can be reviewed, tested, and deployed before proceeding. Existing `xoxiang` names should be removed from the codebase except for unavoidable historical notes in this roadmap or external GitHub remote metadata.

**Tech Stack:** TypeScript monorepo, pnpm workspaces, React/Vite web app, Fastify/Node server, daemon CLI, Cloudflare Worker + Durable Objects + Pages, GitHub Actions.

---

## Naming Decisions

Use these names consistently:

| Concept | New value |
| --- | --- |
| Product display name | `Crewden` |
| Lowercase slug | `crewden` |
| NPM scope | `@crewden/*` |
| Main CLI command | `crewden` |
| Local app directory | `~/.crewden` |
| Workspace tool directory | `.crewden` |
| Environment variable prefix | `CREWDEN_` |
| Cloudflare Worker production | `crewden-hub` |
| Cloudflare Worker test | `crewden-hub-test` |
| Cloudflare Pages production | `crewden-web` |
| Cloudflare Pages test | `crewden-web-test` |
| Durable Object class | `CrewdenHub` |
| Web localStorage namespace | `crewden.*` |

Explicit non-goals for this rename:

- Do not rename the GitHub repository in this iteration.
- Do not keep `xoxiang` aliases, fallback environment variables, fallback local directories, or deprecated CLI aliases.
- Do not preserve `@mini-slock/*` package names.
- Do not treat old Cloudflare asset names as canonical after the migration.

## Safety Principles

1. Use branch `refactor/rename-crewden` for implementation.
2. Make one focused commit per phase.
3. Run the listed verification after each phase.
4. Because old runtime names will be removed, expect existing daemon instances, local storage tokens, and Cloudflare Durable Object state to require migration/reconfiguration.
5. Do not run production deployment commands until the test environment has been deployed and manually validated.
6. Leave the GitHub remote URL as `git@github.com:xlvecle/xoxiang.git` unless a later task explicitly renames the repository.

## Phase 0: Baseline Inventory

**Objective:** Capture every current occurrence and verify the working tree before edits.

**Files:**
- Read-only scan across repository.

**Steps:**

1. Ensure a clean implementation branch:
   ```bash
   git switch main
   git pull --ff-only
   git switch -c refactor/rename-crewden
   ```
2. Capture current references:
   ```bash
   rg -n "xoxiang|Xoxiang|XOXIANG|mini-slock|slock|Agent Workspace|agent-workspace|@mini-slock" .
   ```
3. Capture package names:
   ```bash
   pnpm -r exec node -e "const p=require('./package.json'); console.log(process.cwd(), p.name)"
   ```
4. Run baseline verification:
   ```bash
   pnpm install
   pnpm verify
   ```
5. Commit only if new inventory notes are added; otherwise proceed without a commit.

**Expected result:** Current main is understood and tests pass before rename work begins.

## Phase 1: Package Scope and Workspace Rename

**Objective:** Rename all internal packages from `@mini-slock/*` to `@crewden/*`, and rename the root package from `agent-workspace` to `crewden`.

**Files:**
- Modify: `package.json`
- Modify: `packages/*/package.json`
- Modify: all TypeScript imports that reference `@mini-slock/*`
- Modify: all `vitest.config.ts` aliases
- Modify: `pnpm-lock.yaml`
- Modify: scripts and docs that call `pnpm --filter @mini-slock/...`

**Steps:**

1. Update `package.json` root `name` to `crewden`.
2. Update package names:
   - `@mini-slock/shared` -> `@crewden/shared`
   - `@mini-slock/hub-core` -> `@crewden/hub-core`
   - `@mini-slock/server` -> `@crewden/server`
   - `@mini-slock/daemon` -> `@crewden/daemon`
   - `@mini-slock/web` -> `@crewden/web`
   - `@mini-slock/cloudflare` -> `@crewden/cloudflare`
3. Replace all internal import specifiers from `@mini-slock/...` to `@crewden/...`.
4. Replace all pnpm filter references in scripts and docs.
5. Refresh lockfile:
   ```bash
   pnpm install
   ```
6. Verify:
   ```bash
   pnpm verify
   ```
7. Commit:
   ```bash
   git add -A
   git commit -m "refactor: rename packages to crewden scope"
   ```

**Expected result:** No `@mini-slock` references remain.

## Phase 2: Runtime Environment Variables and Local Paths

**Objective:** Replace all `XOXIANG_*` runtime configuration with `CREWDEN_*`, and replace `.xoxiang` / `~/.xoxiang` paths with `.crewden` / `~/.crewden`.

**Files:**
- Modify: `packages/daemon/src/machineIdentity.ts`
- Modify: `packages/daemon/src/daemonClient.ts`
- Modify: `packages/daemon/src/agentCli.ts`
- Modify: `packages/daemon/src/mcp/bridge.ts`
- Modify: `packages/daemon/src/workspace/agentWorkspace.ts`
- Modify: `packages/daemon/src/agentProcessManager.ts`
- Modify: `packages/daemon/src/bridge/simpleToolBridge.ts`
- Modify: `packages/server/**/*.ts`
- Modify: `packages/cloudflare/**/*.ts`
- Modify: all tests referencing `XOXIANG_*` or `.xoxiang`

**Steps:**

1. Replace environment variable names:
   - `XOXIANG_VERSION` -> `CREWDEN_VERSION`
   - `XOXIANG_ENV` -> `CREWDEN_ENV`
   - `XOXIANG_MACHINE_ID` -> `CREWDEN_MACHINE_ID`
   - `XOXIANG_AGENTS_DIR` -> `CREWDEN_AGENTS_DIR`
   - `XOXIANG_AGENT_ID` -> `CREWDEN_AGENT_ID`
   - `XOXIANG_SERVER_URL` -> `CREWDEN_SERVER_URL`
   - `XOXIANG_AGENT_TOKEN_FILE` -> `CREWDEN_AGENT_TOKEN_FILE`
   - `XOXIANG_DB_PATH` -> `CREWDEN_DB_PATH`
2. Replace local path strings:
   - `~/.xoxiang` -> `~/.crewden`
   - `.xoxiang` -> `.crewden`
3. Update error messages and help text to mention only Crewden variables.
4. Update tests to assert the new variable names and paths.
5. Verify:
   ```bash
   pnpm verify
   ```
6. Commit:
   ```bash
   git add -A
   git commit -m "refactor: rename runtime configuration to crewden"
   ```

**Expected result:** No code depends on `XOXIANG_*` or `.xoxiang`.

## Phase 3: CLI and Agent-Facing Tool Rename

**Objective:** Rename the agent-facing CLI command from `xoxiang` to `crewden` without retaining the old command alias.

**Files:**
- Modify: `packages/daemon/package.json`
- Modify: `packages/daemon/src/agentProcessManager.ts`
- Modify: `packages/daemon/src/workspace/agentWorkspace.ts`
- Modify: `packages/daemon/src/mcp/bridge.ts`
- Modify: `packages/daemon/src/agentCli.ts`
- Modify: `docs/agent-facing-cli-reference.md`
- Modify: `docs/agent-cli-reference.md`
- Modify: tests under `packages/daemon/test/`

**Steps:**

1. In `packages/daemon/package.json`, replace bin entry:
   ```json
   "crewden": "./dist/agentCli.js"
   ```
   Remove the `xoxiang` bin entry.
2. Update generated wrapper path from `.xoxiang/xoxiang` to `.crewden/crewden`.
3. Update all prompts that tell agents to run `xoxiang ...` so they say `crewden ...`.
4. Update MCP server info from `xoxiang-agent-tools` to `crewden-agent-tools`.
5. Update CLI tests and fake CLI fixtures.
6. Verify:
   ```bash
   pnpm verify
   ```
7. Commit:
   ```bash
   git add -A
   git commit -m "refactor: rename agent cli to crewden"
   ```

**Expected result:** `xoxiang` is not installed as a CLI command by this package.

## Phase 4: Product UI, Browser Storage, and Documentation Rename

**Objective:** Rename user-facing product text and browser storage namespaces to Crewden.

**Files:**
- Modify: `README.md`
- Modify: `packages/web/index.html`
- Modify: `packages/web/src/**/*.tsx`
- Modify: `packages/web/src/auth.ts`
- Modify: `packages/web/test/**/*.tsx`
- Modify: `docs/**/*.md`
- Modify: `AGENTS.md`

**Steps:**

1. Replace display names:
   - `Agent Workspace` -> `Crewden`
   - `Xoxiang` -> `Crewden`
   - `xoxiang` -> `crewden` where it describes product identity, paths, URLs, commands, or config.
2. Update browser storage keys:
   - `xoxiang.webAuthToken` -> `crewden.webAuthToken`
   - `xoxiang.webAuthSignedOut` -> `crewden.webAuthSignedOut`
3. Update docs commands, examples, URLs, and screenshots references if any.
4. Update `AGENTS.md` to use new package filters and Cloudflare test/prod names.
5. Verify:
   ```bash
   pnpm verify
   ```
6. Commit:
   ```bash
   git add -A
   git commit -m "docs: rename product surfaces to crewden"
   ```

**Expected result:** User-facing text says Crewden, and browser state starts under the Crewden namespace.

## Phase 5: Cloudflare Worker, Durable Object, and Pages Asset Rename

**Objective:** Rename deployable Cloudflare assets to Crewden names.

**Files:**
- Modify: `packages/cloudflare/wrangler.jsonc`
- Modify: `packages/cloudflare/wrangler.test.jsonc`
- Modify: `packages/cloudflare/src/index.ts`
- Modify: `packages/cloudflare/worker-configuration.d.ts`
- Modify: `scripts/deploy-cloudflare-pages.sh`
- Modify: `.github/workflows/*.yml`
- Modify: docs that reference Cloudflare asset names

**Steps:**

1. Update Worker names:
   - `xoxiang-hub` -> `crewden-hub`
   - `xoxiang-hub-test` -> `crewden-hub-test`
2. Update Worker variables:
   - `XOXIANG_VERSION` -> `CREWDEN_VERSION`
   - `XOXIANG_ENV` -> `CREWDEN_ENV`
3. Rename Durable Object class in source:
   - `XoxiangHub` -> `CrewdenHub`
4. Update wrangler Durable Object binding class names and migrations:
   - Add a new migration tag for `CrewdenHub` if required by Wrangler.
   - Validate with dry-run before deploying.
5. Update Pages project names:
   - `xoxiang-web` -> `crewden-web`
   - `xoxiang-web-test` -> `crewden-web-test`
6. Update build commands to use Crewden worker URLs:
   - `https://crewden-hub-test.xingke0.workers.dev`
   - `https://crewden-hub.xingke0.workers.dev`
7. Dry-run Worker deployment:
   ```bash
   pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
   pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
   ```
8. Build web against test Worker URL:
   ```bash
   VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
   ```
9. Full verify:
   ```bash
   pnpm verify
   ```
10. Commit:
   ```bash
   git add -A
   git commit -m "refactor: rename cloudflare assets to crewden"
   ```

**Expected result:** Cloudflare config and workflows target Crewden assets only.

## Phase 6: Remove Remaining Legacy References

**Objective:** Ensure no legacy project names remain, except the GitHub remote and this roadmap's historical explanation.

**Files:**
- Modify: any file reported by the final scan.

**Steps:**

1. Run final scan:
   ```bash
   rg -n "xoxiang|Xoxiang|XOXIANG|mini-slock|slock|Agent Workspace|agent-workspace|@mini-slock" .
   ```
2. For each match, decide:
   - Remove or rename if it is active code, config, docs, tests, examples, or scripts.
   - Leave only if it is in this roadmap as historical source-name documentation, or unavoidable Git metadata outside the tracked working tree.
3. Re-run scan until the only expected references are in this roadmap.
4. Verify:
   ```bash
   pnpm verify
   ```
5. Commit:
   ```bash
   git add -A
   git commit -m "chore: remove legacy rename references"
   ```

**Expected result:** The tracked project is Crewden-only.

## Phase 7: Test Deployment and Manual Validation

**Objective:** Deploy Crewden test assets and confirm the system works end-to-end before production.

**Files:**
- No code changes expected unless validation finds bugs.

**Steps:**

1. Push the implementation branch:
   ```bash
   git push -u origin refactor/rename-crewden
   ```
2. Deploy or trigger test Worker and Pages according to the updated workflows.
3. Validate:
   - Test web app loads.
   - Login/auth works with new storage namespace.
   - Daemon connects using `CREWDEN_*` variables.
   - Machine appears in sidebar.
   - Agent can be created and started.
   - Agent receives a message and replies through the `crewden` CLI.
   - Task/delegation flow still works.
   - MCP bridge advertises `crewden-agent-tools`.
4. Record validation notes in the PR or commit message.
5. Fix any bugs on the same branch and rerun relevant verification.

**Expected result:** Crewden test environment works end-to-end.

## Phase 8: Merge and Production Migration

**Objective:** Merge the verified rename and promote Crewden production assets.

**Steps:**

1. Merge only after verification and test validation pass:
   ```bash
   git switch main
   git merge --no-ff refactor/rename-crewden
   git push origin main
   ```
2. Trigger production Worker and Pages workflows for Crewden assets.
3. Configure production secrets for the new Worker if they are not already present:
   ```bash
   printf '%s' '<daemon-key>' | pnpm --filter @crewden/cloudflare exec wrangler secret put DAEMON_API_KEY
   printf '%s' '<web-token>'  | pnpm --filter @crewden/cloudflare exec wrangler secret put WEB_AUTH_TOKEN
   ```
4. Start daemon with new names:
   ```bash
   pnpm --filter @crewden/daemon start -- --server-url https://crewden-hub.xingke0.workers.dev --api-key <daemon-key>
   ```
5. Validate production with the same checklist as Phase 7.

**Expected result:** Production runs under Crewden Cloudflare assets.

## Known Breakages to Accept

Because the decision is to not preserve `xoxiang`, expect these breakages and handle them operationally:

- Existing `xoxiang` CLI commands will fail; users must switch to `crewden`.
- Existing `XOXIANG_*` environment variables will be ignored; users must configure `CREWDEN_*`.
- Existing `~/.xoxiang` machine identity and agent workspaces will not be read; operators may manually migrate files to `~/.crewden` if desired.
- Existing browser auth state under `xoxiang.*` will not be used; users must sign in again.
- Existing Cloudflare Durable Object state may not automatically carry over if the Worker class/name changes; validate this with test deployment and decide whether to migrate data or accept reset.
- Existing `xoxiang-hub` and `xoxiang-web` URLs will not be canonical after migration.

## Final Acceptance Criteria

- `pnpm install` succeeds.
- `pnpm verify` succeeds.
- Worker dry-runs succeed for production and test configs.
- Web build succeeds against the Crewden test Worker URL.
- Final tracked-file scan has no active legacy references:
  ```bash
  rg -n "xoxiang|Xoxiang|XOXIANG|mini-slock|@mini-slock|Agent Workspace|agent-workspace" .
  ```
- `crewden` CLI works for agent-facing messaging.
- Test Cloudflare environment works end-to-end.
- Production promotion is manually approved and validated.
