# Coding Agent Handoff - 2026-05-22

这份交接文档面向下一位进入仓库的 coding agent。目标不是复述聊天记录，而是把项目要做什么、当前做到哪里、还缺什么、下一步怎么接，整理成可直接执行的工作说明。

## 1. 项目是什么

SwarmOS 是一个基于 Crewden 二次开发的协同开发平台，核心目标是让一组 Agent 围绕用户目标稳定协作，完成从目标澄清、任务拆解、执行、审批、验收到知识沉淀的闭环。

项目不是单纯的聊天 UI，也不是简单的多 Agent 演示，而是一个“Agent-first 公司组织”型系统：

- 用户提出目标
- 系统把目标结构化为 brief、任务、验收标准和知识沉淀
- Agent 自动认领、推进、协作、上报
- 危险操作需要审批
- 完成结果必须有 evidence 和 review
- 经验、决策和偏好要沉淀到知识层

## 2. 需求主线

当前需求文档体系的主线是 v1.x 路线图，重点不是堆功能，而是把协作闭环做完整。

### 已明确的版本目标

- v1.0：轻量角色与能力画像
- v1.1：Goal Brief 与任务拆解
- v1.2：聊天内目标对齐
- v1.3：自主工作循环
- v1.4：Review 与 Acceptance
- v1.5：Knowledge & Memory
- v1.5.1：可编辑 Agent Runtime

### 对本项目最关键的产品原则

- 轻角色，不重组织
- 目标从聊天自然产生
- 结构化是为了协作，不是为了填表
- Agent 的自主性来自机制，不是 prompt 口号
- 知识层是长期核心能力

## 3. 技术路线

项目的实施方案已经明确：以 `crewden` 作为主骨架进行二次开发，`ruflo` 只做设计参考，不作为 MVP 的核心运行时。

### 推荐架构

- `web`：继续承载前端交互与可视化
- `server`：作为中台调度与状态管理核心
- `daemon`：负责本地执行、安全控制和 CLI / MCP 入口
- `shared`：统一协议、schema、类型与版本约定

### MVP 必须覆盖的能力

- `POST /api/v1/swarm/init`
- 动态 agent runtime config 实例化
- thought log 事件流
- daemon 文件锁
- daemon 命令超时强杀
- 高危动作人工审批闭环
- UI 端到端演示路径

### 明确后置的能力

- 复杂 DAG 编排
- 多机 federated swarm
- 向量记忆 / RAG
- 完整 MCP 平台化
- 多租户 / 企业权限
- 高级成本治理
- 自学习与自治优化

## 4. 当前仓库整体流程

后续开发建议遵循这条顺序：

1. 先统一需求边界和协议契约
2. 再实现中台调度骨架
3. 再实现 daemon 安全执行能力
4. 再补前端可视化与审批 UI
5. 最后做联调、验证和收口

这是为了避免 shared 契约漂移、daemon 改造失控、前端提前依赖假数据。

## 5. 我已经做了什么

下面按“已完成的真实工作”总结。

### v1.0 角色字段

已经完成轻量角色画像能力的基础实现：

- shared 协议和验证支持 `role`、`responsibilities`、`capabilities`、`workingStyle`、`handoffPreference`、`constraints`、`examples`
- hub-core / runtime 配置映射已对齐
- web 侧 Agent 详情展示与编辑已扩展
- 相关类型错误已修正并通过验证

### v1.3 daemon 自主工作循环

已经实现 daemon 的自动工作循环：

- 支持启动后检查 open work / inbox
- 支持按 agent 维度处理工作循环
- 增加测试环境保护，避免 test 场景误触发 autoWork
- 相关 daemon 单测已跑通

### Windows 兼容性修复

针对 Windows 环境做了必要适配：

- 统一路径比较与断言，避免分隔符差异导致测试失败
- symlink 场景改为 Windows junction 兼容方案
- safeResolveAgentPath 的路径校验问题已修正
- 相关测试稳定通过

### Monorepo 验证

已经跑通并修复了全仓类型和测试问题：

- `pnpm -w verify` 最终通过
- 过程中修复了 web / server / shared / hub-core 的类型问题
- server approvals、Fastify 泛型、db 类型也已对齐

### Cloudflare 测试和依赖升级

已经尝试并完成以下动作：

