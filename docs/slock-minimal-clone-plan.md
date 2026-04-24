# Minimal Slock-like Agent Workspace Implementation Plan

> **For Claude Code:** Implement this plan end-to-end. Work autonomously in a loop: inspect, implement with TDD, run tests, fix failures, repeat until all acceptance tests pass. Do not stop after scaffolding. Deliver a runnable MVP.

**Goal:** Build a minimal self-hosted Slock-like system: web chat + server + local daemon + long-running CLI agents, supporting Claude Code, Codex CLI, and Gemini CLI.

**Architecture:** Use a single TypeScript monorepo with a Node.js backend, a React web UI, and a Node.js daemon. The server owns workspaces/channels/messages/agents/machines and talks to daemons over WebSocket. The daemon detects local runtimes and spawns CLI agents. Agents communicate with the server via a lightweight MCP-style stdio bridge or simplified JSON tool bridge.

**Tech Stack:** TypeScript, Node.js, pnpm, Fastify or Express, ws, React + Vite, SQLite via better-sqlite3 or Prisma, Vitest, Playwright optional, zod, execa.

---

## Non-negotiable Requirements

1. Support **three runtimes** in the daemon:
   - `claude` / Claude Code
   - `codex` / Codex CLI
   - `gemini` / Gemini CLI
2. MVP must be runnable locally with:
   ```bash
   pnpm install
   pnpm test
   pnpm dev
   pnpm daemon --server-url http://localhost:3000 --api-key dev-machine-key
   ```
3. Must include automated tests. Follow strict TDD:
   - Write failing test first.
   - Run it and confirm failure.
   - Implement minimal code.
   - Run test and confirm pass.
   - Repeat.
4. Must include a `README.md` with setup, commands, architecture, and known limitations.
5. Must include a final verification script or command:
   ```bash
   pnpm verify
   ```
   It should run typecheck, unit tests, and any integration tests.
6. Keep MVP minimal. Do not implement billing, auth providers, enterprise permissions, file browser UI, or complex task board.

---

## Product Scope

### MVP User Flow

1. User opens web UI at `http://localhost:3000`.
2. User sees channels, messages, machines, agents.
3. User starts a local daemon with an API key.
4. Server shows the machine as online and lists detected runtimes.
5. User creates an agent:
   - name
   - display name
   - runtime: `claude`, `codex`, or `gemini`
   - model string
   - system prompt / role description
   - machine selection
6. User clicks Start.
7. Server sends `agent:start` to daemon.
8. Daemon spawns the selected CLI runtime in a persistent workspace directory.
9. User sends a message mentioning the agent or explicitly selecting it.
10. Server sends `agent:deliver` to daemon.
11. Agent processes message and sends reply back to the channel.
12. UI updates in real time.
13. User can stop agent.

### MVP Entities

- Workspace: only one default workspace is enough.
- Channel: at least `general`.
- Message: channel messages only; threads/DM can be deferred.
- Machine: daemon connection.
- Agent: config + runtime status.
- Agent session: runtime-specific session id where available.

---

## Protocol Contract

Use JSON messages over WebSocket.

### Daemon connects

Endpoint:

```text
ws://localhost:3000/daemon/connect?key=dev-machine-key
```

### Daemon -> Server

```ts
type DaemonToServer =
  | {
      type: 'ready';
      machineId?: string;
      hostname: string;
      os: string;
      daemonVersion: string;
      runtimes: RuntimeId[];
      runtimeVersions: Record<string, string>;
      runningAgents: string[];
      capabilities: string[];
    }
  | { type: 'pong' }
  | { type: 'agent:status'; agentId: string; status: AgentStatus; launchId?: string }
  | { type: 'agent:activity'; agentId: string; activity: string; detail?: string; launchId?: string }
  | { type: 'agent:session'; agentId: string; sessionId: string; launchId?: string }
  | { type: 'agent:message'; agentId: string; channelId: string; content: string; inReplyToMessageId?: string }
  | { type: 'agent:deliver:ack'; agentId: string; seq: number }
  | { type: 'machine:runtime_models:result'; requestId: string; models?: string[]; default?: string; error?: string };
```

### Server -> Daemon

```ts
type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery }
  | { type: 'agent:reset-workspace'; agentId: string }
  | { type: 'machine:runtime_models:detect'; runtime: RuntimeId; requestId: string };
```

### Shared Types

```ts
type RuntimeId = 'claude' | 'codex' | 'gemini';
type AgentStatus = 'inactive' | 'starting' | 'running' | 'working' | 'idle' | 'error';

type AgentRuntimeConfig = {
  runtime: RuntimeId;
  model?: string;
  name: string;
  displayName?: string;
  description?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
};

type AgentDelivery = {
  id: string;
  channelId: string;
  channelName: string;
  senderName: string;
  content: string;
  createdAt: string;
};
```

