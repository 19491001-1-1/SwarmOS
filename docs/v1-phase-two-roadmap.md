# v1.x — Phase Two Roadmap: Role, Goal & Memory

> **给 Claude Code 的执行指令：** 本文档是 v1 阶段总路线图，不是单个版本实现清单。实现任意 v1.x 版本前，先拆成独立 `docs/v1.x-*.md` 执行文档，按 TDD 工作：先写失败测试，再实现，再跑测试确认通过。完成每个版本后运行 `pnpm verify`；如果触及 Cloudflare Worker，再运行 wrangler dry-run。

## 方向调整

v1 不再以“模拟人类公司组织架构”为主线。

人类组织里的部门、层级、汇报关系、审批链，很多是为了规避人性弱点、责任边界和管理成本而设计的。Agent 系统不应该直接复制这些复杂结构。

v1 的主线调整为：

> 让一组 Agent 围绕用户目标，基于各自职责能力，持续协作、沉淀知识、完成可验收的工作。

关键词：

- Role：轻量角色、职责、能力、边界
- Goal：目标澄清、计划拆解、任务分配、验收标准
- Memory：项目知识、决策、经验、外部知识库 adapter

## v0.x 基础

v0.x 已经具备：

- Agent profile、状态、workspace、memory 文件
- Channel、DM、message read/check/send、search
- Delegation、wake-on-demand、reliable delivery
- Agent-facing CLI、MCP bridge
- Task board、reminders、workspace browser
- v0.9 规划中的 Markdown、mention、Thread、presence

v1.x 的任务不是再堆 UI，而是让这些能力形成闭环。

## 当前不足

- Agent profile 还不够表达“适合做什么”和“什么时候该找它”。
- 用户的目标还不能稳定沉淀成 brief、计划、任务、验收标准。
- 聊天里可以派活，但缺少目标对齐、澄清和确认流程。
- Agent 还不能稳定地自主巡检、认领、推进和汇报工作。
- “完成”缺少 evidence、review 和验收机制。
- Memory 仍偏个人文件，缺少项目级知识、决策和经验沉淀。
- 外部知识库选型未定，需要先设计 adapter，而不是绑定单一产品。
- v1.6-v1.8 方向仍有价值，但细节未定，先作为草稿保留。

## 产品原则

### 1. 轻角色，不重组织

v1.0 只定义 Agent 的角色、职责、能力、工作风格、交接偏好和约束。

不要求：

- 部门表
- 汇报线
- 组织架构图
- manager approval 流程

### 2. 目标从聊天中自然产生

不做独立 Boss Command Center。

用户仍在当前聊天里表达目标，系统应该能识别这是一个目标型请求，并在聊天内完成：

- 澄清
- brief
- 计划
- 分工
- 任务创建
- 进度同步
- 验收

### 3. 结构化是为了协作，不是为了填表

Goal / Project / Task / Review / Knowledge 等结构只在能提高协作质量时引入。

每个结构化对象都必须回答：

- 解决什么协作问题？
- Agent 如何使用它？
- 用户如何从中受益？

### 4. Agent 自主性来自机制

不要只靠 prompt 说“你要主动”。

系统需要提供：

- inbox
- task discovery
- claim / handoff / escalation
- reminders / SLA
- review / evidence
- durable context

### 5. 知识层是 v1 的核心能力

长期可用的 Agent 系统必须能记住：

- 用户偏好
- 项目背景
- 决策记录
- 成功/失败经验
- 标准做法
- 可复用产物

v1.5 应优先设计知识层和 adapter 接口，不急着绑定某个外部知识库。

## v1.x 版本总览

| 版本 | 主题 | 核心交付 | 状态 |
|------|------|----------|------|
| v1.0 | Lightweight Agent Roles | 扩展当前 profile，定义角色、职责、能力、工作风格、交接偏好 | 已明确 |
| v1.1 | Goal Brief & Work Breakdown | 把用户目标结构化成 brief、任务、依赖、验收标准 | 已明确 |
| v1.2 | Goal Alignment in Chat | 复用当前聊天完成目标澄清、计划对齐、分工和确认 | 已明确 |
| v1.3 | Autonomous Work Loop | Agent 主动看 inbox、认领、推进、委派、升级和汇报 | 已明确 |
| v1.4 | Review & Acceptance | reviewer、evidence、返工、最终验收 | 已明确 |
| v1.5 | Knowledge & Memory Layer | 项目知识、决策沉淀、经验检索、外部知识库 adapter | 重要，待细化选型 |
| v1.6 | Draft: Tools & Credentials | 工具权限、凭据治理、外部服务集成 | 草稿 |
| v1.7 | Draft: Strategy & Research | 研究、批判、方案生成、创新提案 | 草稿 |
| v1.8 | Draft: Reliability & Scale | 审计、成本、SLA、多 daemon、可靠队列 | 草稿 |

