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
```

If the change touches Cloudflare Pages deployment, also run:

```bash
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

If a test or command fails, fix it on the task branch and rerun the failing command. Do not merge a failing branch.

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

## When Already On A Feature Branch

If the agent starts on a non-main branch:

- Continue on that branch if it clearly matches the user's task.
- Otherwise ask before switching branches if there are uncommitted changes.
- Never discard existing user changes.

## Emergency Exception

Direct edits on `main` are allowed only when the user explicitly requests a hotfix on `main`. In that case, state the exception in the final response.
