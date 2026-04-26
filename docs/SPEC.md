# Crewden — Spec Doc

> 本文档是项目的长期规格说明，记录系统设计、协议约定、开发规范和迭代路线图。所有重大变更应同步更新此文档。

---

## 1. 项目概述

**Crewden** 是一个自托管的 AI Agent 协作工作台，类似 Slack + AI agents 的协作产品。用户可以在 Web 界面创建和管理 AI Agent，通过聊天频道与 Agent 交互。Agent 在本地机器上以 CLI 进程方式运行，支持 Claude Code、Codex CLI、Gemini CLI 三种 runtime。

**核心价值：**
- 完全自托管，数据不出本地
- 支持多种 AI runtime，统一交互界面
- 轻量级架构，无数据库依赖（MVP）
- 像素风 UI，工具感强

### 1.1 Phase Two Product Direction

v1.x 阶段的产品目标是从“Agent 协作工作台”升级为围绕目标运转的 Agent 协作系统。系统不复制复杂的人类组织架构，而是让一组 Agent 基于轻量角色、职责能力、目标上下文和知识记忆持续协作。

第二阶段的详细路线图见 [v1.x — Phase Two Roadmap: Role, Goal & Memory](./v1-phase-two-roadmap.md)。所有 v1.x 设计应遵循以下方向：

- 目标从聊天中自然产生：用户仍在当前聊天里表达目标，系统负责澄清、拆解、分工和验收。
- 信息传递默认结构化：handoff 必须携带背景、事实、决策、验收标准、风险、证据和下一步。
- Agent 有轻量角色画像：职责、能力、工作风格、交接偏好和边界是一等概念；部门、汇报线和组织图不是 v1.0 重点。
- 自主性来自产品机制：inbox、claim、handoff、escalation、review 和 evidence 要进入系统模型。
- 知识层是核心能力：项目档案、决策、经验和外部知识库 adapter 应逐步支撑 Agent 复用上下文。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + Vite :5173)                       │
│  - Sidebar: channels / agents / machines            │
│  - ChannelView: 消息列表（像素风头像，消息分组）        │
│  - AgentPanel: 创建/启停 agent                       │
│  - Composer: 消息输入（IME 安全，像素风按钮）           │
└──────────────┬──────────────────────────────────────┘
               │ HTTP REST + WebSocket (/ws)
               ▼
┌─────────────────────────────────────────────────────┐
│  Server (Fastify + Node.js :3000)                   │
│  - 内存 Store: channels / messages / agents / machines│
│  - REST API: /api/channels, /api/agents, /api/machines│
│  - Daemon WebSocket: /daemon/connect?key=...        │
│  - Browser WebSocket: /ws (push 实时事件)            │
└──────────────┬──────────────────────────────────────┘
               │ WebSocket (daemon protocol)
               ▼
┌─────────────────────────────────────────────────────┐
│  Daemon (Node.js)                                   │
│  - Runtime 探测: claude / codex / gemini            │
│  - AgentProcessManager: 每条消息 spawn 一个 CLI 进程  │
│  - 驱动层: claude.ts / codex.ts / gemini.ts         │
│  - Bridge 解析: [[CREWDEN_SEND_MESSAGE]] 协议     │
│  - Fallback: 无 bridge marker 时发送完整 stdout       │
└──────────────┬──────────────────────────────────────┘
               │ spawn child_process
               ▼
┌─────────────────────────────────────────────────────┐
│  CLI Agents                                         │
│  claude -p <msg> --system-prompt <sp> --output-format text │
│  codex exec <msg> --skip-git-repo-check -c system_prompt=... │
│  gemini -p <msg> --output-format text -y            │
└─────────────────────────────────────────────────────┘
```

---

## 3. Monorepo 结构

```
crewden/
├── package.json              # root scripts: dev, daemon, test, verify
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── start.sh                  # 一键启动脚本
├── README.md                 # 用户文档
├── SPEC.md                   # 本文档
├── .env.example
├── scripts/
│   └── verify.ts
└── packages/
    ├── shared/               # @crewden/shared
    │   └── src/
    │       ├── protocol.ts   # TypeScript 类型定义
    │       └── validation.ts # Zod schema
    ├── server/               # @crewden/server
    │   └── src/
    │       ├── app.ts
    │       ├── db.ts         # 内存 Store
    │       ├── events.ts     # 事件总线
    │       ├── daemonRegistry.ts
    │       ├── routes/       # agents, channels, messages, machines
    │       └── ws/           # daemonSocket, browserSocket
    ├── daemon/               # @crewden/daemon
    │   └── src/
    │       ├── cli.ts
    │       ├── daemonClient.ts
    │       ├── runtimeDetector.ts
    │       ├── agentProcessManager.ts
    │       ├── bridge/
    │       │   └── simpleToolBridge.ts
    │       └── drivers/
    │           ├── types.ts
    │           ├── claude.ts
    │           ├── codex.ts
    │           └── gemini.ts
    └── web/                  # @crewden/web
        └── src/
            ├── App.tsx
            ├── api.ts
            ├── pixel.css     # 像素风全局样式 token
            └── components/
                ├── Sidebar.tsx
                ├── ChannelView.tsx
                ├── Composer.tsx
                ├── AgentPanel.tsx
                └── MachinePanel.tsx
