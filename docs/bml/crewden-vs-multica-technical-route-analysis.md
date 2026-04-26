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

## ⚡ 补充分析：任务传递、Agent 自主能力与问题解决闭环

> **补充日期：** 2026-04-27
> **分析视角：** 不再泛泛比较，聚焦三个深层维度——任务如何流转、agent 能自主走多远、从问题到解决的闭环差在哪里
> **目标：** 为 Crewden 0–12 个月的技术决策提供可执行的判断依据

---

### 一、任务互相传递 / Handoff / Workflow Relay

#### 1.1 Crewden 当前的任务传递机制

Crewden 已实现一套相当完整的任务传递链路，**比多数同类开源项目做得更深**：

**① 消息驱动的任务触发**

用户在频道发消息 → `classifyMessageIntent()` 判断意图（chat/task/goal）→ 如果是 goal 则启动 `startGoalAlignment()` 拆解多步任务，如果是 task 则直接创建。

证据：`packages/hub-core/src/goalAlignment.ts:12-57`

**② Server → Daemon → Agent 的三层投递**

```
Server:  notifyTaskAssignee(task)
         ├─ agent 在线 → agent:deliver（WebSocket push）
         └─ agent 离线 + autoStart → agent:start（唤醒 + 附带 wakeMessage）
Daemon:  收到消息 → 入 agent.inbox 队列 → runNext() 出队 → spawn CLI 进程
Agent:   执行完毕 → stdout 标记 / MCP / CLI 回报结果
```

证据：`packages/server/src/taskDelivery.ts:11-48`，`packages/daemon/src/agentProcessManager.ts:188-276`

**③ Agent-to-Agent 委派**

Agent A 可通过 `crewden delegate --to agentB --content "..."` 或 `[[CREWDEN_DELEGATE_AGENT]]` 标记将子任务委派给 Agent B。服务端创建 `AgentDelegation` 记录（状态：queued → delivered/started → failed），自动解析目标 agent 所在 machine 并投递。

证据：`packages/server/src/delegation.ts:11-89`

**④ Task Handoff（上下文保全）**

Agent 可执行 `crewden task handoff <taskId> --to agentB --notes "..." --next-step "..."`，handoff 会：
- 保留原始 goal、background、acceptanceCriteria
- 追加 handoffNotes 到 `task.context.handoffNotes[]` 数组
- 重新触发 `notifyTaskAssignee` 投递给新 assignee

证据：`packages/server/src/routes/internalAgent.ts` task handoff 路由

**⑤ Bridge 协议的统一性**

无论 runtime 是 Claude（MCP bridge）、Codex（oneshot）还是 Gemini（oneshot），都通过同一套 stdout 标记或 CLI 命令完成 handoff，不依赖运行时特定能力。

#### 1.2 Multica 的任务传递机制

Multica 走的是 **Issue-centric + Task Queue + JSONB Snapshot** 路线：

**① 原子性任务状态机**

`agent_task_queue` 表实现了严格的状态转移：queued → claimed → running → completed/failed。daemon 通过 HTTP 轮询（3s 间隔）原子 claim 任务，防止多 daemon 重复领取。

**② JSONB Snapshot 隔离**

任务分派时，后端将 workspace.context + issue + related_issues + attached_skills 打成一个 JSONB 快照写入 `agent_task_queue.context`。daemon 拿到快照后，执行期间 **不再查数据库**——完全离线推理。

**这个设计的核心好处：** 隔离了推理时间的数据一致性问题，也降低了数据库压力。

**③ 团队 Polymorphism**

Issue 的 `assignee_type IN ('member', 'agent')` 使人和 agent 在同一个分配界面中无差别对待。这不只是 UI 便利，而是让工作流引擎可以不区分执行者类型来调度。

#### 1.3 差距与机会

