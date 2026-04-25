# v1.x — Phase Two Roadmap: Agent-Native Company

> **给 Claude Code 的执行指令：** 本文档是第二阶段总路线图，不是单个版本的实现清单。实现任意 v1.x 版本前，先把对应版本拆成独立 `docs/v1.x-*.md` 执行文档，按 TDD 工作：先写失败测试，再实现，再跑测试确认通过。完成每个版本后运行 `pnpm verify`；如果触及 Cloudflare Worker，再运行 wrangler dry-run。

---

## 愿景

Xoxiang 的第二阶段目标不是“更多聊天机器人”，而是构建一个以 Agent 为主体的公司组织。

老板只需要表达目标、约束和优先级。系统里的 agent 应该能像真实公司员工一样：

- 理解目标，并把目标拆成可执行项目和任务
- 根据角色、能力、上下文和负载自动分工
- 在任务推进中主动读取、补充、传递有效信息
- 产出可验证的成果，而不是只给过程回复
- 在质量不确定时主动 review、测试、复盘和升级
- 把经验沉淀为组织知识，下一次做得更好
- 在合理边界内发挥创造力，交付超过用户原始指令的结果

v0.x 已经打下了基础：agent profile、DM、delegation、agent-facing CLI、MCP bridge、task board、workspace/memory、reminders、workspace browser、channels/search。v1.x 要把这些“零件”升级成稳定的组织运行系统。

---

## 当前功能 Review

### 已经具备的基础能力

- **员工实体**：Agent 有 profile、runtime、状态、machine 绑定、auto-start 和 workspace。
- **沟通通道**：Channel、DM、message read/check/send、搜索和提醒提供基础沟通。
- **任务流转**：Task board、task context、handoff、agent resolve 已经能支持简单交接。
- **执行环境**：daemon 能拉起不同 runtime，注入 CLI/MCP，agent 有持久 workspace 和 memory 文件。
- **可观察性起点**：activity log、workspace browser、machine panel 能看见部分运行状态。

### 还不充分的地方

- **组织结构弱**：Agent 只是扁平列表，没有部门、汇报关系、职责边界、owner、backup、审批人。
- **目标系统弱**：Task board 只能管理单任务，缺少公司级目标、项目、里程碑、依赖图和成功指标。
- **任务生成弱**：用户一句话还不能稳定转成项目 brief、计划、任务树、验收标准和分工方案。
- **自主执行弱**：Agent 不一定会主动巡检任务、读上下文、认领待办、推进阻塞或复盘结果。
- **交接信息质量弱**：虽然有 task context/handoff，但缺少强制的 brief、decision log、artifacts、risk 和 evidence 结构。
- **质量体系弱**：缺少 reviewer、QA gate、验收证据、自动测试矩阵、成果评分和返工流程。
- **知识体系弱**：Memory 目前偏个人文件，缺少组织知识库、项目档案、可检索经验和过期/冲突处理。
- **工具体系弱**：CLI/MCP 有基础协作工具，但还没有按角色授权的业务工具、外部 SaaS 集成和凭据治理。
- **老板视角弱**：Web UI 更像 chat/task console，不像公司驾驶舱；缺少目标进度、风险、负责人、产出物和决策入口。
- **创造力机制弱**：系统没有要求 agent 提出备选方案、反事实分析、创意探索、竞品研究和超预期交付建议。
- **治理与安全弱**：缺少权限、审批、审计、预算、成本、数据隔离、敏感操作二次确认。
- **规模化弱**：多 daemon、多机器、长任务重试、队列优先级、容量管理和故障恢复还不够完整。

---

## Phase Two 产品原则

### 1. 目标优先于对话

用户不是来和 agent 闲聊的，而是来经营一个组织。所有交互都应尽快沉淀成：

- Goal
- Project
- Task
- Decision
- Artifact
- Learning

Channel 消息仍然重要，但它应该服务于目标推进。

### 2. 信息传递默认结构化

