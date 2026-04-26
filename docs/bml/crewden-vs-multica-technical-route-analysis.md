# Crewden vs. Multica 技术路线深度对比分析

> **日期：** 2026-04-27
> **版本：** Crewden v1.5.1 / Multica main（2026-04 快照）
> **目的：** 架构层面技术路线比较，为 Crewden 后续方向决策提供依据
> **注意：** 文中所有凭据、密钥、token 均已脱敏标注为 `[REDACTED]`

---

## 一、Executive Summary

Crewden 和 Multica 在产品愿景上高度相似——都要把 AI agent 变成真实团队成员——但走的是截然不同的技术路线：

| 维度 | Crewden | Multica |
|------|---------|---------|
| 后端语言 | TypeScript / Node.js | Go |
| 前端 | React 18 + Vite（像素风） | Next.js 16 (App Router) |
| 数据库 | SQLite（本地）/ Durable Object（云） | PostgreSQL 17 + pgvector |
| 运行时支持 | 3 种（Claude、Codex、Gemini） | 8+ 种（含 Cursor、Hermes、Pi 等） |
| 多租户 | 无（单用户/单团队） | 有（workspace 隔离） |
| 身份认证 | 可选 token（dev 默认无密码） | 邮件 magic link + Google OAuth + JWT |
| 部署复杂度 | 极低（start.sh 一键 / Cloudflare 一键） | 中（Docker Compose 自托管） |
| 扩展性 | 受限（单节点 Durable Object） | 有（Redis 多节点 fan-out） |

**核心结论：** Crewden 当前优势在于极致轻量、Cloudflare 边缘部署与超低运维成本；劣势在于多用户隔离、生产级认证、数据库扩展性三块存在架构级短板。Multica 已经把这些补上，但代价是技术栈复杂度显著更高。

**建议方向（一句话版）：** Crewden 应该保持"极简自托管 + Cloudflare 边缘"的差异化定位，优先补齐生产级认证和多用户隔离，而非跟 Multica 拼功能全集。

---

## 二、Multica 技术路线概览

### 2.1 定位

"Your next 10 hires won't be human." Multica 把 AI agent 定义为可分配 Issue 的团队成员（Issue-assignee），强调团队协作与技能复用（Skill 复用系统）。支持 SaaS 托管（multica.ai）和自托管双模式。

### 2.2 架构图

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Next.js 16      │────▶│  Go (Chi) HTTP   │────▶│  PostgreSQL 17      │
│  (App Router)    │◀────│  + WebSocket     │◀────│  + pgvector         │
└──────────────────┘     └────────┬─────────┘     └─────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │  Redis (可选，多节点 fan-out) │
                    └─────────────┬─────────────┘
                                  │
               ┌──────────────────┴───────────────────┐
               │  用户本地 multica daemon               │
               │  (轮询任务队列，spawn CLI subprocess)  │
               └──────────────────────────────────────┘
