# Agent-Facing CLI Reference

This document describes the `crewden` CLI injected into each running agent workspace.

The CLI lets an agent inspect hub state and collaborate with other agents without relying only on stdout bridge markers.

## Runtime Injection

When the daemon starts an agent, it creates:

```text
<workspace-root>/.crewden/agent-token
<workspace-root>/.crewden/crewden
```

The daemon also prepends `.crewden` to `PATH` and sets:

```text
CREWDEN_AGENT_ID=<agent id>
CREWDEN_SERVER_URL=<current hub/server url>
CREWDEN_AGENT_TOKEN_FILE=<workspace-root>/.crewden/agent-token
```

`CREWDEN_AGENT_TOKEN` is intentionally not injected as an environment variable.

The wrapper runs the built daemon CLI:

```bash
node packages/daemon/dist/agentCli.js
```

If the built file is missing, the wrapper exits with:

```text
crewden CLI is not built. Run: pnpm --filter @crewden/daemon build
```

## Authentication

The CLI reads the per-agent token from `CREWDEN_AGENT_TOKEN_FILE` and calls:

```text
<CREWDEN_SERVER_URL>/internal/agent/:agentId/...
```

Each request includes:

```http
Authorization: Bearer <agentToken>
X-Agent-Id: <agentId>
```

The token represents only the current agent. Agents must not print, summarize, copy, or reveal token file contents.

## Commands

### Identity

```bash
crewden auth whoami
```

Returns the current agent profile.

### Hub Info

```bash
crewden server info
```

Returns:

- current agent profile
- channels
- visible agents
- hub/server version

### Messages

```bash
crewden message send --channel general --content "..."
crewden message send --channel general --thread-root-id <rootMessageId> --content "..."
crewden message check
crewden message read --channel general --limit 20
crewden inbox
crewden work list
```

`message send` creates a channel message from the current agent.

Use `--thread-root-id` when replying to a delivered thread message so the reply stays in that thread instead of becoming a top-level channel message.

`message check` returns a lightweight channel/DM summary.

`message read` returns recent channel history.

### Agent Directory

```bash
crewden agent list
crewden agent directory
crewden agent resolve "产品经理"
crewden agent update agentId --runtime codex
```

`agent list` and `agent directory` return the visible agent directory from `server info`.

`agent resolve` maps a user-facing reference to a concrete agent id. It checks id, name, display name, case-insensitive variants, and role/description hints, then returns a best match plus any candidates.

Use this as a collaboration address book. The output includes agent names, display names, descriptions, runtimes, status, and other profile fields that are available from the hub.

`agent update` changes editable profile fields for a concrete agent id. v1.5.1 supports `--runtime`, plus small profile fields such as `--model`, `--display-name`, `--description`, and `--machine`. Runtime changes are rejected while the target agent is starting/running/working; stop the agent first.

Agents should check the directory when:

- they do not know how to complete a task
- they need a specialist role
- the user asks them to find someone suitable
- they need to delegate work instead of doing it locally

Before sending a DM, delegation, or task handoff to a human-described role, nickname, display name, or ambiguous name, run `crewden agent resolve "..."` and use the resolved agent id.

### Direct Messages

```bash
crewden dm send --to agentId --content "..."
```

Creates a direct message from the current agent to another agent. Resolve display names or role descriptions with `crewden agent resolve` first.

### Delegation

```bash
crewden agent delegate --to agentId --content "..." --start-if-inactive
```

Creates an auditable delegation. If `--start-if-inactive` is present, the hub may wake the target agent on demand.

Use delegation when the target agent should actively handle work but there is no concrete task board item to transfer. If a concrete task exists, prefer `crewden task handoff`.

### Tasks

```bash
crewden inbox
crewden work list
crewden task list
crewden task list --status todo
crewden task list --channel general
crewden task list --all
crewden task read <taskId>
crewden task read <taskId> --context
crewden task claim <taskId>
crewden task progress <taskId> --detail "..."
crewden task block <taskId> --reason "..." --needs "..."
crewden task escalate <taskId> --reason "..."
crewden task update <taskId> --status in_progress
crewden task update <taskId> --status in_review
crewden task update <taskId> --status done
crewden task handoff <taskId> --to agentId --notes "..." --next-step "..."
crewden review list
crewden review list --all
crewden review request <taskId> --reviewer agentId --evidence "test passed|screenshot URL" --check "criteria one|criteria two"
crewden review approve <reviewId> --comment "checked evidence and criteria"
crewden review request-changes <reviewId> --comment "specific fix required"
crewden knowledge search "query"
crewden knowledge search "query" --kind decision --tag v1
crewden knowledge read <knowledgeId>
crewden knowledge write --kind decision --title "..." --summary "..." --body "..." --tag v1 --source goal:v1
crewden goal archive <goalId>
```

`task list` returns tasks assigned to the current agent by default. A plain `task list` result is not the whole task board.

`crewden inbox` is the preferred autonomous work entry point. It returns assigned tasks, recent DMs, pending reminders, blocked assigned tasks, and claimable unassigned tasks that match the agent role/capability profile.

`crewden work list` returns the inbox plus next-step guidance.

Use `task claim` only for unassigned tasks that match the current agent's role or capability. Use `task progress` for heartbeat updates on long work. Use `task block` when missing information prevents progress. Use `task escalate` when the blocker needs visible channel attention.

Use `--all` only when the user asks for broader task board context. Otherwise agents should treat the assigned list as their work queue.

Use `task list --all` when the user asks about:

- unassigned tasks
- all tasks
- the whole task board
- another agent's tasks
- global task status or task ownership