Agent 之间传递任务时，不能只转一句自然语言。默认需要携带：

- 背景和目标
- 当前状态
- 已知事实
- 决策记录
- 验收标准
- 风险和阻塞
- 产出物链接
- 下一步建议

这些信息不一定全部展示给用户，但必须进入可追踪的执行上下文。

### 3. 公司有角色，不只有 agent

Agent 应绑定组织角色。角色决定：

- 该 agent 能处理什么类型的工作
- 什么时候应该被分配任务
- 什么时候需要 review 或审批
- 能使用哪些工具和凭据
- 交付结果按什么标准评估

### 4. 自主性来自制度，不来自 prompt 幻觉

不要只靠一句“你要主动”。系统需要提供：

- agent inbox
- polling / subscription
- open task discovery
- claim / handoff / escalation
- SLA 和 reminder
- quality gate
- blocked workflow

Agent 自主工作必须可观察、可恢复、可问责。

### 5. 创造力要有容器

创造力不是随机发散。需要在合适节点要求 agent 产出：

- 方案 A/B/C
- 最小可行方案和高杠杆方案
- 风险更高但收益更大的方案
- 竞品/外部资料启发
- 反对意见和改进建议

同时保留用户或 manager agent 的决策权。

---

## v1.x 版本总览

| 版本 | 主题 | 核心交付 | 依赖 |
|------|------|----------|------|
| v1.0 | Organization Graph | 部门、岗位、汇报关系、职责和能力模型 | v0.4/v0.6 |
| v1.1 | Goals, Projects & Work Breakdown | 目标、项目、里程碑、任务依赖图和验收标准 | v1.0 |
| v1.2 | Boss Command Center | 用户指令转 brief/计划/分工，老板驾驶舱 | v1.1 |
| v1.3 | Autonomous Work Loop | Agent 主动拉取、认领、推进、交接、升级任务 | v1.1 |
| v1.4 | Quality & Review System | Reviewer、QA gate、验收证据、返工流程 | v1.3 |
| v1.5 | Organization Knowledge Base | 组织知识库、项目档案、经验沉淀和检索 | v1.3 |
| v1.6 | Tooling, Credentials & External Work | 角色化工具权限、凭据治理、外部服务集成 | v1.4 |
| v1.7 | Creative Strategy Layer | 方案生成、研究、批判、创新提案和超预期交付 | v1.5 |
| v1.8 | Governance, Metrics & Scale | 审计、成本、SLA、容量、多 daemon、可靠队列 | v1.6 |

---

## v1.0 — Organization Graph

### 目标

把 agent 从“可聊天对象”升级为“组织成员”。系统需要知道每个 agent 在公司里的岗位、职责、能力、上下游关系和默认协作对象。

### 核心功能

- Organization model:
  - `Department`
  - `Role`
  - `AgentRoleAssignment`
  - `ReportingLine`
  - `Capability`
  - `Responsibility`
- Web UI:
  - 组织架构视图
  - Agent 详情页展示角色、部门、manager、backup、能力标签
  - 快速创建典型岗位：CEO/PM/Engineer/Designer/QA/Researcher/Ops
- Agent directory 升级：
  - `xoxiang agent list` 返回组织信息
  - `xoxiang agent resolve` 支持 role、department、capability 查询
  - resolve 返回 match reason 和 confidence
- Assignment policy:
  - 根据 role/capability 过滤候选人
  - 支持 backup agent
  - 支持 unavailable / overloaded 状态

### 设计要求

- Agent 名称/displayName 是展示层，分配逻辑必须优先使用 role/capability。
- 组织结构需要允许一个 agent 兼任多个角色。
- “老板”可以直接对部门或角色下指令，比如“让产品经理整理需求”。

### 验收条件

- 用户能创建部门和角色，并把 agent 加入组织结构。
- 用户输入角色名时，系统能解析到具体 agent 或候选列表。
- Task handoff/delegation 可以使用 role/capability 解析，而不是只靠 name/displayName。
- `pnpm verify` 全绿。

