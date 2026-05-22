# SwarmOS

基于 Crewden 骨架构建的 **AI Agent 协同开发平台**。支持多 Agent 动态编排、安全执行控制、可观测性面板和实时协作通信。

> 项目名称 SwarmOS = Swarm（蜂群）+ OS（操作系统），寓意像蜂群一样协作、像操作系统一样调度的 Agent 平台。

## 架构

```
Browser (React/Vite)
    |  HTTP REST + WebSocket (/ws)
    v
Server (Fastify + Node.js)  ← SQLite (via better-sqlite3)
    |  WebSocket (/daemon/connect)
    v
Daemon (Node.js)            ← 风险策略 & MCP Bridge
    |  spawn child processes
    v
CLI Agents: claude | codex | gemini
```

**四层架构**：Browser → Server → Daemon → CLI Agent，每层职责清晰，协议层由 Zod Schema 强约束。

## 包结构

```
packages/
  shared/       - Zod 协议定义、类型共享
  server/       - Fastify HTTP + WebSocket 服务端（中台调度）
  daemon/       - Agent 进程管理、运行时驱动、MCP 桥接、风险策略
  web/          - React + Vite 前端
  cloudflare/   - Cloudflare Worker 中央 Hub（可选部署）
  hub-core/     - Hub 核心逻辑（测试辅助）
```

## 核心功能

### 动态智能体工厂 (Swarm/Init)
- 运行时根据配置动态组装 Agent，非静态预设
- 支持批量启动多个 Agent，分配不同角色（developer / reviewer / observer）
- 每个 Agent 可配置工具白名单（allowed_tools）

### 中台调度与通信
- Agent 生命周期管理：start / stop / 状态实时流转
- 多频道聊天，支持 @mention、Thread 子对话框
- Agent 间私信 (DM) 和任务委派 (Delegation)
- WebSocket 双通道实时推送（Browser `/ws` + Daemon `/daemon/connect`）

### 安全执行控制
- **文件排他锁**：并发写入同一文件自动排队，锁释放后自动重试
- **命令超时强杀**：默认 60s 超时，超时自动 SIGKILL
- **双重风险防线**：Server 端 17 规则 + Daemon 端 17 规则，拦截 rm -rf / sudo / chmod 777 等危险操作
- **审批流状态机**：planned → risk_detected → awaiting_approval → approved/rejected → executing → finished

### 可观测性面板 (Observability)
- **Thought Stream**：Agent 思考流，thinking/working/output 日志独立于聊天展示
- **Approval Cards**：高危动作审批卡，支持 APPROVE / REJECT
- **Active File Locks**：实时文件锁状态
- **Action Timeline**：action 全生命周期时间线

### 协作工具
- **Task Board**：任务看板，创建/认领/流转/审查
- **Goal + Alignment**：从聊天消息创建目标 → 澄清需求 → 拆解为任务
- **Knowledge Base**：知识库，支持 decision / runbook / learning 等 6 种类型
- **Workspace Browser**：Agent 工作区文件浏览器

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Fastify + TypeScript + better-sqlite3 |
| 守护进程 | Node.js + TypeScript |
| Agent 运行时 | Claude Code / Codex CLI / Gemini CLI |
| 协议校验 | Zod |
| 测试 | Vitest |
| 包管理 | pnpm (monorepo) |

## 快速开始

### 前置条件
- Node.js >= 18
- pnpm >= 9
- 至少一个 CLI Agent 运行时已安装并认证：
  - **Claude Code**: `npm install -g @anthropic-ai/claude-code`
  - **Codex CLI**: `npm install -g @openai/codex`
  - **Gemini CLI**: `npm install -g @google/gemini-cli`

### 安装

```bash
git clone https://github.com/19491001-1-1/SwarmOS.git
cd SwarmOS
pnpm install
```

### 启动开发环境

```bash
# 终端 1：启动 Server + Web UI (http://localhost:5173)
pnpm dev

# 终端 2：启动 Daemon（连接本地 Server）
pnpm daemon --server-url http://localhost:3000 --api-key dev-machine-key
```

- Server API: http://localhost:3000
- Web UI: http://localhost:5173

### 创建第一个 Agent

1. 打开 http://localhost:5173
2. 确认 Daemon 已连接（侧边栏 Machines 区域显示在线）
3. 点击侧边栏 **SWARM INIT** 或通过 Agents 面板创建 Agent
4. 选择运行时（claude/codex/gemini），指定角色和工具
5. 点击 **INIT**，Agent 自动启动
6. 在频道中发送消息，Agent 会实时回复

### 验证

```bash
pnpm verify          # typecheck + 全部测试 (422 test cases)
pnpm test            # 仅运行测试
pnpm typecheck       # 仅类型检查
```

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `SERVER_URL` | Server 地址 | `http://localhost:3000` |
| `WEB_AUTH_TOKEN` | Web 端认证 Token | `2026` (dev 模式) |
| `E2E_ALLOW_EXEC` | E2E 测试模拟执行 | `true` |
| `CREWDEN_VERSION` | 版本号 (CI 注入) | package version |
| `VITE_APP_VERSION` | 前端版本号 | package version |

详见 [.env.example](.env.example)

## Cloudflare Hub 部署

如需公网访问，部署 Cloudflare Worker 作为中央 Hub：

```bash
pnpm --filter @crewden/cloudflare exec wrangler login
pnpm --filter @crewden/cloudflare run deploy
```

配置 Secrets：
```bash
printf '%s' '<daemon-key>' | pnpm --filter @crewden/cloudflare exec wrangler secret put DAEMON_API_KEY
printf '%s' '<web-token>'  | pnpm --filter @crewden/cloudflare exec wrangler secret put WEB_AUTH_TOKEN
```

CI/CD 通过 GitHub Actions 自动部署（push main 触发）。

## 已知限制

- **开发模式认证**：默认 `dev-machine-key` 和 `2026` Token，请勿直接暴露公网
- **本地执行**：Daemon 必须与 CLI 工具运行在同一台机器上
- **单 Daemon 实例**：每个 Machine 一个 Daemon 进程

## License

MIT
