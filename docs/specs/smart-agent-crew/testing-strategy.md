# Smart Agent Crew Testing Strategy

## 测试目标

这些 roadmap 的测试不是为了覆盖率数字，而是为了让 Coding Agent 能在 TDD 下安全演进 Crewden 的 agent 协作闭环。每个新增行为必须先有失败测试，再实现。

## 测试分层

### 1. Hub-core 单元测试

路径：`packages/hub-core/test/*.test.ts`

适合测试：goal decomposition、risk inference、planner schema、agent recommendation。

命令示例：

```bash
pnpm --filter @crewden/hub-core test -- goalAlignment.test.ts -t "llm planner"
```

### 2. Server API / DB 测试

路径：`packages/server/test/*.test.ts`

适合测试：task 状态机、optimistic lock、audit log、dependency graph、workflow DAG、knowledge scope。

命令示例：

```bash
pnpm --filter @crewden/server test -- tasksApi.test.ts -t "dependency"
pnpm --filter @crewden/server test -- db.test.ts -t "audit log"
```

### 3. Daemon 协议 / process manager 测试

路径：`packages/daemon/test/*.test.ts`

适合测试：retry、escalation、stdout marker、CLI command、runtime driver、session carryover。

命令示例：

```bash
pnpm --filter @crewden/daemon test -- agentProcessManager.test.ts -t "retries transient"
pnpm --filter @crewden/daemon test -- simpleToolBridge.test.ts -t "CREWDEN_PLAN"
```

### 4. Shared protocol 测试

路径：`packages/shared/test/protocol.test.ts`

适合测试：新增 websocket event、marker payload schema、workflow event 类型。

### 5. Integration / e2e 测试

路径：`packages/daemon/test/e2e.test.ts`、`packages/server/test/daemonSocket.test.ts`

适合测试：server -> daemon -> agent -> server 的完整链路，以及 restart/concurrency。

## 必备测试矩阵

| 能力 | Happy path | Failure path | Edge | Concurrency / restart |
|---|---|---|---|---|
| Task 状态机 | open->in_progress->done | illegal transition 422 | cancelled from any state | stale version 409 |
| Retry/escalation | transient retry 后成功 | permanent block | unknown error retry 1 次 | restart 后不超限重复 |
| Audit log | status/handoff/delegation 有记录 | audit 写失败降级 | detail redaction | 并发事件顺序稳定 |
| Dependency graph | blocker done 后投递 | cycle 422 | self dependency | blocker done event 重复幂等 |
| Plan marker | stdout 解析 plan | invalid JSON error | 分块/多行 marker | plan approval 前 restart |
| Verification | pass 后 done | failed 不 done | no command evidence | 多 verify result 取最新 |
| Memory scope | agent 读自己 memory | A 读不到 B | global fallback | 并发写不覆盖 |
| Skill capture | approved done 生成草稿 | 未批准不生成 | 无 evidence | retry 不重复生成 |
| Runtime plugin | fake plugin load | plugin throw | duplicate name | reload 不影响运行中任务 |
| DAG | root 并行 join 等待 | cycle / no daemon | single node | scheduler restart 恢复 |

## TDD 模板

每个任务在文档里都应像这样写：

```md
### Task N：能力名

- Failing test：`具体测试名` in `packages/.../test/...test.ts`
- 命令：`pnpm --filter @crewden/... test -- ... -t "..."`
- 期望失败：说明当前代码缺什么，不接受“测试语法错误”。
- 最小实现：只改哪些文件，做最少逻辑。
- 通过标准：单测和相关包测试通过。
- Commit：`feat(scope): ...`
```

## 测试设计建议

### 表驱动测试

状态机、错误分类、marker schema 都应用 table-driven tests：

```ts
it.each([
  ['open', 'in_progress', true],
  ['done', 'in_progress', false],
])('transition %s -> %s allowed=%s', ...)
```

### Property-style 测试

不一定引入新库；可用生成小图的方式测试 DAG：

- 任意 self-loop 必须 reject。
- 任意 cycle 必须 reject。
- 任意 DAG topological order 中，下游不能早于上游启动。

### Fake driver / fake server

Daemon 测试不要调用真实 Claude/Codex/Gemini。使用 fake driver 返回：

- exit code 0 + stdout marker。
- exit code 1 + transient stderr。
- exit code 1 + permanent stderr。
- 分块 stdout：模拟 marker 被拆开。

### Restart 测试

Restart 不一定真杀进程，可用“重新创建 store/registry/scheduler 实例 + 同一 DB 文件/fixture”模拟。重点断言：

- audit log 仍可查。
- retry attempt 不归零。
- workflow waiting node 不重复投递。

### Redaction 测试

任何 audit、skill capture、memory draft 都要测试 redaction：

- `token=...`
- `Authorization header with bearer credential`
- `api_key` / `password`

期望输出包含 `[REDACTED]`。

## Coding Agent 执行约束

1. 每次只做一个 roadmap task。
2. 先贴出将新增的 failing test 名和命令。
3. 跑失败后再写实现。
4. 实现后跑精确测试，再跑相关 package test。
5. 文档或测试发现路径不准，先修文档再继续。
6. 每个 task 一个 commit，避免巨型 diff。

## CI 建议

短期可以新增 GitHub Actions matrix：

```bash
pnpm --filter @crewden/shared test
pnpm --filter @crewden/hub-core test
pnpm --filter @crewden/server test
pnpm --filter @crewden/daemon test
```

若安装依赖受限，Coding Agent 至少应运行能运行的 package tests，并在 PR/提交说明里明确未运行项和原因。

## 完成定义

一个 roadmap task 只有同时满足以下条件才算完成：

- 有先失败后通过的测试记录。
- 生产代码只覆盖该 task 范围。
- 相关 audit/状态/协议变更有测试。
- 没有 secret 泄露到日志、memory、skill、audit。
- 文档中对应任务状态或备注已更新。