---

## v1.1 — Goals, Projects & Work Breakdown

### 目标

引入公司级目标和项目层，让任务不再是孤立卡片。每个任务都应服务于某个 project/goal，并携带成功标准。

### 核心功能

- 数据模型：
  - `Goal`: 目标、优先级、owner、成功指标、时间范围
  - `Project`: 所属 goal、project manager、状态、里程碑
  - `Milestone`: 关键节点、截止时间、验收条件
  - `TaskDependency`: blocked_by / blocks
  - `AcceptanceCriteria`: 可验证标准
- Task board 升级：
  - 按 goal/project 筛选
  - 显示依赖和阻塞
  - task 可以升级为 project，project 可以拆成 tasks
- Agent-facing CLI/MCP:
  - list goals/projects
  - read project brief
  - create/update milestone
  - link task dependency
  - report project status

### 设计要求

- Project brief 是核心上下文，不应散落在 channel 里。
- 每个项目必须有 DRI（directly responsible individual），可以是 manager agent。
- Task context 中必须能引用 goal/project/milestone。

### 验收条件

- 用户能创建 goal/project，并把现有 task 归入 project。
- Agent 能读取 project brief 和相关任务依赖。
- 阻塞任务在 UI 和 agent CLI 中都可见。
- `pnpm verify` 全绿。

---

## v1.2 — Boss Command Center

### 目标

让老板用自然语言下达目标，系统把它转成可执行的组织计划，而不是只发到某个 channel。

### 核心功能

- Command intake:
  - 用户输入一段目标或命令
  - 系统生成 structured brief
  - 标出缺失信息、假设、风险和建议的 owner
- Planning workflow:
  - 自动生成 project proposal
  - 自动拆任务树
  - 自动推荐 owner/reviewer
  - 自动生成验收标准
- Approval modes:
  - manual approval：老板确认后创建项目和任务
  - autopilot：低风险任务自动创建并分配
- Web UI:
  - Boss Dashboard
  - Command Inbox
  - Plan Preview
  - Approve / revise / reject

### 设计要求

- 计划生成必须展示“为什么分配给这些 agent”。
- 对高风险或外部副作用任务默认需要用户确认。
- 用户可以选择“快做”或“先出计划”。

### 验收条件

- 一条自然语言目标可以生成 project brief、milestones、tasks、owners、acceptance criteria。
- 用户确认后自动创建对应实体并通知相关 agent。
- Agent 收到任务时有足够上下文，不需要回问“我要做什么”。
- `pnpm verify` 全绿。

---

## v1.3 — Autonomous Work Loop

### 目标

让 agent 真正具备“上班”的循环：看 inbox、认领任务、推进任务、更新状态、交接和升级。

### 核心功能

- Agent inbox:
  - assigned tasks
  - mentions
  - DMs
  - reminders
  - pending reviews
  - blocked escalations
- Work loop policy:
  - agent start 后自动读取 inbox
  - idle 时可主动检查 open tasks
  - 对适合自己的 unassigned tasks 可 claim
  - 工作超时自动 heartbeat / status update
- Task lifecycle:
  - todo → claimed → in_progress → in_review → done
  - blocked / needs_info / needs_approval 扩展状态
- Escalation:
  - 缺信息时问 requester 或 PM
  - 卡住时请求专家
  - 超 SLA 时通知 manager

### 设计要求

- 自主认领必须受 role/capability/priority/permission 限制。
- Agent 不能无限循环刷任务；需要 backoff 和 run budget。
- 每次状态变更应留下 reason。

### 验收条件

- Agent 启动后能主动发现并处理自己的 open work。
- Agent 可以认领适合自己的未分配任务。
- 阻塞和超时能形成可见 escalation。
- `pnpm verify` 全绿。

---

## v1.4 — Quality & Review System

### 目标