---

## Repository Structure

Create this monorepo:

```text
agent-workspace/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  scripts/
    verify.ts
  packages/
    shared/
      package.json
      src/
        protocol.ts
        validation.ts
      test/
        protocol.test.ts
    server/
      package.json
      src/
        index.ts
        app.ts
        db.ts
        schema.ts
        events.ts
        daemonRegistry.ts
        routes/
          agents.ts
          channels.ts
          messages.ts
          machines.ts
        ws/
          daemonSocket.ts
          browserSocket.ts
      test/
        daemonSocket.test.ts
        agentsApi.test.ts
        messagesApi.test.ts
    daemon/
      package.json
      src/
        index.ts
        cli.ts
        daemonClient.ts
        runtimeDetector.ts
        agentProcessManager.ts
        bridge/
          simpleToolBridge.ts
        drivers/
          types.ts
          claude.ts
          codex.ts
          gemini.ts
      test/
        runtimeDetector.test.ts
        agentProcessManager.test.ts
        drivers.test.ts
    web/
      package.json
      index.html
      src/
        main.tsx
        App.tsx
        api.ts
        components/
          Sidebar.tsx
          ChannelView.tsx
          AgentPanel.tsx
          MachinePanel.tsx
          Composer.tsx
      test/
        App.test.tsx
```

---

## Task 1: Create Monorepo Scaffold

**Objective:** Create the TypeScript monorepo, scripts, package structure, and base tooling.

**Files:**
- Create all root config files.
- Create package folders.

**Steps:**
1. Write package files and tsconfig.
2. Add dependencies:
   - root dev: `typescript`, `tsx`, `vitest`, `@types/node`
   - server: `fastify` or `express`, `ws`, `zod`, `better-sqlite3`, `nanoid`
   - daemon: `ws`, `zod`, `execa`, `nanoid`
   - web: `vite`, `react`, `react-dom`, `@vitejs/plugin-react`
3. Add scripts:
   ```json
   {
     "dev": "pnpm --parallel --filter @mini-slock/server --filter @mini-slock/web dev",
     "daemon": "pnpm --filter @mini-slock/daemon start",
     "test": "pnpm -r test",
     "typecheck": "pnpm -r typecheck",
     "verify": "pnpm typecheck && pnpm test"
   }
   ```
4. Run `pnpm install`.
5. Run `pnpm verify`; it should pass with placeholder tests.

**Acceptance:** `pnpm verify` passes.

---

## Task 2: Shared Protocol and Validation

**Objective:** Define protocol types and zod validators.

**Files:**
- `packages/shared/src/protocol.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/test/protocol.test.ts`

**TDD:**
1. Write tests that validate:
   - `ready` daemon message parses.
   - `agent:start` server message parses.
   - invalid runtime is rejected.
2. Run tests and confirm failure.
3. Implement zod schemas.
4. Run tests and confirm pass.

**Acceptance:** Shared package tests pass.

---

## Task 3: Server Data Model

**Objective:** Implement in-memory or SQLite-backed storage for MVP entities.

**Files:**
- `packages/server/src/db.ts`
- `packages/server/src/schema.ts`
- `packages/server/test/*`

**Keep it minimal:** SQLite is preferred, but in-memory store is acceptable if all tests pass and README says it is MVP-only.

**Entities:**
- channels
- messages
- machines
- agents

**TDD:**
1. Test creating default channel `general`.
2. Test inserting/listing messages.
3. Test creating/listing agents.
4. Test machine upsert from daemon ready.

**Acceptance:** Server store tests pass.

---

## Task 4: Server HTTP APIs

**Objective:** Add REST endpoints for the web UI.

**Files:**
- `packages/server/src/routes/agents.ts`
- `packages/server/src/routes/channels.ts`
- `packages/server/src/routes/messages.ts`
- `packages/server/src/routes/machines.ts`
- tests in `packages/server/test/`

**Endpoints:**

```text
GET  /api/channels
GET  /api/channels/:id/messages
POST /api/channels/:id/messages
GET  /api/agents
POST /api/agents
POST /api/agents/:id/start
POST /api/agents/:id/stop
GET  /api/machines
```

**Behavior:**
- Sending a message stores it.
- If request includes `agentId`, server delivers it to the agent's machine if agent is running.
- Starting an agent sends `agent:start` to the connected machine.
- Stopping an agent sends `agent:stop`.

**Acceptance:** API tests pass.

---

## Task 5: Server Daemon WebSocket

**Objective:** Implement daemon connection registry and protocol handling.

**Files:**
- `packages/server/src/ws/daemonSocket.ts`
- `packages/server/src/daemonRegistry.ts`
- `packages/server/src/events.ts`
- tests