```

---

## 4. 协议规范

### 4.1 Daemon ↔ Server WebSocket 协议

连接端点：`ws://localhost:3000/daemon/connect?key=<api-key>`

**Daemon → Server：**

```ts
type DaemonToServer =
  | { type: 'ready'; hostname: string; os: string; daemonVersion: string;
      runtimes: RuntimeId[]; runtimeVersions: Record<string, string>;
      runningAgents: string[]; capabilities: string[] }
  | { type: 'pong' }
  | { type: 'agent:status'; agentId: string; status: AgentStatus; launchId?: string }
  | { type: 'agent:message'; agentId: string; channelId: string; content: string }
  | { type: 'agent:deliver:ack'; agentId: string; seq: number };
```

**Server → Daemon：**

```ts
type ServerToDaemon =
  | { type: 'ping' }
  | { type: 'agent:start'; agentId: string; config: AgentRuntimeConfig; launchId: string; wakeMessage?: AgentDelivery }
  | { type: 'agent:stop'; agentId: string }
  | { type: 'agent:deliver'; agentId: string; seq: number; message: AgentDelivery;
      config?: AgentRuntimeConfig; channelId?: string };  // config 用于 daemon 重启后自动恢复
```

### 4.2 Browser ↔ Server WebSocket 协议

连接端点：`ws://localhost:3000/ws`

**Server → Browser（推送）：**

```ts
type BrowserEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'agent:update'; agent: Agent }
  | { type: 'machine:update'; machine: Machine };
```

### 4.3 Agent Bridge 协议

Agent 进程通过 stdout 输出以下格式发送消息：

```
[[CREWDEN_SEND_MESSAGE]] {"content":"回复内容"}
```

**Fallback 机制：** 若 agent 进程退出时未输出任何 bridge marker（如 codex 输出纯文本），daemon 将完整 stdout 作为回复发送。

### 4.4 REST API

```
GET    /api/channels
GET    /api/channels/:id/messages
POST   /api/channels/:id/messages     body: { content, senderName, agentId? }

GET    /api/agents
POST   /api/agents                    body: AgentRuntimeConfig + { machineId? }
PATCH  /api/agents/:id                body: { machineId? }  (重新绑定 machine)
POST   /api/agents/:id/start
POST   /api/agents/:id/stop

GET    /api/machines
```

---

## 5. 关键设计决策

### 5.1 内存 Store（非 SQLite）

**原因：** `better-sqlite3` 在 Node.js 24 上编译失败（native binding 不兼容）。MVP 阶段使用 Map-based 内存 store，重启后数据丢失。

**后续：** 迁移到 SQLite（待 better-sqlite3 支持 Node 24）或 Prisma + SQLite。

### 5.2 One-shot 进程模式（非长驻进程）

**原因：** 长驻 stdin/stdout 双向流在三种 CLI 中行为不一致，调试困难。One-shot 模式每条消息 spawn 一个新进程，稳定可靠。

**代价：** 每次都要重新加载 CLI，响应延迟 2-5 秒。

**后续：** 可以为 claude 实现持久进程模式（`--input-format stream-json`）。

### 5.3 Daemon 重启恢复

**原因：** Daemon 重启后内存中的 agent 映射丢失，但 server 端 agent 记录还在。

**方案：** `agent:deliver` 消息携带 `config` 和 `channelId` 字段，daemon 收到后自动重建 agent 条目。

### 5.4 Codex Fallback

**原因：** Codex CLI 输出纯文本，不支持 bridge marker 格式。

**方案：** `agentProcessManager` 在进程退出时，若未检测到 bridge marker，将完整 stdout 作为回复发送。

### 5.5 像素风 UI

