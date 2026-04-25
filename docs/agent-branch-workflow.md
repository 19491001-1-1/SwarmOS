# Agent Branch Workflow

This repository uses a branch-first workflow for all coding-agent work.

## Rule

Every task starts on a new branch. The branch is merged into `main` only after tests pass.
Deployable changes go to the Cloudflare test environment first. Production deploys require explicit
user approval after test validation.

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

# wait for Deploy Cloudflare Test, then validate the test URL
# request production approval before triggering production workflows
```

## Required Verification

Always run:

```bash
pnpm verify
```

For Cloudflare Worker changes:

```bash
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --dry-run
pnpm --filter @mini-slock/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

For Cloudflare Pages/static web deployment changes:

```bash
VITE_API_BASE=https://xoxiang-hub-test.xingke0.workers.dev pnpm --filter @mini-slock/web build
```

## Cloudflare Promotion Policy

Use the test environment as the default remote deployment target:

```text
Worker: xoxiang-hub-test
Worker URL: https://xoxiang-hub-test.xingke0.workers.dev
Pages project: xoxiang-web-test
```

Production is:

```text
Worker: xoxiang-hub
Worker URL: https://xoxiang-hub.xingke0.workers.dev
Pages project: xoxiang-web
```

The production GitHub Actions workflows are manual only. Trigger them only after the user approves
promotion from the validated test environment.

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