**TDD:**
1. Test daemon can connect with key `dev-machine-key`.
2. Test invalid key is rejected.
3. Test `ready` registers/updates machine runtimes.
4. Test `agent:message` creates a channel message.
5. Test `agent:status` updates agent status.

**Acceptance:** WebSocket integration tests pass.

---

## Task 6: Server Browser Realtime WebSocket

**Objective:** Push new messages, agent status, and machine status to the UI.

**Files:**
- `packages/server/src/ws/browserSocket.ts`
- `packages/server/src/events.ts`
- tests

**Events to browser:**

```ts
type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'machine:update'; machine: Machine };
```

**Acceptance:** Tests show a browser WS client receives `message:new` after an agent message.

---

## Task 7: Daemon Runtime Detection

**Objective:** Detect availability and versions for Claude, Codex, Gemini.

**Files:**
- `packages/daemon/src/runtimeDetector.ts`
- `packages/daemon/test/runtimeDetector.test.ts`

**Runtime commands:**
- Claude: `claude --version`
- Codex: `codex --version`
- Gemini: `gemini --version`

**TDD:**
1. Mock command resolution/execution.
2. Test all three runtimes detected when binaries exist.
3. Test unavailable runtimes are omitted.
4. Test version strings are captured.

**Acceptance:** Runtime detector tests pass.

---

## Task 8: Daemon WebSocket Client

**Objective:** Connect daemon to server and exchange protocol messages.

**Files:**
- `packages/daemon/src/cli.ts`
- `packages/daemon/src/daemonClient.ts`
- tests

**CLI:**

```bash
mini-slock-daemon --server-url http://localhost:3000 --api-key dev-machine-key
```

**Behavior:**
- Convert http -> ws, https -> wss.
- Connect to `/daemon/connect?key=...`.
- On open, send `ready` with detected runtimes.
- Respond to `ping` with `pong`.
- Reconnect with exponential backoff.

**Acceptance:** Tests pass with a local mock ws server.

---

## Task 9: Agent Process Manager

**Objective:** Start, stop, and deliver messages to long-running agent processes.

**Files:**
- `packages/daemon/src/agentProcessManager.ts`
- `packages/daemon/src/drivers/types.ts`
- tests

**Driver interface:**

```ts
export interface RuntimeDriver {
  id: RuntimeId;
  detectModels?(): Promise<{ models: string[]; default?: string }>;
  buildCommand(ctx: AgentSpawnContext): RuntimeCommand;
  parseOutput?(line: string): AgentOutputEvent | null;
}
```

**TDD:**
1. Test `startAgent` creates workspace directory.
2. Test `startAgent` uses correct driver.
3. Test `deliverMessage` writes message to stdin.
4. Test `stopAgent` kills process.
5. Test stdout line parsed into `agent:message`.

**Acceptance:** Agent process manager tests pass using fake child process.

---

## Task 10: Simplified Agent Bridge Contract

**Objective:** Make runtime-agnostic prompting reliable enough for MVP.

**Approach:** Instead of full MCP first, inject a system prompt telling agents to output replies in a machine-readable format:

```text
When you want to send a chat reply, output exactly one line:
[[MINI_SLOCK_SEND_MESSAGE]] {"content":"..."}
```

Daemon parses this line and sends `agent:message` to server.

**Why:** Full MCP can come later. This keeps MVP small and supports Claude/Codex/Gemini uniformly.

**Files:**
- `packages/daemon/src/bridge/simpleToolBridge.ts`
- tests

**TDD:**
1. Test parser extracts JSON content from valid line.
2. Test parser ignores normal logs.
3. Test invalid JSON becomes activity/error, not crash.

**Acceptance:** Bridge parser tests pass.

---

## Task 11: Claude Driver

**Objective:** Implement Claude Code runtime adapter.

**Files:**
- `packages/daemon/src/drivers/claude.ts`
- tests

**Command shape:**

Use a conservative MVP command that supports stdin/stdout:

```bash
claude -p "<prompt>" --output-format stream-json --verbose --model <model>
```

For long-running mode, if stream-json bidirectional works in environment, use:

```bash
claude -p "<system prompt>" --input-format stream-json --output-format stream-json --verbose --model <model>
```

If bidirectional streaming is unreliable, implement per-message one-shot fallback:
- keep workspace and transcript file
- each delivery calls `claude -p` with recent history + new message
- parse output and send reply

**Important:** MVP correctness > persistent low-latency process. Per-message fallback is acceptable for all runtimes if long-running is hard.

**TDD:**
- Verify command includes `claude`.
- Verify model is included when specified.
- Verify prompt includes bridge instruction.

**Acceptance:** Claude driver tests pass.