把“完成了”升级为“经过验收”。每个重要成果都要有证据、review 和质量门禁。

### 核心功能

- Review workflow:
  - reviewer assignment
  - review request
  - approve / request changes / reject
  - review notes
- Quality gates:
  - test evidence
  - acceptance criteria checklist
  - artifact links
  - risk checklist
- Role-specific review:
  - code task → engineer/reviewer
  - product task → PM review
  - content task → editor review
  - research task → citation/evidence review
- Agent tools:
  - request review
  - submit evidence
  - reopen task
  - compare against acceptance criteria

### 设计要求

- Done 状态不应允许没有 evidence 的高风险任务直接进入。
- Reviewer 和 executor 默认不能是同一个 agent，除非任务低风险或用户允许。
- Review 结果要沉淀进 task context 和 project history。

### 验收条件

- 任务可以进入 `in_review` 并指定 reviewer。
- Reviewer 可以要求返工，executor 收到明确 next step。
- Done 任务展示 acceptance checklist 和 evidence。
- `pnpm verify` 全绿。

---

## v1.5 — Organization Knowledge Base

### 目标

把个人 `MEMORY.md` 升级为组织知识系统。公司应能记住项目经验、用户偏好、决策、标准操作流程和可复用产出。

### 核心功能

- Knowledge entities:
  - `Decision`
  - `Runbook`
  - `ProjectArchive`
  - `UserPreference`
  - `Learning`
  - `Artifact`
- Retrieval:
  - agent 按 task/project 自动检索相关知识
  - 用户可以搜索组织知识
  - project close 后自动生成 archive
- Knowledge hygiene:
  - stale 标记
  - conflict 标记
  - source links
  - owner/reviewer
- Workspace sync:
  - agent notes 可提升为组织知识
  - 组织知识可注入 agent prompt/context

### 设计要求

- 区分个人记忆、项目记忆、组织知识。
- 重要知识必须有来源和更新时间。
- 避免把临时猜测写成长期事实。

### 验收条件

- Project 完成后能生成项目档案。
- Agent 执行任务前能读取相关组织知识摘要。
- 用户能搜索 decision/runbook/learning。
- `pnpm verify` 全绿。

---

## v1.6 — Tooling, Credentials & External Work

### 目标

让 agent 能完成真实线上任务，而不是只在 Xoxiang 内部流转。工具使用必须可授权、可审计、可回滚。

### 核心功能

- Tool registry:
  - tool name
  - capability
  - required role
  - risk level
  - approval requirement
- Credential vault integration:
  - per-tool secret reference
  - no secret in prompts/logs
  - scoped tokens
- External integrations:
  - GitHub issues/PRs
  - docs/wiki
  - browser automation
  - email/calendar
  - Slack/Discord/Feishu bridge
  - deployment providers
- Approval workflow:
  - dry-run preview
  - user approval
  - manager approval
  - audit event

### 设计要求

- 外部副作用操作默认需要 preview。
- 凭据永远不进入 agent-visible plain text。
- Tool results 要能作为 task evidence 被引用。

### 验收条件

- Agent 可以按角色看到可用工具列表。
- 高风险工具调用会创建 approval request。
- 审批通过后执行，并记录 audit trail。
- `pnpm verify` 全绿。

---

## v1.7 — Creative Strategy Layer

### 目标

让组织不只是机械执行，还能提出更好的方案。系统应在关键节点引导 agent 做探索、批判和创新。

### 核心功能

- Strategy workflows:
  - generate alternatives
  - critique plan
  - research competitors
  - propose high-leverage bets
  - pre-mortem
  - post-mortem
- Creative roles:
  - strategist
  - researcher
  - critic
  - designer
  - growth agent
- Proposal objects:
  - summary
  - expected impact
  - cost
  - risk
  - confidence
  - experiment plan
- UI:
  - proposal board
  - compare alternatives
  - accept as project

### 设计要求

