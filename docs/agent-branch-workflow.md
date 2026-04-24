# Agent Branch Workflow

This repository uses a branch-first workflow for all coding-agent work.

## Rule

Every task starts on a new branch. The branch is merged into `main` only after tests pass.

Agents must not develop directly on `main`.

## Standard Flow

```bash
git switch main
git switch -c <type>/<short-task-name>

# edit files

pnpm verify

git status --short
git add -A
git commit -m "<type>(scope): <summary>"

git switch main
git merge --no-ff <type>/<short-task-name>
git push origin main
```

## Required Verification

Always run:

```bash
pnpm verify
```

For Cloudflare Worker changes:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
```

For Cloudflare Pages/static web deployment changes:

```bash
VITE_API_BASE=https://xoxiang-hub.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

## Branch Naming

Use:

```text
feat/<short-task-name>
fix/<short-task-name>
docs/<short-task-name>
refactor/<short-task-name>
chore/<short-task-name>
```

Examples:

```text
feat/browser-auth
fix/cloudflare-machine-merge
docs/cloudflare-runbook
refactor/hub-core
chore/agent-branch-workflow
```

## Agent Instruction

The enforceable agent-facing version of this policy is in:

```text
AGENTS.md
```

Coding agents should read and follow `AGENTS.md` before making repository changes.