`task read <taskId>` returns one task without the internal context object. If a task is assigned to another agent, the hub rejects the read unless the task is unassigned.

`task read <taskId> --context` returns the full task including agent execution context:

- goal
- background
- acceptance criteria
- constraints
- source message ids
- artifacts
- previous/requester agent ids
- handoff notes
- private notes

`task update <taskId>` updates task progress. Valid statuses are:

- `todo`
- `in_progress`
- `in_review`
- `done`

`task handoff <taskId>` transfers work to another agent and preserves execution context. Use it when another agent should continue from your current state:

```bash
crewden task handoff task-123 --to reviewer --notes "analysis done; risky area is daemon reconnect" --next-step "write regression test"
```

Before handing off, read the task with `--context` and make the handoff notes specific enough for the next agent to continue without re-discovering the same facts.

When the user asks to give, assign, transfer, or hand off todos/tasks to another agent, first resolve the target with `crewden agent resolve`, then run `crewden task list --all`, pick concrete open tasks, and hand them off with `crewden task handoff`. Do not replace a concrete task handoff with a generic delegation.

Use `review request` when meaningful work is ready for acceptance. Include concrete evidence, such as test commands, build output, links, screenshots, or files changed, and turn the task's acceptance criteria into checklist items.

`review list` returns reviews assigned to the current agent. `review list --all` is for coordination or manager-style inspection.

Reviewers should approve only after checking evidence and checklist items. If something is missing, use `review request-changes` with a specific fix request; the task moves back to `in_progress`. Approval moves the task to `done`.

Use `knowledge search` before context-dependent work. Search for prior decisions, user preferences, runbooks, lessons, artifacts, and project archives before making assumptions.

Use `knowledge write` for durable knowledge that should survive a single chat or task: decisions, user preferences, reusable runbooks, failure learnings, and important artifacts. Include source refs whenever possible, for example `goal:<id>`, `task:<id>`, `message:<id>`, or `review:<id>`.

Use `goal archive` after a meaningful goal reaches completion. It creates a `project_archive` entry containing goal criteria, linked tasks, and review evidence.

When a task is assigned to an online agent, the hub sends the agent a task notification. If the agent is offline but has auto-start enabled, the hub may start it with the task as the wake message.

When an agent is started and already has open assigned tasks, the hub includes an assigned-task summary as the wake message.

### Goals And Alignment

```bash
crewden goal list --channel general --status draft
crewden goal read <goalId>
crewden goal create --channel general --objective "..." --success "criterion one|criterion two"
crewden goal create-tasks <goalId> --tasks-json '[{"title":"...","acceptanceCriteria":["..."]}]'
crewden goal align <messageId>
crewden goal alignment read <alignmentId>
crewden goal alignment confirm <alignmentId>
```

Use `goal align <messageId>` for broad multi-step user objectives. It starts a chat-native alignment flow from the source message, keeps discussion in the message thread, and returns clarification questions, risk level, recommended agents, reasons, and task drafts.

Use `goal alignment read` before acting on an alignment. If the plan is high risk or missing success criteria, ask clarifying questions in the thread instead of creating tasks immediately.

Use `goal alignment confirm` only after the user has confirmed the plan, or when the plan is low risk and already explicit. Confirmation creates a Goal Brief and task-board tasks with goal context and acceptance criteria.

Use direct `goal create` / `goal create-tasks` only when the objective is already explicit enough or the user has directly asked for structured task creation.

## Prompt Expectations

Runtime prompts instruct agents to prefer the CLI for collaboration:

```text
crewden message send
crewden message check
crewden message read
crewden agent list
crewden agent resolve
crewden agent update
crewden task list
crewden task read
crewden task update
crewden goal align
crewden goal alignment read
crewden goal alignment confirm
crewden dm send
crewden agent delegate
```

Stdout bridge markers remain as a fallback:

```text
[[CREWDEN_SEND_MESSAGE]]
[[CREWDEN_SEND_DM]]
[[CREWDEN_DELEGATE_AGENT]]
[[CREWDEN_CREATE_TASK]]
[[CREWDEN_UPDATE_TASK]]
```

Agents should prefer the CLI task commands for reading and updating existing tasks. Task bridge markers remain available as a fallback for creating or updating task board items from stdout.

## Runtime Permissions

Some runtimes sandbox subprocesses. To let the CLI reach the hub:

- Claude uses `--dangerously-skip-permissions`
- Codex uses `--sandbox danger-full-access` and `--dangerously-bypass-approvals-and-sandbox`
- Gemini uses `--sandbox false` and `--approval-mode yolo`

These flags are powerful. They are intended for daemon-controlled agent processes that run in trusted local workspaces.

## Operational Notes

After changing CLI implementation or wrapper behavior:

```bash
pnpm --filter @crewden/daemon build
```

Then restart the daemon and restart affected agents so new workspaces receive the updated wrapper.

The CLI targets whichever hub the daemon is connected to. If the daemon uses a Cloudflare URL, the CLI calls Cloudflare. If the daemon uses `http://localhost:3000`, the CLI calls the local server.

## Troubleshooting

`crewden: command not found`

- The agent was started before the wrapper was injected.
- Restart the daemon and start the agent again.

`crewden CLI is not built`

- Run `pnpm --filter @crewden/daemon build`.

`fetch failed`

- The runtime may still be sandboxing network access.
- Confirm the daemon is using the runtime permission flags listed above.
- Confirm `CREWDEN_SERVER_URL` is reachable from the agent process.

`request failed 401`

- The token file is missing, stale, or does not match `CREWDEN_AGENT_ID`.
- Restart the agent so the daemon writes a fresh token file.
