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
| v0.4.4 | Daemon Inbox + Resume | daemon 支持 inbox、wake message、busy 投递和 session resume | v0.4.3 |
| v0.4.5 | Agent Memory + Workspace Foundation | 每个 agent 有持久 workspace、MEMORY.md 和 notes | v0.4.4 |
| v0.4.6 | Agent MCP Bridge | MCP tools 复用 internal API，补齐结构化协作工具通道 | v0.4.3 |
| v0.5 | Workspace 文件浏览器 | Agent 工作目录文件树 + 文件预览 | v0.4 |
| v0.6 | Task Board | Kanban 看板，消息转任务，TODO/IN PROGRESS/REVIEW/DONE | v0.4 |
| v0.7 | Reminders | Agent 设置定时提醒，实时推送到 UI | v0.3 |
| v0.8 | 多 Channel + 搜索 | 创建/删除 channel，全局消息搜索 | v0.2 |

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
- [v0.4.4 — Daemon Inbox, Wake Messages & Runtime Resume](./v0.4.4-daemon-inbox-resume.md)
- [v0.4.5 — Agent Memory, Notes & Workspace Foundation](./v0.4.5-agent-memory-workspace.md)
- [v0.4.6 — Agent MCP Bridge & Collaboration Tool Parity](./v0.4.6-agent-mcp-and-tools.md)
- [v0.5 — Workspace 文件浏览器](./v0.5-workspace-browser.md)
- [v0.6 — Task Board](./v0.6-task-board.md)
- [v0.7 — Reminders](./v0.7-reminders.md)
- [v0.8 — 多 Channel + 搜索](./v0.8-channels-search.md)