```

**证据文件：**
- `/tmp/multica-main-crewden-analysis/server/cmd/server/main.go`（lines 148–222）
- `/tmp/multica-main-crewden-analysis/server/migrations/001_init.up.sql`

### 2.3 技术栈

- **后端：** Go 1.26 + Chi v5 HTTP router + Gorilla WebSocket + sqlc + pgx/v5
- **前端：** Next.js 16 (App Router) + Zustand + TanStack React Query + shadcn/ui + Tailwind CSS v4
- **DB：** PostgreSQL 17 + pgvector（为向量搜索预留）
- **队列/实时：** 内存 event bus + 可选 Redis（Pub/Sub / Streams 双模式）
- **认证：** JWT + 邮件验证码（via Resend）+ Google OAuth
- **部署：** Docker Compose；多阶段 Dockerfile；GHCR 镜像
- **桌面：** Electron（apps/desktop/，规划中）

### 2.4 Agent 执行模型

1. 用户通过 Web UI 将 Issue 指派给 agent
2. 服务端写入 `agent_task_queue`（状态：queued → dispatched → running → completed/failed）
3. 用户本地 daemon 轮询（默认 3s）拉取任务，spawn 对应 CLI 子进程
4. CLI 执行完毕后 daemon 上报结果，服务端广播 WebSocket 实时更新

支持 8+ 种 CLI runtime：claude、codex、gemini、openclaw、opencode、hermes、pi、cursor-agent
（证据：`/tmp/multica-main-crewden-analysis/CLI_AND_DAEMON.md`，lines 93–100）

### 2.5 独特设计

- **Skill 复用系统：** 成功任务自动变成可参数化模板，团队知识积累
- **polymorphic actor model：** comment/issue/activity 中 `author_type IN ('member','agent')`，人与 agent 无差别对待
- **issue dependency graph：** blocks/blocked_by/related 三类依赖关系
- **向量数据库预留：** pgvector 扩展已加载，为 RAG/语义搜索铺路
- **analytics 事件漏斗：** 完整 signup→workspace_created→agent_created→issue_executed 埋点（opt-in PostHog）

---

## 三、Crewden 当前路线概览

### 3.1 定位

自托管 AI agent 协作工作空间，面向小团队/个人开发者。Slack 风格频道 + agent 作为频道成员，目标是"AI agent 驱动的公司运营"。支持本地部署和 Cloudflare Workers 边缘部署。

### 3.2 架构图

```
┌──────────────────────────────────┐
│  React 18 + Vite :5173 (像素风)  │
└──────────────┬───────────────────┘
               │ HTTP REST + WebSocket (/ws)
               ▼
┌──────────────────────────────────────────┐
│  Fastify :3000 (Node.js)                 │
│  - SQLite via LibSQL + Drizzle ORM       │
│  - Browser WebSocket (/ws)               │
│  - Daemon WebSocket (/daemon/connect)    │
└──────────────┬───────────────────────────┘
               │ WebSocket
               ▼
┌──────────────────────────────────────────┐
│  Daemon (本地 Node.js 进程)               │
│  - 检测已安装的 CLI runtime               │
│  - AgentProcessManager：每条消息 spawn    │
│  - 解析 bridge 协议标记                   │
└──────────────┬───────────────────────────┘
               │ spawn child_process
               ▼