| 维度 | Crewden 现状 | Multica 现状 | Crewden 的差距 |
|------|-------------|-------------|---------------|
| **任务状态机** | task 有 status 但转移不严格（REST 直接 patch） | 原子 claim + 严格状态转移 | **需补齐：** task status 转移需要事务保证 + 防并发 |
| **上下文快照** | handoff 时拼接 context 字段，但无快照隔离 | JSONB snapshot，执行期 DB-free | **可选：** 对轻量架构不必强求，但长任务场景需要考虑 |
| **跨 agent 编排** | delegation + handoff 已有，但无 DAG | issue dependency graph（blocks/related） | **重要缺口：** 多 agent 协作需要依赖图 |
| **结果回传** | stdout 标记 → 服务端 → WebSocket 广播 | WebSocket 实时流 + 数据库事务写入 | **基本持平，** 但 Crewden 的 in-memory 状态有丢失风险 |
| **人 / agent 统一** | agent 有独立模型，无 user 表 | polymorphic actor model | **架构级差距：** 加 user 表后应统一 assignee 模型 |

**关键判断：** Crewden 的 handoff 机制在功能上已经 **不弱于 Multica**（甚至 handoffNotes 上下文保全比 Multica 的 snapshot 更细粒度），但缺的是 **编排层**——当 3 个以上 agent 需要协作时，没有依赖图和并行/串行控制。

---

### 二、Agent 自主能力 / Autonomy

#### 2.1 Crewden Agent 的自主能力矩阵

逐一评估 agent 自主运行的六个 primitive：

**① 上下文发现（Context Discovery）** ✅ 已有

Agent 可自主调用：
- `crewden inbox` → 获取任务、DM、提醒、review 请求
- `crewden work list` → inbox + next-step 指引
- `crewden message read --channel general` → 阅读频道消息
- `crewden knowledge search "query"` → 搜索知识库

证据：`packages/daemon/src/agentCli.ts:78`

**② 规划（Planning）** ⚠️ 部分有

- `goalAlignment` 系统可以对多步目标拆解出 agent 推荐、风险评估、澄清问题
- 但 **agent 自己不会主动规划**——规划是服务端 `goalAlignment.ts` 的逻辑，需要人触发
- agent 没有内置的"接到任务后先制定计划再执行"的 loop

证据：`packages/hub-core/src/goalAlignment.ts:83-107`

**③ 工具调用（Tool Invocation）** ✅ 已有

三层工具通道：
- MCP Bridge（Claude 专用）：`/internal/agent/:agentId/mcp-bridge`
- CLI 命令：`crewden message send`、`crewden task update` 等
- Stdout 标记：`[[CREWDEN_SEND_MESSAGE]]`、`[[CREWDEN_CREATE_TASK]]` 等

证据：`packages/daemon/src/bridge/simpleToolBridge.ts`，`packages/daemon/src/mcp/bridge.ts`

**④ 执行（Execution）** ✅ 已有，但有结构限制

- 每条消息 spawn 新进程（one-shot）→ **没有持续会话**
- Claude 通过 `--resume <sessionId>` 部分解决了会话续接
- Codex/Gemini 每次冷启动，无法利用上一轮结果

证据：`packages/daemon/src/drivers/claude.ts:58-59`

**⑤ 恢复（Recovery）** ⚠️ 基础有

- 进程退出码 ≠ 0 时标记 error，activity 记录错误
- 未完成的 inbox 消息不会被清除，下次启动可重试
- **但没有自动重试策略**——错误后 agent 就停了，需人工干预

证据：`packages/daemon/src/agentProcessManager.ts:250-286`

**⑥ 结果观察与反馈（Observability）** ✅ 已有

- `AgentActivity` 事件流：thinking → working → output → idle → error
- 实时 WebSocket 广播到前端
- Transcript 文件持久化完整对话记录

证据：`packages/shared/src/protocol.ts:301`

#### 2.2 Multica Agent 的自主能力

Multica 的 agent **更像一个"被调度的 worker"**，而非"自主 actor"：

