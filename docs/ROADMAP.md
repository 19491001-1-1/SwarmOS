# Xoxiang 迭代路线图

> 本文档是长期迭代规划总览。每个版本有独立的实现计划文档，可直接发给 Claude Code 自主执行。

---

## 版本概览

| 版本 | 主题 | 核心交付 | 依赖 |
|------|------|----------|------|
| v0.2 | 数据持久化 | SQLite store，重启不丢数据 | — |
| v0.3 | Agent 活动日志 | Activity 实时流，Thinking/Working/Output 状态 | v0.2 |
| v0.4 | Agent Profile + DM | Agent 详情页，Agent 之间私信通道 | v0.3 |
| v0.4.1 | Agent 恢复与 daemon 自动启动 | 修复冷启动误停 agent，daemon 连接后自动恢复应运行的 agent | v0.4 |
| v0.4.2 | Agent 委派与按需唤醒 | Agent 可主动委派并拉起另一个 agent 处理任务 | v0.4.1 |
| v0.4.3 | Agent-facing CLI + Internal API | 给 agent 注入 `xoxiang` CLI 和 per-agent token，支持查询/发送/委派 | v0.4.2 |
| v0.4.4 | Reliable Delivery + Daemon Inbox | 可靠投递与恢复调度层，支持 idleConfig、inbox、wake summary 和 Claude best-effort resume | v0.4.3 |
| v0.4.5 | Agent Memory + Workspace Foundation | 每个 agent 有持久 workspace、MEMORY.md 和 notes | v0.4.4 |
| v0.4.6 | Agent MCP Bridge | MCP tools 复用 internal API，补齐结构化协作工具通道 | v0.4.3 |
| v0.5 | Workspace 文件浏览器 | Agent 工作目录文件树 + 文件预览 | v0.4 |
| v0.6 | Task Board | Kanban 看板，消息转任务，TODO/IN PROGRESS/REVIEW/DONE | v0.4 |
| v0.7 | Reminders | Agent 设置定时提醒，实时推送到 UI | v0.3 |
| v0.8 | 多 Channel + 搜索 | 创建/删除 channel，全局消息搜索 | v0.2 |
| v0.9 | Chat Experience + Threads | 头像状态、Markdown 消息、@mention 渲染、群聊 Thread 聚焦讨论 | v0.8 |
| v0.9.1 | UI Polish | 右侧边栏按需出现，左侧菜单 hover/active 动效和布局微调 | v0.9 |
| v0.9.2 | Mobile Responsive | 移动端 top bar、sidebar drawer、right rail overlay、Composer 和 Markdown 自适应 | v0.9.1 |
| v0.9.3 | Web Login & Session Protection | Web 登录页、浏览器登录态、API/WebSocket 统一认证和退出登录 | v0.9.2 |
| v1.0 | Lightweight Agent Roles | 轻量角色、职责、能力、工作风格和交接偏好，复用当前 profile | v0.6/v0.8 |
| v1.1 | Goal Brief & Work Breakdown | 用户目标结构化成 brief、任务、依赖和验收标准 | v1.0 |
| v1.2 | Goal Alignment in Chat | 复用当前聊天完成目标澄清、计划对齐、分工和确认 | v1.1 |
| v1.3 | Autonomous Work Loop | Agent 主动拉取、认领、推进、交接、升级任务 | v1.1 |
| v1.4 | Quality & Review System | Reviewer、QA gate、验收证据、返工流程 | v1.3 |
| v1.5 | Knowledge & Memory Layer | 项目知识、决策沉淀、经验检索、外部知识库 adapter 预研 | v1.3 |
| v1.6 | Draft: Tools & Credentials | 草稿：工具权限、凭据治理、外部服务集成，待重新设计 | v1.4 |
| v1.7 | Draft: Strategy & Research | 草稿：研究、批判、方案生成和创新提案，待重新设计 | v1.5 |
| v1.8 | Draft: Reliability & Scale | 草稿：审计、成本、SLA、多 daemon、可靠队列，待重新设计 | v1.6 |

---

## 各版本独立实现文档索引

- [v0.2 — 数据持久化](./v0.2-persistence.md)
- [v0.3 — Agent Activity Log](./v0.3-activity-log.md)
- [v0.4 — Agent Profile & DMs](./v0.4-agent-profile-dm.md)
- [v0.4.1 — Agent Recovery & Daemon Auto Start](./v0.4.1-agent-recovery.md)
- [v0.4.2 — Agent Delegation & Wake-on-Demand](./v0.4.2-agent-delegation.md)
- [v0.4.3 — Agent-Facing CLI & Internal Agent API](./v0.4.3-agent-facing-cli.md)
- [Agent-Facing CLI Reference](./agent-facing-cli-reference.md)
- [Agent CLI Reference](./agent-cli-reference.md)
- [v0.4.4 — Reliable Delivery, Daemon Inbox & Resume](./v0.4.4-daemon-inbox-resume.md)
- [v0.4.5 — Agent Memory, Notes & Workspace Foundation](./v0.4.5-agent-memory-workspace.md)
- [v0.4.6 — Agent MCP Bridge & Collaboration Tool Parity](./v0.4.6-agent-mcp-and-tools.md)
- [v0.5 — Workspace 文件浏览器](./v0.5-workspace-browser.md)
- [v0.6 — Task Board](./v0.6-task-board.md)
- [v0.7 — Reminders](./v0.7-reminders.md)
- [v0.8 — 多 Channel + 搜索](./v0.8-channels-search.md)
- [v0.9 — Chat Experience, Presence & Threads](./v0.9-chat-experience.md)
- [v0.9.1 — UI Polish: Adaptive Right Rail & Sidebar Hover](./v0.9.1-ui-polish.md)
- [v0.9.2 — Mobile Responsive Workspace](./v0.9.2-mobile-responsive.md)
- [v0.9.3 — Web Login & Session Protection](./v0.9.3-web-login-auth.md)
- [v1.0 — Lightweight Agent Roles & Capabilities](./v1.0-agent-roles.md)
- [v1.x — Phase Two Roadmap: Role, Goal & Memory](./v1-phase-two-roadmap.md)