- 升级 `@cloudflare/vitest-pool-workers` / `miniflare` / `vite`
- 增加 WebSocket 清理逻辑
- 让 Cloudflare 测试本身保持可运行

但 Windows 下 Miniflare 关闭时仍可能出现 `EBUSY` 警告，属于未完全根治的问题。

## 6. 还没做什么

以下是当前最重要的未完成项。

### v1.1 Goal Brief & Work Breakdown

还需要把用户一句目标稳定转成：

- objective
- background
- success criteria
- constraints
- assumptions
- risks
- 任务拆解与依赖

### v1.2 Chat 内目标对齐

还需要把目标澄清、计划预览、确认和任务创建完整放进现有聊天流里，避免用户去单独控制台操作。

### v1.4 Review & Acceptance

还需要把 review、evidence、request changes、self-review 限制等闭环彻底做严。

### v1.5 Knowledge & Memory

还需要把项目知识、决策记录、经验、用户偏好和外部知识库 adapter 做成长期可复用能力。

### v1.5.1 Runtime 编辑

还需要持续确认 Web / API / CLI / Cloudflare 对 runtime 编辑的行为一致性。

### Cloudflare Windows 资源释放问题

这是当前最明显的技术债：

- Cloudflare test 本身能跑
- 但 Windows 下 Miniflare 关闭时仍出现 SQLite / storage 资源锁定的 `EBUSY`
- 目前的缓解措施还不够彻底

## 7. 风险和坑

### 1. 不要让 shared 契约漂移

shared 一旦先乱，server、daemon、web 会一起返工。

### 2. 不要让 daemon 的测试环境误触发 autoWork

测试和生产行为要分开，否则会出现不稳定的并发和假阳性。

### 3. 不要低估 Windows 文件系统差异

路径、symlink、junction、SQLite 锁和临时文件清理都可能影响测试结果。

### 4. 不要过早引入 `ruflo` 复杂运行时

当前 MVP 的重点是把 Crewden 主骨架做成可控闭环，而不是把外部生态一并塞进来。

### 5. 不要只做 UI

真正的难点在协议、中台状态机、安全执行和验收闭环。

## 8. 建议下一位 agent 怎么接

### 优先级 1：补齐 v1.1 / v1.2 目标链路

先把“从聊天目标到任务”的链路做完整：

- 识别目标型请求
- 生成 brief
- 拆任务和依赖
- 在聊天中确认
- 创建可执行任务

### 优先级 2：把 v1.4 review 闭环做扎实

重点是 evidence、reviewer 推荐、changes request 和验收记录。

### 优先级 3：继续强化 v1.5 知识层

让项目知识不再只靠对话记忆，而是进入可查询、可复用的系统层。

### 优先级 4：处理 Cloudflare Windows EBUSY

可选方向：

- 继续查 Miniflare / vitest-pool-workers 上游是否已有修复
- 更彻底地清理 DO / WebSocket / storage 生命周期
- 必要时把 Cloudflare 集成验证更多放到 Linux CI

## 9. 推荐验证命令

常规验证：

```bash
pnpm verify
```

Cloudflare Worker 相关：

```bash
pnpm --filter @crewden/cloudflare exec wrangler deploy --dry-run
pnpm --filter @crewden/cloudflare exec wrangler deploy --config wrangler.test.jsonc --dry-run
```

Web 构建验证：

```bash
VITE_API_BASE=https://crewden-hub-test.xingke0.workers.dev pnpm --filter @crewden/web build
```

针对性测试：

```bash
pnpm --filter @crewden/shared test
pnpm --filter @crewden/server test
pnpm --filter @crewden/cloudflare test
pnpm --filter @crewden/daemon test
pnpm --filter @crewden/web test
```

## 10. 交接建议

如果你是下一位 coding agent，建议先做这三件事：

1. 读 `AGENTS.md`
2. 读这份交接文档和最新需求文档
3. 确认当前分支状态，再按需求优先级继续推进

如果你要继续实现功能，优先顺序建议是：

1. v1.1 / v1.2 的目标到任务链路
2. v1.4 的 review / acceptance 闭环
3. v1.5 的 knowledge layer
4. Cloudflare Windows 资源释放问题

> 总目标不变：不是“做出能演示的片段”，而是把需求文档里提到的所有功能完整实现，并且做成可长期迭代的系统。