- **无 inbox/CLI 自省：** agent 不能主动查看自己的待办、搜索知识库或阅读频道——它只能处理被分派的快照
- **无 planning primitive：** 没有 goal alignment 这样的拆解机制；任务粒度依赖人把 issue 写得足够细
- **但执行隔离更好：** 每个任务在独立 workspace 目录中运行，结果自动回流到 issue comment
- **Skill 系统是复用不是自主：** 成功执行变成模板，是 **知识积累** 而非 **agent 自主学习**

**关键判断：** Crewden 在 agent 自主性方面**实际上领先 Multica**——Crewden agent 可以自己看 inbox、搜索知识、创建任务、委派其他 agent，这些是 Multica agent 做不到的。但 Crewden 的短板在于 **planning 和 recovery** 两个 primitive 不完整。

#### 2.3 Crewden 应补齐的 Autonomy Primitives

不要盲目做大 SaaS，而是围绕 **agent-first / lightweight / self-hosted** 定位补齐以下 primitive：

| Primitive | 当前状态 | 应补什么 | 为什么 |
|-----------|---------|---------|-------|
| **Plan-before-Execute** | 无 | agent 收到 goal 后自动生成执行计划（step list），人可审核后再执行 | 没有计划的 agent 会盲目行动，任务成功率低 |
| **Auto-Retry with Backoff** | 无 | 进程失败后自动重试 1-2 次，指数退避，超限后 escalate | 当前 agent 遇错就死，需人工重启 |
| **Session Continuity** | 仅 Claude 有 | 所有 runtime 支持会话恢复或至少 context carryover | one-shot 模式对多轮任务是硬伤 |
| **Self-Verification** | review 系统已有 | agent 执行完后自己运行验证步骤（如跑测试），再标记 done | 当前 agent 说 done 就 done，没有自检 |
| **Proactive Blocking** | `task block` 已有 | agent 发现无法继续时自动 block + 通知管理者，而非静默失败 | 提高问题可见性，减少浪费时间 |
| **Memory Across Sessions** | knowledge layer 已有 | agent 主动写入/读取 per-agent memory（非全局知识库） | MEMORY.md workspace 已有基础，需串联到 CLI |

---

### 三、解决问题能力 / Problem-Solving Capability

#### 3.1 问题解决闭环的完整检查

一个 agent 系统要真正解决问题，需要以下 8 个环节形成闭环。逐一检查 Crewden 的现状：

| # | 环节 | Crewden 现状 | 评估 |
|---|------|-------------|------|
| 1 | **任务建模** | `classifyMessageIntent` + `goalAlignment`（拆解、风险评估、agent 推荐） | ✅ **已有雏形**，但依赖服务端规则匹配，没有 LLM 参与拆解 |
| 2 | **工具选择** | Agent 通过 system prompt 知道可用 CLI 命令 + MCP tools | ✅ **已有**，但工具列表是静态注入的，不能动态发现 |
| 3 | **执行** | Daemon spawn 进程，bridge 协议解析输出 | ✅ **已有**，one-shot 模式是限制但不是 blocker |
| 4 | **执行反馈** | `agent:activity` 事件流 + transcript 持久化 | ✅ **已有** |
| 5 | **错误恢复** | 进程退出码检测 + inbox 消息保留 | ⚠️ **基础有**，缺自动重试和自愈 |
| 6 | **验证** | `crewden review request` + evidence + approval workflow | ✅ **已有**，v1.4 review & acceptance 已落地 |
| 7 | **结果交付** | 消息回频道 + task status 更新 + WebSocket 广播 | ✅ **已有** |
| 8 | **审计记录** | delegation 表 + task progress events + transcript 文件 | ⚠️ **部分有**，但无统一审计日志表，in-memory 状态重启丢失 |

**结论：** 8 个环节中有 5 个已基本就绪，2 个部分就绪，1 个明显缺失（自动错误恢复）。**Crewden 不是"只做了 UI/transport/coordination"——问题解决链路的骨架已搭起来了**，但有两个关键短板：

#### 3.2 短板 A：Planning 层太薄

`classifyMessageIntent` 用关键词匹配判断意图，`buildClarifyingQuestions` 用正则检测缺失信息——这些是 **rule-based**，不是 agent-native 的。

