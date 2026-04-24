# Xoxiang 迭代路线图

> 本文档是长期迭代规划总览。每个版本有独立的实现计划文档，可直接发给 Claude Code 自主执行。

---

## 版本概览

| 版本 | 主题 | 核心交付 | 依赖 |
|------|------|----------|------|
| v0.2 | 数据持久化 | SQLite store，重启不丢数据 | — |
| v0.3 | Agent 活动日志 | Activity 实时流，Thinking/Working/Output 状态 | v0.2 |
| v0.4 | Agent Profile + DM | Agent 详情页，Agent 之间私信通道 | v0.3 |
| v0.5 | Workspace 文件浏览器 | Agent 工作目录文件树 + 文件预览 | v0.4 |
| v0.6 | Task Board | Kanban 看板，消息转任务，TODO/IN PROGRESS/REVIEW/DONE | v0.4 |
| v0.7 | Reminders | Agent 设置定时提醒，实时推送到 UI | v0.3 |
| v0.8 | 多 Channel + 搜索 | 创建/删除 channel，全局消息搜索 | v0.2 |

---

## 各版本独立实现文档索引

- [v0.2 — 数据持久化](./v0.2-persistence.md)
- [v0.3 — Agent Activity Log](./v0.3-activity-log.md)
- [v0.4 — Agent Profile & DMs](./v0.4-agent-profile-dm.md)
- [v0.5 — Workspace 文件浏览器](./v0.5-workspace-browser.md)
- [v0.6 — Task Board](./v0.6-task-board.md)
- [v0.7 — Reminders](./v0.7-reminders.md)
- [v0.8 — 多 Channel + 搜索](./v0.8-channels-search.md)