┌──────────────────────────────────────────┐
│  CLI Agents (claude/codex/gemini)         │
│  stdout: [[CREWDEN_SEND_MESSAGE]] 等标记  │
└──────────────────────────────────────────┘
```

**Cloudflare 模式：** Fastify 替换为 Cloudflare Worker + Durable Object，同一套 REST/WebSocket 接口
**证据：** `packages/cloudflare/src/index.ts`（137KB 单文件）

### 3.3 技术栈

- **全栈语言：** TypeScript（pnpm 工作区，6 个 package）
- **后端：** Fastify 4.27 + `@fastify/websocket` + LibSQL/Drizzle ORM（SQLite）
- **前端：** React 18 + Vite 5.2（像素艺术风格，`packages/web/src/pixel.css`）
- **云：** Cloudflare Workers + Durable Objects（替代 Node.js server）
- **运行时支持：** claude（stream-json）、codex（oneshot）、gemini（oneshot）
- **测试：** Vitest + jsdom + React Testing Library（56+ 用例）

### 3.4 Bridge 协议（创新点）

Daemon 逐行解析 agent stdout，识别自定义标记：

```
[[CREWDEN_SEND_MESSAGE]] {"content":"回复内容"}
[[CREWDEN_SEND_DM]] {"to":"agent_id","content":"..."}
[[CREWDEN_DELEGATE_AGENT]] {"agentId":"...","context":"..."}
[[CREWDEN_CREATE_TASK]] / [[CREWDEN_UPDATE_TASK]]
[[CREWDEN_SET_REMINDER]] / [[CREWDEN_CANCEL_REMINDER]]
```

证据：`packages/daemon/src/bridge/simpleToolBridge.ts`

### 3.5 状态与持久化

- **本地模式：** SQLite（`~/.crewden/data.db`），Drizzle ORM，18 张表
- **云模式：** Durable Object 内嵌 SQLite
- **实时同步：** 内存 event bus + WebSocket broadcast
- **Agent 工作区：** `~/.crewden/agents/<agentId>/`（transcript、MCP config、token）

证据：`packages/server/src/schema.ts`、`packages/server/src/events.ts`

### 3.6 版本路线

当前 v1.5.1，阶段二路线图（`docs/v1-phase-two-roadmap.md`）：

| 版本 | 特性 |
|------|------|
| v1.0 | Agent 角色定义 |
| v1.1 | 目标拆解 |
| v1.2 | Chat 目标对齐 |
| v1.3 | 自主工作循环 |
| v1.4 | 审核与验收 |
| v1.5 | 知识与记忆层（当前） |
| v1.6+ | 工具、策略、可靠性（草稿） |

---

## 四、差异对比表

| 维度 | Crewden | Multica | 差距评估 |
|------|---------|---------|----------|
| **技术栈** | 全 TypeScript | Go 后端 + TypeScript 前端 | Crewden 更易维护（单语言），Multica 后端性能更强 |
| **数据库** | SQLite（本地）/ DO SQLite（云） | PostgreSQL 17 + pgvector | Multica 胜出：并发、向量搜索、完整 SQL 支持 |
| **多租户** | 无（单 workspace） | workspace 隔离，多 member 角色 | Multica 胜出；Crewden 是架构级缺失 |
| **身份认证** | WEB_AUTH_TOKEN（可选）；daemon 用硬编码 `dev-machine-key` | JWT + magic link + Google OAuth | Multica 远胜；Crewden 无法生产使用 |
| **Agent 执行** | 每条消息 spawn 新进程（one-shot）| daemon 轮询 + 任务队列（持续） | 各有取舍（见下文分析） |
| **Runtime 覆盖** | 3 种（claude/codex/gemini） | 8+ 种（含 cursor-agent、hermes 等） | Multica 更广；Crewden 只覆盖主流 |
| **跨机器协作** | Cloudflare Hub（单 DO 实例）| Redis multi-node relay | Multica 更可靠；Crewden 受 DO 并发限制 |
| **实时协议** | WebSocket（内存 event bus） | WebSocket（内存 + Redis relay） | 功能相近，Multica 可水平扩展 |
| **持久化设计** | in-memory + SQLite 双模（部分数据） | 全量 PostgreSQL 事务写入 | Multica 更可靠；Crewden 有数据丢失风险 |
| **部署复杂度** | 极低（start.sh / Cloudflare 一键）| 中（Docker Compose，需 PostgreSQL）| Crewden 胜出 |
| **云原生程度** | 高（Cloudflare Workers + DO）| 中（Docker，可上 K8s）| Crewden 更 serverless；Multica 更传统 |
| **向量搜索/RAG** | 无 | pgvector 预留 | Multica 有路径；Crewden 需重构 |
| **Skill/知识复用** | KnowledgeEntry（结构化条目） | Skill 系统（可参数化模板） | 功能相近，Multica 更系统化 |
| **任务依赖图** | 目标对齐（goalAlignment），无图结构 | Issue dependency（blocks/related）| Multica 更完备 |
| **桌面应用** | 无 | Electron（规划中） | 均不完善 |
| **Analytics** | 无 | PostHog（opt-in）完整漏斗 | Multica 有产品度量；Crewden 盲飞 |
| **开源许可** | 未在 README 标注 | 开放源码（GitHub 公开） | 需确认 Crewden 授权策略 |
| **代码规模** | ~6 个 TS 包，约 1.5 万行 | Go + TS 双语言，规模更大 | Crewden 更易 review/贡献 |
| **测试覆盖** | Vitest 56+ 用例 | Go test + frontend Vitest + Playwright | Multica 更全面（E2E） |

---

## 五、Crewden 当前设计优势

### 5.1 极致低摩擦部署

`./start.sh` 或 `pnpm dev + pnpm daemon` 即可运行整个系统。Cloudflare Workers 模式通过 CI/CD 自动部署，无需管理服务器。对于个人用户和小团队，上手时间接近零。

证据：`README.md`（Quick Start 一节），`.github/workflows/deploy-cloudflare-hub.yml`

### 5.2 Cloudflare 边缘架构的独特性

Crewden 是极少数把完整 agent 编排服务部署在 Cloudflare Workers + Durable Objects 上的项目。这意味着：
- 无需服务器（全球边缘节点）
- 天然 HTTPS
- 极低持续运维成本（按请求计费）
- 内置 SQLite（DO storage）

竞品（包括 Multica）均需 PostgreSQL 等传统数据库，成本和运维复杂度更高。

证据：`packages/cloudflare/src/index.ts`（实现了完整 Worker + Durable Object 状态机）

### 5.3 Bridge 协议的轻量通用性

Multica 通过 daemon 轮询 task queue 来触发 agent；Crewden 通过 WebSocket push + stdout 标记解析来通信。Crewden 的 bridge 协议：
- 无需 agent CLI 实现特定 API，只需 stdout 输出特定标记
- 对 codex/gemini 等不支持 MCP 的 runtime 同样有效
- 比完整 MCP server 轻量得多

证据：`packages/daemon/src/bridge/simpleToolBridge.ts`

### 5.4 单语言全栈可维护性

全部 TypeScript，前后端共享类型（`@crewden/shared`），Zod schema 单一来源：
- 协议变更只改 `packages/shared/src/protocol.ts`，编译器在全栈报错
- 无 Go/TS 两套类型定义同步问题
- 小团队或 AI agent 单独维护代码库更容易

证据：`packages/shared/src/validation.ts`，`packages/hub-core/`

### 5.5 Agent-facing CLI 的 agent-first 理念

`crewden` CLI 让 agent 自己能调用：`message send`、`agent resolve`、`inbox`、`work list`、`task create` 等，并通过 per-agent token 验证身份。这种"agent 能感知并操控自身上下文"的设计超出了 Multica 当前已记录的功能范围。

证据：`packages/daemon/src/agentCli.ts`，`packages/daemon/src/mcp/bridge.ts`

### 5.6 丰富的目标/工作流层（路线图已落地）

v1.x 路线图的 goalBrief、goalAlignment、autonomous work loop、review & acceptance、knowledge layer 已从 v1.0 逐步落地到 v1.5.1，功能完备度超过 Multica 公开代码中 issue-based 任务流。

证据：`docs/v1.3-autonomous-work-loop.md`，`docs/v1.4-review-acceptance.md`，`docs/v1.5-knowledge-memory-layer.md`

---

## 六、劣势 / 风险

### 6.1 【高危】生产认证缺失

Daemon 连接服务端使用硬编码 `dev-machine-key`（源代码直接写死），浏览器 auth 是可选 token，不配置则完全匿名访问。README 明确标注"No production auth"。

**风险：** 任何人知道服务端地址即可连接 daemon、读写所有数据。
**证据：** `packages/server/src/ws/daemonSocket.ts`（`VALID_KEYS` 集合），`packages/server/src/browserAuth.ts`

### 6.2 【高危】无多用户隔离

Crewden 无 user/member 模型，无工作区隔离。所有频道、agent、消息对所有接入方可见。无法安全地给多人使用同一实例。

**对比：** Multica 有 workspace → member 关系，外加 owner/admin/member 三级权限。
**证据：** `packages/server/src/schema.ts` 无 user 表；`packages/shared/src/protocol.ts` 无 userId

### 6.3 【中危】SQLite 并发限制

本地模式单一 SQLite 文件，写并发极低（写锁互斥）。Cloudflare Durable Object 的 SQLite 也是单节点，全球只有一个 DO 实例处理所有请求，无法水平扩展。

**对比：** Multica 使用 PostgreSQL + 连接池（max_conns 25），支持 Redis 多节点。

### 6.4 【中危】One-shot 执行延迟

每条消息都会 spawn 新的 claude/codex/gemini 进程，启动开销约 2–5 秒，且无法实现真正的流式响应（Claude stream-json 除外）。对于需要长时间运行或连续多轮交互的任务，体验较差。

**对比：** Multica 的 daemon 是常驻进程，task queue 模式可支持长时间任务。

### 6.5 【中危】Cloudflare Durable Object 限制

单个 DO 实例有 CPU/内存/存储限制，无法水平分片。多个 daemon 机器同时高并发时存在吞吐瓶颈。Multica 通过 Redis Streams 解决了多节点 fan-out 问题。

### 6.6 【低危】Runtime 覆盖窄

只支持 3 种 runtime。用户想用 Cursor Agent、Hermes、OpenCode 等新兴工具时无法接入。Multica 已支持 8+ 种，且插件化架构更容易扩展。

**证据：** `packages/daemon/src/drivers/`（仅 claude.ts、codex.ts、gemini.ts 三个文件）

### 6.7 【低危】无向量搜索 / RAG 能力

Crewden 的 knowledge layer（v1.5）是结构化条目存储，无语义搜索。Multica 预留 pgvector，可直接接入 embedding-based 检索。

### 6.8 【低危】产品度量盲区

无任何 analytics 埋点，无法了解用户如何使用产品，功能迭代缺乏数据支撑。

---

## 七、建议路线（短中长期）

### 原则

Crewden 的核心差异化不应该是"功能数量"（Multica 功能更全），而应该是：
1. **极简部署**（继续保持，甚至强化）
2. **Cloudflare 边缘优先**（全球低延迟、serverless 成本）
3. **Agent-first 交互设计**（频道协作 + bridge 协议 + agent-facing CLI）
4. **单语言全栈**（TypeScript 降低贡献门槛）

### 短期（1–3 个月）

**优先级：生产可用 = 补齐安全短板**

1. **生产级 daemon 认证**
   - 废弃硬编码 `dev-machine-key`，改为持久化注册令牌（类似 Multica 的 PAT）
   - 在 `packages/server/src/ws/daemonSocket.ts` 中接入数据库校验
   - 支持令牌吊销

2. **最小化用户/多用户支持**
   - 增加 `users` 表 + `sessions` 表，支持邀请码或 email 注册
   - 不必做 workspace 多租户，但至少要区分"谁在操作"
   - 参考：Multica 的 magic link 方案成本低，可复用思路

3. **修复 in-memory 状态丢失**
   - `packages/server/src/` 中部分状态（machines、daemon registry）重启丢失
   - 确保所有关键状态都有 SQLite 持久化

### 中期（3–6 个月）

**优先级：扩展 runtime 生态 + 优化执行模型**

4. **Runtime 插件化 + 扩展到 5+ 种**
   - 将 `packages/daemon/src/drivers/` 改为可热加载的插件接口
   - 优先添加：cursor-agent、opencode（用户需求最高的开源 CLI）
   - 参考：Multica 的 `daemon_connection.runtime_info` JSONB 设计

5. **长时任务 + 任务队列**
   - 当前 one-shot 模式对长任务不友好
   - 增加 `agent_task_queue` 风格的持久化队列（利用现有 SQLite 可实现）
   - Daemon 改为轮询 + push 双触发

6. **Cloudflare DO 分片策略**
   - 当前单一 DO 实例是扩展瓶颈
   - 按 workspaceId 或 channelId hash 到多个 DO 实例
   - 参考 Multica 的 Redis Streams sharding 思路在 DO 层面等价实现

7. **基础 analytics 埋点**
   - 接入 PostHog（参考 Multica 的 opt-in 设计，不强制）
   - 最少度量：agent 创建数、消息数、任务完成率

### 长期（6 个月+）

**优先级：生态差异化 + 产品化路径**

8. **向量语义搜索 for Knowledge Layer**
   - Cloudflare 模式：使用 Vectorize（Cloudflare 向量数据库）
   - 本地模式：SQLite + sqlite-vec 扩展
   - 实现 knowledge entry 的语义检索，超越 Multica 的 pgvector 方案

9. **Desktop App（基于 Tauri，非 Electron）**
   - Multica 规划 Electron，但 Electron 打包体积大
   - Crewden 用 Tauri + Rust 包装现有 Web UI，更轻量，且可内嵌本地 daemon
   - 对个人用户体验大幅提升

10. **商业化路径：Cloudflare Hub SaaS**
    - 当前 Cloudflare 部署已有基础设施（test / prod 两环境）
    - 在现有架构上增加多租户 workspace 后，可直接作为 SaaS 提供
    - 差异化卖点：不依赖 PostgreSQL，纯 serverless，全球低延迟

---

## 八、可执行 Next Steps

按优先级排序（P0 = 立即，P1 = 本月，P2 = 下季度）：

| 优先级 | 任务 | 涉及文件 | 工作量估计 |
|--------|------|----------|-----------|
| P0 | 替换硬编码 `dev-machine-key`，实现持久化 daemon token 注册 | `packages/server/src/ws/daemonSocket.ts`，`packages/server/src/schema.ts` | 1–2 天 |
| P0 | 浏览器 auth 改为强制（非可选），支持多用户 session | `packages/server/src/browserAuth.ts`，`packages/server/src/schema.ts` | 3–5 天 |
| P1 | 将 in-memory machines registry 持久化到 SQLite | `packages/server/src/` 相关路由 | 1 天 |
| P1 | 增加 cursor-agent、opencode driver | `packages/daemon/src/drivers/`（新增两文件） | 2–3 天 |
| P1 | 接入 PostHog（opt-in）基础事件埋点 | `packages/web/src/App.tsx`，`packages/server/src/` | 1–2 天 |
| P2 | 持久化任务队列（agent_task_queue 表）| `packages/server/src/schema.ts`，`packages/daemon/src/agentProcessManager.ts` | 1 周 |
| P2 | Cloudflare DO 按 workspace 分片路由 | `packages/cloudflare/src/index.ts` | 1–2 周 |
| P2 | 向量搜索：Cloudflare Vectorize + 本地 sqlite-vec | `packages/server/src/`，`packages/cloudflare/src/` | 2 周 |
| P2 | Tauri 桌面应用探索 POC | 新 apps/desktop/ | 2–4 周 |

---

## 附录：关键证据文件索引

| 主题 | Crewden 文件 | Multica 文件 |
|------|-------------|-------------|
| 认证实现 | `packages/server/src/browserAuth.ts`，`packages/server/src/ws/daemonSocket.ts` | `server/internal/api/auth.go`，`.env.example`（JWT_SECRET） |
| Agent 执行 | `packages/daemon/src/agentProcessManager.ts` | `server/migrations/001_init.up.sql`（agent_task_queue 表），`CLI_AND_DAEMON.md` |
| Runtime 驱动 | `packages/daemon/src/drivers/{claude,codex,gemini}.ts` | `CLI_AND_DAEMON.md`（lines 93–100，8+ runtimes） |
| Bridge 协议 | `packages/daemon/src/bridge/simpleToolBridge.ts` | 无直接等价物（daemon 直接解析 CLI stdout） |
| 持久化 schema | `packages/server/src/schema.ts`（18 张表，SQLite） | `server/migrations/001_init.up.sql`（PostgreSQL） |
| 云部署 | `packages/cloudflare/src/index.ts`，`wrangler.jsonc` | `docker-compose.selfhost.yml`，`Dockerfile` |
| 实时同步 | `packages/server/src/ws/browserSocket.ts`，`packages/server/src/events.ts` | `server/cmd/server/main.go`（lines 180–221，Redis relay） |
| 路线图 | `docs/ROADMAP.md`，`docs/v1-phase-two-roadmap.md` | `README.md`（功能列表），`docs/analytics.md` |
| 多租户 | 无 | `server/migrations/001_init.up.sql`（workspace/member 表） |
| 知识层 | `docs/v1.5-knowledge-memory-layer.md` | Skill 系统（README.md） |

---

*文档由 Claude Sonnet 4.6 于 2026-04-27 基于代码 + 文档分析生成，未经 git commit，仅作工作区参考。*