---

## Task 12: Codex Driver

**Objective:** Implement Codex CLI runtime adapter.

**Files:**
- `packages/daemon/src/drivers/codex.ts`
- tests

**Command:** Inspect installed `codex --help` during implementation and choose the simplest non-interactive command. Prefer one-shot mode if available.

**Fallback requirement:** If Codex lacks reliable streaming, use one-shot per message with transcript context.

**TDD:**
- Verify command includes `codex`.
- Verify model/config is included if supported.
- Verify bridge prompt is included.

**Acceptance:** Codex driver tests pass and README documents any CLI assumptions.

---

## Task 13: Gemini Driver

**Objective:** Implement Gemini CLI runtime adapter.

**Files:**
- `packages/daemon/src/drivers/gemini.ts`
- tests

**Command:** Inspect installed `gemini --help` during implementation and choose simplest non-interactive command.

**Fallback requirement:** If Gemini lacks reliable streaming, use one-shot per message with transcript context.

**TDD:**
- Verify command includes `gemini`.
- Verify model/config is included if supported.
- Verify bridge prompt is included.

**Acceptance:** Gemini driver tests pass and README documents any CLI assumptions.

---

## Task 14: End-to-End Fake Runtime Test

**Objective:** Prove the full system works without requiring real Claude/Codex/Gemini during CI.

**Files:**
- `packages/daemon/test/fixtures/fake-agent-cli.ts`
- integration test in server or daemon package

**Fake CLI behavior:**
- Reads stdin or args.
- Outputs:
  ```text
  [[MINI_SLOCK_SEND_MESSAGE]] {"content":"Echo: <user message>"}
  ```

**Test:**
1. Start server on random port.
2. Start daemon configured with fake runtime driver.
3. Create agent.
4. Start agent.
5. Send channel message to agent.
6. Assert channel receives `Echo: ...` message.

**Acceptance:** E2E test passes deterministically.

---

## Task 15: Web UI Minimal Shell

**Objective:** Build the minimal web interface.

**Files:**
- `packages/web/src/App.tsx`
- `packages/web/src/api.ts`
- components listed above

**UI Requirements:**
- Sidebar: channel list, agent list, machine list.
- Main: selected channel messages.
- Composer: text input + optional agent selector + send button.
- Agent panel: create agent form and start/stop buttons.
- Machine panel: online machines and runtimes.

**TDD:**
Use React Testing Library if installed. Otherwise implement basic component tests with Vitest.

**Acceptance:** User can create/start an agent and send a message from UI manually.

---

## Task 16: Developer Experience and README

**Objective:** Make the project easy to run.

**Files:**
- `README.md`
- `scripts/verify.ts` or package scripts
- `.env.example`

**README Must Include:**
- What this is.
- Architecture diagram in text.
- Install commands.
- Running server/web.
- Running daemon.
- Creating first agent.
- Runtime prerequisites:
  - Claude Code installed and authenticated.
  - Codex CLI installed and authenticated.
  - Gemini CLI installed and authenticated.
- Limitations:
  - No production auth.
  - Dev machine key only.
  - Simplified bridge, not full MCP yet.
  - Local machine execution only.

**Acceptance:** Fresh user can follow README and run MVP.

---

## Final Verification Checklist

Claude Code must not stop until all are true:

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` succeeds.
- [ ] `pnpm test` succeeds.
- [ ] `pnpm verify` succeeds.
- [ ] Server starts with `pnpm --filter @mini-slock/server dev`.
- [ ] Web starts with `pnpm --filter @mini-slock/web dev`.
- [ ] Daemon starts with `pnpm --filter @mini-slock/daemon start -- --server-url http://localhost:3000 --api-key dev-machine-key`.
- [ ] Machine appears in UI after daemon connects.
- [ ] UI can create an agent with runtime `claude`.
- [ ] UI can create an agent with runtime `codex`.
- [ ] UI can create an agent with runtime `gemini`.
- [ ] Fake runtime E2E test proves message -> agent -> reply loop.
- [ ] README is accurate.

---

## Claude Code Execution Instructions

You are Claude Code implementing this repository from scratch.

Work loop:

1. Create/inspect repo.
2. Implement task by task using TDD.
3. After each task, run the relevant focused tests.
4. After major milestones, run `pnpm verify`.
5. If tests fail, debug and fix until green.
6. Do not skip Codex or Gemini support.
7. Do not replace tests with weaker tests just to pass.
8. Keep the scope minimal and working.
9. When complete, provide:
   - summary of implemented features
   - commands run
   - test results
   - known limitations
   - next recommended improvements

If real CLI behavior differs from assumptions, inspect `claude --help`, `codex --help`, and `gemini --help`, then adapt drivers while keeping tests and README updated.

