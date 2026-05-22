# Smart Agent Crew Roadmap

> 面向 Coding Agent 的实现路线图：按 TDD 拆分 Crewden 在任务传递、Agent 自主能力与问题解决闭环上的升级。

## 目标

把 Crewden 从“能把任务交给 agent 执行”推进到“agent 能可靠接力、先规划再执行、失败能恢复、完成能验证、经验能沉淀”的轻量 self-hosted agent-first 协作系统。

## 设计原则

1. **先可靠，再聪明**：v1.6 先补状态机、重试、审计、持久化和依赖图；否则更强 planning 只会放大不确定性。
2. **Coding Agent 友好**：每个小版本都给出明确文件路径、测试路径、RED/GREEN 命令、最小实现边界和 commit message。
3. **TDD 强约束**：没有 failing test 不写生产代码；每个能力至少覆盖 happy path、failure path、restart/concurrency path。
4. **小版本可独立交付**：每个版本都应该能单独 merge，并留下可运行测试。
5. **不做大 SaaS**：先服务单团队、自托管、多 runtime coding agent 协作，不追求多租户企业套件。

## 版本拆分

| 版本 | 主题 | 核心交付 | 依赖 |
|---|---|---|---|
| v1.6 | Reliable Task Flow | 严格 task 状态机、自动重试/escalation、审计日志、状态持久化、最小 task dependency graph | 当前 v1.5.x |
| v1.7 | Agent Planning & Verification | LLM-assisted goal decomposition、plan-before-execute、plan-execute-verify、self-verification、proactive blocking | v1.6 的状态机和审计 |
| v1.8 | Agent Memory / Skills / Runtime | per-agent memory、成功任务 skill capture、Codex/Gemini session carryover、runtime plugin interface | v1.6；部分功能受益于 v1.7 |
| v1.9 | Orchestration DAG | 可编排 DAG、workspace semantic memory、self-improvement loop、federated daemon、human checkpoints | v1.6 + v1.7 + v1.8 |

推荐执行顺序：`v1.6 -> v1.7 -> v1.8 -> v1.9`。如果资源有限，v1.6 的 P0（状态机 + retry/escalation + audit）必须先做。

## 关键现有路径

- Server routes：`packages/server/src/routes/tasks.ts`、`packages/server/src/routes/internalAgent.ts`、`packages/server/src/routes/knowledge.ts`
- Server state：`packages/server/src/db.ts`、`packages/server/src/schema.ts`、`packages/server/src/daemonRegistry.ts`、`packages/server/src/delegation.ts`、`packages/server/src/taskDelivery.ts`
- Hub core：`packages/hub-core/src/goalAlignment.ts`
- Daemon：`packages/daemon/src/agentProcessManager.ts`、`packages/daemon/src/agentCli.ts`、`packages/daemon/src/bridge/simpleToolBridge.ts`
- Runtime drivers：`packages/daemon/src/drivers/types.ts`、`packages/daemon/src/drivers/claude.ts`、`packages/daemon/src/drivers/codex.ts`、`packages/daemon/src/drivers/gemini.ts`
- Shared protocol：`packages/shared/src/protocol.ts`、`packages/shared/src/validation.ts`
- Existing tests：`packages/server/test/tasksApi.test.ts`、`packages/server/test/daemonSocket.test.ts`、`packages/daemon/test/agentProcessManager.test.ts`、`packages/daemon/test/simpleToolBridge.test.ts`、`packages/hub-core/test/goalAlignment.test.ts`

## TDD 总原则

每个实现任务必须按这个节奏：

1. 在对应 `packages/*/test/*.test.ts` 先写一个最小 failing test。
2. 运行精确测试命令，例如：`pnpm --filter @crewden/server test -- tasksApi.test.ts -t "rejects invalid task transition"`。
3. 确认失败原因是目标能力缺失，不是测试拼写错误。
4. 写最小生产代码，只让该测试通过。
5. 运行该 package 测试，再运行相关跨包测试。
6. commit 一个小步，message 用 `feat(scope): ...` 或 `test(scope): ...`。

详细测试策略见 [`testing-strategy.md`](./testing-strategy.md)。

## 子文档

- [`v1.6-reliable-task-flow.md`](./v1.6-reliable-task-flow.md)
- [`v1.7-agent-planning-verification.md`](./v1.7-agent-planning-verification.md)
- [`v1.8-agent-memory-skills.md`](./v1.8-agent-memory-skills.md)
- [`v1.9-orchestration-dag.md`](./v1.9-orchestration-dag.md)
- [`testing-strategy.md`](./testing-strategy.md)