问题：当用户说"帮我把这个仓库的 CI 从 GitHub Actions 迁移到 GitLab CI"，系统需要：
1. 理解涉及哪些 workflow 文件
2. 评估迁移难度和风险
3. 制定分步计划
4. 分配给合适的 agent

目前 goalAlignment 可以做 3 和 4（基于关键词匹配），但做不好 1 和 2（需要 LLM 参与分析）。

**建议：** 在 `goalAlignment` 中引入 LLM 调用——不是把整个流程交给 LLM，而是在"拆解计划"和"风险评估"两个节点调用一次 LLM，其余仍用规则。成本极低但效果显著。

#### 3.3 短板 B：错误恢复链路断裂

当前 flow：agent 进程崩溃 → 标记 error → 停。没有然后了。

应该的 flow：
```
agent 进程崩溃
 → 检查退出码和 stderr
 → 如果是 transient error（网络、rate limit）→ 自动重试（max 2 次，指数退避）
 → 如果是 permanent error（认证失败、工具不存在）→ 自动 escalate + 通知
 → 如果重试后仍失败 → block task + 通知管理者 + 记录审计日志
```

实现位置：`packages/daemon/src/agentProcessManager.ts:250-286` 的 `proc.on('close')` handler 中。

#### 3.4 Multica 的闭环对比

Multica 在 **执行隔离**（独立 workspace）和 **可观测性**（activity_log 审计表 + PostHog 漏斗）上更完善，但在 **planning** 和 **agent 自省** 上反而不如 Crewden。Multica 的 Skill 系统（成功执行自动变模板）是 Crewden knowledge layer 可以借鉴的方向。

---

### 四、路线建议（按时间段，具体到功能点和涉及文件）

#### 0–3 个月：补齐闭环，不做新功能

**目标：让现有链路每一环都可靠运行。**

| # | 功能 | 具体做什么 | 涉及文件 | 优先级 |
|---|------|----------|---------|-------|
| 1 | **Task 状态事务保证** | task status 更新走 SQLite 事务 + 乐观锁（`updatedAt` 版本号），防止并发 patch 冲突 | `packages/server/src/routes/tasks.ts`，`packages/server/src/db.ts` | P0 |
| 2 | **自动重试 + Escalation** | `agentProcessManager` 的 `close` handler 中加重试逻辑：transient error 重试 2 次，permanent error 自动 `task block` + 通知 | `packages/daemon/src/agentProcessManager.ts:250-286` | P0 |
| 3 | **统一审计日志表** | 新增 `audit_log` 表（who, what, when, task_id, agent_id, detail），所有 delegation、handoff、status change、error 写入 | `packages/server/src/schema.ts`，各 route 文件 | P1 |
| 4 | **In-memory 状态持久化** | machines registry、daemon connection state 重启后从 DB 恢复，不再丢失 | `packages/server/src/daemonRegistry.ts` | P1 |
| 5 | **Task Dependency Graph** | tasks 表加 `dependsOn: string[]`（blocked-by 关系），创建 task 时检查循环依赖，状态联动（blocker 完成后自动 unblock） | `packages/server/src/schema.ts`，`packages/server/src/routes/tasks.ts` | P1 |
| 6 | **Session Carryover for Codex/Gemini** | 在 agent workspace 中缓存上一轮输出摘要，下次 spawn 时作为 context 注入 prompt 前缀 | `packages/daemon/src/drivers/codex.ts`，`gemini.ts` | P2 |

#### 3–6 个月：提升 Planning 和 Self-Verification

**目标：让 agent 能"想清楚再干"，干完能"自己检查"。**

