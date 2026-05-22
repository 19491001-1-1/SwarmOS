# SwarmOS 项目目录结构

更新时间：2026-05-22

## 根目录职责

| 目录 | 职责 |
|------|------|
| `packages/` | 主业务代码（6 packages） |
| `tools/` | 本地 mock 与联调工具 |
| `scripts/` | 部署与运维脚本 |
| `docs/` | 产品、技术、运营文档 |
| `.github/` | CI/CD 工作流 |

## 文档结构 (`docs/`)

```
docs/
├── guides/            # 开发者指南
│   ├── AGENTS.md              # Agent 开发规则（强制遵守）
│   ├── project-structure.md   # 本文件
│   ├── agent-branch-workflow.md
│   ├── agent-cli-reference.md
│   ├── agent-facing-cli-reference.md
│   └── coding-agent/          # Coding agent session handoff
│       ├── README.md
│       ├── session-handoff-2026-04-26.md
│       ├── session-handoff-2026-05-22.md
│       └── coverage-matrix-2026-05-22.md
├── specs/             # 架构规格 & 产品需求
│   ├── SPEC.md
│   ├── ROADMAP.md
│   ├── cloudflare-central-hub.md
│   ├── crewden-rename-roadmap.md
│   ├── crewden-minimal-clone-plan.md
│   ├── bugfix-chat-scroll-restoration.md
│   ├── bml/
│   ├── requirements/           # 需求文档（PRD 原文）
│   └── smart-agent-crew/       # Smart Agent Crew 设计文档
└── archive/           # 历史版本规划（保留备查）
    ├── v0.2-persistence.md
    ├── v0.3-activity-log.md
    ├── v1.0-agent-roles.md
    ├── v1.5-knowledge-memory-layer.md
    └── ...
```

## 主线开发目录 (`packages/`)

- `packages/shared` — 协议类型定义、Zod 校验器、版本号
- `packages/server` — Fastify HTTP + WebSocket 服务端
- `packages/daemon` — 运行时检测、进程管理、CLI 驱动
- `packages/web` — React + Vite 前端
- `packages/hub-core` — 核心业务逻辑（可复用于 server 和 cloudflare）
- `packages/cloudflare` — Cloudflare Worker 部署适配

## 约束

- 新功能默认落在 `packages/*` 或 `tools/*`
- docs 按「指南 / 规格 / 归档」三级分类存放
- 历史文档只归档不删除