## v1.0 — Lightweight Agent Roles

### 目标

让系统知道每个 Agent 适合干什么。

v1.0 继续复用当前 Agent profile，不引入复杂组织架构。

### 核心字段

- `role`：主角色，例如产品经理、工程师、研究员
- `responsibilities`：长期职责
- `capabilities`：可匹配能力标签
- `workingStyle`：执行型、规划型、审查型、研究型等
- `handoffPreference`：交接时需要什么输入
- `constraints`：不能做什么
- `examples`：典型任务示例

### 验收条件

- Agent profile 可编辑上述字段。
- `xoxiang agent list` 能看到角色能力信息。
- `xoxiang agent resolve` 能按职责/能力找到候选 Agent。
- 委派时可以复用 resolve，不只依赖名字。

## v1.1 — Goal Brief & Work Breakdown

### 目标

把用户一句目标转成结构化 brief 和可执行任务。

### 核心能力

- 识别目标型请求
- 生成 goal brief：
  - objective
  - background
  - success criteria
  - constraints
  - assumptions
  - risks
- 拆解任务：
  - owner
  - dependencies
  - acceptance criteria
  - artifacts
- 把任务落到现有 Task Board

### 设计要求

- 不要求先做复杂 Project UI。
- 先让目标结构能被 Agent 读取和执行。
- brief 应该能从聊天消息转化而来。

### 验收条件

- 用户在群聊里提出目标，系统能生成 brief 草案。
- 用户确认后创建任务和验收标准。
- Agent 收到任务时有足够上下文。

## v1.2 — Goal Alignment in Chat

### 目标

不做独立 Boss Command Center，复用当前聊天界面完成目标对齐。

用户仍在群聊里说：

> 帮我调研 X，然后给我一个可执行方案。

系统应该在当前聊天或 Thread 中完成：

- 判断这是目标型请求
- 追问缺失信息
- 明确成功标准
- 生成计划
- 推荐参与 Agent
- 让用户确认
- 创建任务
- 后续在同一上下文里汇报进展

### 核心能力

- Chat-native goal intake
- Clarifying questions
- Plan preview in message/thread
- Owner/reviewer recommendation
- User confirmation
- Task creation

### 验收条件

- 不新增 Boss Dashboard。
- 用户能在现有聊天中完成目标澄清和分工。
- 计划生成必须说明“为什么找这些 Agent”。
- 高风险或不确定任务默认等待用户确认。

## v1.3 — Autonomous Work Loop

### 目标

让 Agent 能稳定地“上班”：看 inbox、找任务、认领、推进、委派、汇报、升级。

### 核心能力

- Agent inbox：
  - assigned tasks
  - mentions
  - DMs
  - reminders
  - pending reviews
  - blocked escalations
- Work loop：
  - 启动后读取 inbox
  - idle 时检查 open work
  - 对适合自己的未分配任务可 claim
  - 长任务定期 heartbeat
- Escalation：
  - 缺信息问 requester
  - 卡住找合适 Agent
  - 超时通知用户或负责人

### 验收条件

- Agent 能主动发现并处理自己的 open work。
- Agent 可以认领适合自己的未分配任务。
- 阻塞和超时能形成可见 escalation。

## v1.4 — Review & Acceptance

### 目标

把“做完了”升级成“有证据、可验收”。

### 核心能力

- reviewer assignment
- review request
- approve / request changes
- evidence
- acceptance checklist
- artifact links
- reopen task

### 设计要求

- 高风险任务不能无 evidence 直接 done。
- reviewer 和 executor 默认不应是同一个 Agent，低风险任务可例外。
- review 结果沉淀到 task context。

### 验收条件

- 任务可以进入 `in_review`。
- reviewer 可以要求返工。
- done 任务展示 evidence 和 acceptance checklist。

## v1.5 — Knowledge & Memory Layer

### 目标

把个人 `MEMORY.md` 扩展成项目/目标级知识层，让系统能记住项目经验、用户偏好、决策和可复用产物。

### 核心能力

- Knowledge entities：
  - Decision
  - ProjectArchive
  - UserPreference
  - Runbook
  - Learning
  - Artifact