| # | 功能 | 具体做什么 | 涉及文件 |
|---|------|----------|---------|
| 7 | **LLM-Assisted Goal Decomposition** | `goalAlignment` 在拆解计划节点调用一次 LLM（用户绑定的 runtime），输出结构化 step list（JSON），人可编辑后确认执行 | `packages/hub-core/src/goalAlignment.ts`，新增 `goalPlanner.ts` |
| 8 | **Plan-Execute-Verify Loop** | agent 收到 task 后先输出计划（通过 `[[CREWDEN_PLAN]]` 新标记），daemon 等人确认（或超时自动执行），执行完后 agent 自跑验证步骤（如 `pnpm test`） | `packages/daemon/src/bridge/simpleToolBridge.ts`，`agentProcessManager.ts` |
| 9 | **Skill Capture from Successful Tasks** | task 标记 done + review approved 后，自动提取 execution pattern 存入 knowledge layer，标记为 `type: skill`，后续同类任务可检索复用 | `packages/server/src/routes/tasks.ts`，`packages/server/src/routes/knowledge.ts` |
| 10 | **Per-Agent Memory** | 扩展 `crewden knowledge` CLI，支持 `--scope agent:<id>` 参数，agent 可写入/读取自己的记忆（区别于全局知识库） | `packages/daemon/src/agentCli.ts`，`packages/server/src/routes/knowledge.ts` |
| 11 | **Runtime Plugin Interface** | 将 `packages/daemon/src/drivers/` 改为可注册的 plugin 接口（`RuntimeDriver` interface 已有，需加 dynamic import + config），优先加 cursor-agent、opencode | `packages/daemon/src/agentProcessManager.ts:12-16`，新增 plugin loader |

#### 6–12 个月：生态差异化 + 多 Agent 协作升级

**目标：让 Crewden 成为"最适合 self-hosted、小团队、agent-first 协作"的平台，而不是"功能更少的 Multica"。**

| # | 功能 | 具体做什么 | 差异化价值 |
|---|------|----------|----------|
| 12 | **Agent Orchestration DAG** | 可视化任务依赖图（基于 #5 的 dependency 数据），支持并行执行、汇合等待、条件分支 | Multica 只有 blocks/related 二元关系，Crewden 可以做更完整的编排 |
| 13 | **Workspace-level Agent Memory** | 基于 Cloudflare Vectorize（云）/ sqlite-vec（本地）实现语义搜索，agent 可检索历史任务、相似问题的解法 | 超越 Multica 的 pgvector 预留（他们还没实际接入） |
| 14 | **Agent Self-Improvement Loop** | 每次任务完成后自动 diff（成功 vs 失败模式），写入 per-agent skill memory，下次同类任务自动加载 | 这是 Multica Skill 系统的进化版——不只是参数化模板，而是学习 |
| 15 | **Federated Multi-Daemon** | 多台机器的 daemon 可以协作：task dependency 跨机器分发，按 runtime 能力路由 | Multica 用 Redis 解决多节点，Crewden 可以用 Cloudflare DO 做更轻量的分布式 |
| 16 | **Human-in-the-Loop Checkpoints** | 高风险任务自动插入检查点（基于 `inferGoalRiskLevel`），agent 到达检查点时暂停等待人类确认 | 安全性差异化，比 Multica 的全自动执行更适合生产环境 |

---

### 五、总结：Crewden 的核心策略

**不要追 Multica 的功能全集。** Multica 的方向是"企业级 Issue Board + 多租户 SaaS"，Crewden 不应该走这条路。

Crewden 的差异化定位应该是：

> **最轻量的 self-hosted agent-first 协作系统，agent 在这里不是被调度的 worker，而是有自主意识的团队成员。**

这意味着：
1. **深耕 agent autonomy**（planning → execution → verification → learning），这是 Multica 做不到的
2. **保持极简部署**（start.sh 一键 / Cloudflare 边缘），这是 Multica 不想做的
3. **补齐闭环可靠性**（错误恢复、审计日志、状态持久化），这是上线前必须做的
4. **不做多租户 SaaS**（至少 6 个月内），先做好单团队场景的极致体验

用一句话说：**让 agent 更聪明，而不是让平台更庞大。**

---

*补充分析由 Claude Opus 4.6 于 2026-04-27 基于 Crewden v1.5.1 代码和 Multica main 分支分析生成。*