**设计语言：**
- 字体：`Courier New` monospace（全局）
- 边框：`2px solid #000`，零圆角
- 配色：亮黄 `#FFD700`（侧边栏）、品红 `#FF4D8D`（选中/强调）、白底（主区域）
- 按钮：offset shadow `3px 3px 0 #000`，点击时 translate(2px, 2px)
- 头像：4×4 像素马赛克格子，基于名字 hash 生成配色

---

## 6. 开发规范

### 6.1 提交前检查

```bash
pnpm verify   # typecheck + 全量测试（56 个测试）
```

### 6.2 测试策略

- **单元测试**：drivers、bridge、runtimeDetector
- **集成测试**：server API（`isolate: false`，共享内存 store 单例）
- **E2E 测试**：`packages/daemon/test/e2e.test.ts`，使用 fake-agent-cli 验证完整链路
- **不 mock 数据库**：vitest `isolate: false` 保证测试和代码共享同一 store 实例

### 6.3 新增 Runtime

1. 在 `packages/daemon/src/drivers/` 新建 `<runtime>.ts`，实现 `RuntimeDriver` 接口
2. 在 `agentProcessManager.ts` 的 `DRIVERS` map 中注册
3. 在 `runtimeDetector.ts` 中添加探测逻辑
4. 在 `packages/shared/src/protocol.ts` 的 `RuntimeId` 中添加新值
5. 补充 `packages/daemon/test/drivers.test.ts` 测试用例

### 6.4 新增 API 端点

1. 在对应 `packages/server/src/routes/*.ts` 中添加路由
2. 在 `packages/server/test/` 中添加测试（注意 `isolate: false`）
3. 在 `packages/web/src/api.ts` 中添加前端调用函数

---

## 7. 已知问题 & 局限性

| 问题 | 说明 | 优先级 |
|------|------|--------|
| 数据不持久 | 重启 server 丢失所有数据 | 高 |
| 无认证 | 仅 `dev-machine-key`，不可暴露公网 | 高 |
| One-shot 延迟 | 每条消息 2-5s 响应延迟 | 中 |
| 无多 workspace | 只有一个默认 workspace | 低 |
| 无 DM/Thread | 只有 channel 消息 | 低 |
| Daemon 重启需手动重绑 machine | agent 绑定的 machineId 在 daemon 重启后变化 | 中 |

---

## 8. 迭代路线图

### v0.2 — 持久化
- [ ] 迁移 store 到 SQLite（better-sqlite3 或 Drizzle ORM）
- [ ] Server 重启后恢复 channels / agents 数据
- [ ] Agent 状态持久化

### v0.3 — 稳定性
- [ ] Daemon 重启后自动重绑 machineId（server 端按 hostname 匹配）
- [ ] Agent 消息队列（防止并发 deliver 竞争）
- [ ] 错误重试机制

### v0.4 — 体验提升
- [ ] Claude persistent 进程模式（减少延迟）
- [ ] 消息 Markdown 渲染
- [ ] Agent 运行日志实时查看
- [ ] 多 channel 支持

### v0.5 — 功能扩展
- [ ] MCP 协议支持（替代简单 bridge）
- [ ] Agent 工具调用（文件读写、代码执行）
- [ ] 多用户 / 基础认证

---

## 9. 本地开发快速启动

```bash
# 安装依赖
pnpm install

# 一键启动（server + web + daemon）
./start.sh

# 或分别启动
pnpm dev                          # server :3000 + web :5173
pnpm daemon -- --server-url http://localhost:3000 --api-key dev-machine-key

# 验证
pnpm verify
```

**环境要求：**
- Node.js 20+（已在 24 上验证）
- pnpm 8+
- 至少安装一种 CLI runtime（claude / codex / gemini）

---

## 10. 目录说明速查

| 路径 | 说明 |
|------|------|
| `packages/shared/src/protocol.ts` | 所有 TypeScript 类型定义 |
| `packages/shared/src/validation.ts` | Zod schema（与 protocol.ts 保持同步） |
| `packages/server/src/db.ts` | 内存 Store 实现 |
| `packages/server/src/ws/daemonSocket.ts` | Daemon WebSocket 处理逻辑 |
| `packages/daemon/src/agentProcessManager.ts` | 进程生命周期管理 + bridge 解析 |
| `packages/daemon/src/bridge/simpleToolBridge.ts` | Bridge 协议解析/构建 |
| `packages/daemon/src/drivers/` | 各 runtime 的命令构建逻辑 |
| `packages/web/src/pixel.css` | 像素风 CSS token |
| `packages/web/src/components/` | React 组件 |
| `start.sh` | 一键启动脚本（自动清理旧 daemon 进程） |