- Retrieval：
  - Agent 按 task/goal 自动检索相关知识
  - 用户能搜索决策、项目档案和经验
  - 项目完成后生成 archive
- Knowledge hygiene：
  - source links
  - owner/reviewer
  - stale/conflict 标记

### 外部知识库方向

先设计 adapter，不急着绑定具体产品。

候选：

- Markdown/Git repo：轻、可控、适合开发者和项目档案
- Notion：适合人类团队知识库
- Obsidian：适合本地和个人知识网络
- Google Drive：通用但权限复杂
- GitHub Wiki/Issues/PR：适合技术项目
- Slack/飞书历史：适合沟通上下文，但噪声高
- 向量库：适合检索增强，但不应作为唯一事实源

建议 v1.5 第一阶段：

- 内置 Markdown/Git repo adapter
- 统一 Knowledge Adapter Interface
- 后续再接 Notion/Drive 等外部源

### 验收条件

- Project/Goal 完成后能生成项目档案。
- Agent 执行任务前能读取相关知识摘要。
- 用户能搜索 decision/runbook/learning。
- Adapter 接口不阻碍后续接入外部知识库。

## v1.6 — Draft: Tools & Credentials

> 草稿。方向有价值，但暂不作为确定版本设计。

可能范围：

- 工具注册表
- 凭据引用和权限边界
- 外部服务集成
- 高风险操作 approval
- tool call audit

未决问题：

- 先接哪些工具？
- 凭据放本地 daemon、Cloudflare，还是外部 vault？
- 什么操作需要用户批准？
- Agent 看到的是工具能力还是具体凭据？

## v1.7 — Draft: Strategy & Research

> 草稿。方向有价值，但暂不作为确定版本设计。

可能范围：

- 深度研究
- 方案生成
- critic/reviewer 反向审查
- 竞品分析
- proposal 对比

未决问题：

- 这是独立版本，还是 v1.1/v1.4 的能力增强？
- 需要哪些外部检索/知识库能力作为前置？
- 如何避免“发散建议”污染执行计划？

## v1.8 — Draft: Reliability & Scale

> 草稿。方向有价值，但暂不作为确定版本设计。

可能范围：

- durable queue
- retry / dead-letter
- audit event
- multi-daemon scheduling
- cost / SLA / capacity metrics
- data retention / export

未决问题：

- 当前用户规模是否需要多租户？
- Cloudflare hub 和本地 server 的可靠队列如何统一？
- 先做个人/单组织版本，还是提前设计 SaaS 多租户？

## Cross-Cutting Requirements

### Work Context Contract

v1.x 任务交接应逐步收敛到统一上下文合同：

```ts
type WorkContext = {
  goalId?: string;
  projectId?: string;
  taskId?: string;
  objective: string;
  background: string[];
  knownFacts: string[];
  decisions: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  risks: string[];
  blockers: string[];
  artifacts: string[];
  evidence: string[];
  nextSteps: string[];
  requesterAgentId?: string;
  ownerAgentId?: string;
  reviewerAgentId?: string;
};
```

### Web Design Direction

- 聊天仍是主要入口。
- Goal/Task/Thread 是聊天中自然长出来的结构。
- 不新增 Boss Dashboard 作为 v1.2 前提。
- Agent profile 要突出职责、能力、当前工作、知识和工具边界。
- Task/Goal 页面应突出 owner、risk、evidence、next step。

### Agent Prompt Direction

standing prompt 应逐步从“如何发消息”升级为“如何围绕目标协作”：

- 先理解目标，再选择沟通或执行。
- 优先读取 task/goal context。
- 需要协作时 resolve role/capability。
- 交接任务必须带 structured context。
- 完成任务必须提交 evidence。
- 不确定时升级，而不是编造。

## 不做的事

- v1 不追求一次做成完全自治组织。
- v1.0 不做复杂组织架构。
- v1.2 不做独立 Boss Command Center。
- v1.5 不急着绑定单一外部知识库。
- v1.6-v1.8 只保留草稿，不作为近期硬承诺。

## v1 阶段完成定义

v1 阶段完成时，系统应能演示：

1. 用户在聊天里表达一个目标。
2. 系统澄清目标并生成 brief、任务、owner、验收标准。
3. Agent 基于职责能力接收或认领任务。
4. Agent 之间通过 handoff/DM/thread 传递结构化上下文。
5. 关键产出经过 review 和 evidence 验收。
6. 系统把成果、证据、决策和经验沉淀到知识层。
7. 下次类似目标出现时，Agent 能检索并复用相关经验。
