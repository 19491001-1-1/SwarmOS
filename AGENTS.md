# Agent Development Rules

These rules are mandatory for coding agents working in this repository.

## Branch Workflow

Never implement changes directly on `main`.

For every development task:

1. Start from a clean working tree.
2. Ensure the current branch is `main`.
3. Pull or fetch the latest remote state when network access is available.
4. Create a new task branch before editing files.
5. Make all code, test, and documentation changes on that branch.
6. Run the required verification commands.
7. Commit on the task branch.
8. Push the task branch to GitHub so the development process is preserved remotely.
9. Merge back to `main` only after verification passes.
10. Push `main`.
11. Let the Cloudflare test environment deploy and verify it when the change is deployable.
12. Deploy production only after the user explicitly approves promotion.

Use concise branch names:

```bash
git switch main
git switch -c <type>/<short-task-name>
```

Examples:

```bash
git switch -c feat/cloudflare-auth
git switch -c fix/agent-start-rebind
git switch -c docs/cloudflare-runbook
git switch -c refactor/hub-core
```

## Verification Gate

Before merging to `main`, run:

```bash
pnpm verify
```

If the change touches Cloudflare Worker code, also run:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

If the change touches Cloudflare Pages deployment, also run:

```bash
VITE_API_BASE=https://xoxiang-hub-test.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

If a test or command fails, fix it on the task branch and rerun the failing command. Do not merge a failing branch.

## Version Propagation

Every deployable iteration must carry a version across components.

- Keep the default source version in `packages/shared/src/version.ts` aligned with the project version when doing a named release.
- CI/CD should inject the current commit SHA through `XOXIANG_VERSION` for hub/server/daemon-style runtimes and `VITE_APP_VERSION` for the web build.
- Do not hardcode a new component-local version if it can use the shared version helper or the build-time environment variable.

## Merge Procedure

After verification passes:

```bash
git status --short
git add -A
git commit -m "<type>(scope): <summary>"
git push -u origin <task-branch>
git switch main
git merge --no-ff <task-branch>
git push origin main
```

If the task branch already has an upstream, use `git push origin <task-branch>` after the commit. Do not delete the remote task branch unless the user explicitly asks; it is part of the development record.

Do not use `git reset --hard`, `git checkout --`, or destructive cleanup unless the user explicitly asks.

## Cloudflare Environment Gate

Cloudflare test is the default remote deployment target for deployable work.

- Test Worker: `xoxiang-hub-test`
- Test Worker URL: `https://xoxiang-hub-test.xingke0.workers.dev`
- Test Pages project: `xoxiang-web-test`
- Production Worker: `xoxiang-hub`
- Production Worker URL: `https://xoxiang-hub.xingke0.workers.dev`
- Production Pages project: `xoxiang-web`

Production is the current live environment. Do not trigger production workflows, run `deploy:prod`, or deploy the `xoxiang-web` Pages project unless the user has explicitly approved promotion after test validation.

Expected flow:

1. Merge verified work to `main`.
2. Confirm the `Deploy Cloudflare Test` workflow succeeds.
3. Validate the user-facing behavior on the test Pages URL.
4. Ask for production approval with the test result summary.
5. Only after approval, manually run the production Hub and Pages workflows.

## When Already On A Feature Branch

If the agent starts on a non-main branch:

- Continue on that branch if it clearly matches the user's task.
- Otherwise ask before switching branches if there are uncommitted changes.
- Never discard existing user changes.

## Emergency Exception

Direct edits on `main` are allowed only when the user explicitly requests a hotfix on `main`. In that case, state the exception in the final response.