- 创意产出不能直接污染执行计划；先作为 proposal。
- 每个 proposal 要有可测试假设。
- Critic agent 应被鼓励指出目标、计划和产出的问题。

### 验收条件

- 用户可以要求“给我三个更好的方案”，系统产出可比较 proposals。
- Proposal 可一键转成 project。
- Project review 中可以请求 critic agent 进行反向审查。
- `pnpm verify` 全绿。

---

## v1.8 — Governance, Metrics & Scale

### 目标

让 Agent 公司可运营、可扩展、可控。老板需要知道组织是否健康，系统需要能承载更多 agent 和更长任务。

### 核心功能

- Metrics:
  - cycle time
  - throughput
  - blocked time
  - review pass rate
  - rework rate
  - agent utilization
  - cost per project
- Audit:
  - tool calls
  - approvals
  - task state changes
  - prompt/context snapshots
  - artifact changes
- Reliability:
  - durable queue
  - retry policy
  - idempotency keys
  - dead-letter queue
  - multi-daemon scheduling
- Governance:
  - user auth
  - org roles and permissions
  - data retention
  - export/import
  - incident mode

### 设计要求

- 组织运行数据应面向老板可读，而不是只有工程日志。
- 长任务必须可暂停、恢复、取消。
- 多 daemon 下任务分配不能重复执行。

### 验收条件

- Dashboard 展示组织级健康指标。
- 每个重要操作都有 audit event。
- 多 daemon 同时在线时，agent start/task delivery 不重复。
- `pnpm verify` 全绿。

---

## Cross-Cutting Requirements

### Agent Context Contract

所有 v1.x 任务交接都应逐步收敛到统一上下文合同：

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

v1.x UI 应从“聊天工作台”升级为“公司操作系统”：

- 默认首页是 Boss Dashboard，不是某个 channel。
- Channel 是沟通层，Project/Goal 是工作主线。
- Agent 详情页要像员工档案：职责、能力、当前工作、绩效、知识、工具权限。
- Task/Project 页面要突出状态、owner、risk、evidence、next step。
- 对老板展示摘要和决策入口；对 agent 展示执行上下文和工具入口。

### Agent Prompt Direction

standing prompt 应逐步从“如何发消息”升级为“如何作为组织成员工作”：

- 先理解目标，再选择沟通或执行。
- 优先读取 task/project context。
- 需要协作时先 resolve agent/role/capability。
- 传递任务必须带 structured context。
- 完成任务必须提交 evidence。
- 不确定时升级，而不是编造。
- 有机会时提出更高杠杆方案。

### Data Model Direction

v1.x 需要避免所有信息都塞进 `TaskContext`。建议逐步引入一组一等实体：

- Organization
- Department
- Role
- Capability
- Goal
- Project
- Milestone
- Task
- WorkContext
- Decision
- Artifact
- Review
- Approval
- KnowledgeItem
- ToolCall
- AuditEvent

---

## 不做的事

- v1.x 不追求一次性做完“完全自治公司”。每个版本都必须有可验证的窄切面。
- 不让 agent 无限制访问外部系统或凭据。
- 不把所有功能都做成聊天命令；关键流程必须有结构化 UI 和 API。
- 不用 prompt 口号替代产品机制。自主性、质量和创造力都需要数据模型、流程和工具支持。

---

## Phase Two Definition of Done

第二阶段完成时，系统应能演示以下闭环：

1. 老板在 Command Center 下达一个目标。
2. 系统生成 brief、项目计划、任务树、owner、reviewer 和验收标准。
3. Agent 自动认领或接收任务，读取上下文和组织知识。
4. Agent 之间通过 task handoff/DM/project updates 高质量传递信息。
5. 关键产出经过 reviewer 和 quality gate。
6. 系统把成果、证据、决策和经验沉淀到项目档案和组织知识库。
7. 老板在 dashboard 看到进度、风险、阻塞、成本和可决策事项。
8. 对开放性目标，系统能提出多个方案，并把被采纳方案转成项目执行。

