# SwarmOS 基于 Crewden 的实施方案与并行开发清单

## 1. 文档目的

本文档用于回答三个问题：

1. `需求文档.md` 提出的 MVP 目标，是否适合基于现有 `crewden` 与 `ruflo` 复用实现。
2. 推荐的技术路线是什么，哪些能力直接复用，哪些能力必须补写。
3. 如何把开发任务拆成可并行执行的工作流，便于同时启动多个 coding agent 开发。

本文档面向产品 owner、技术负责人和并行开发 agent，重点强调：

- 方案选择依据
- 系统边界
- 模块改造点
- 并行开发边界
- 验收标准

---

## 2. 执行结论

### 2.1 总体判断

结论明确如下：

- **推荐方案：以 `crewden` 为主骨架进行二次开发。**
- **`ruflo` 不建议作为 MVP 的核心运行时直接嵌入。**
- **`ruflo` 更适合作为设计参考库，而不是底层强依赖。**

这不是“两个项目各拿一半拼起来”就能低成本完成的事情。  
从工程可控性、改造成本、并行开发效率和后续维护性看，最优路线是：

- 复用 `crewden` 的前端、服务端、daemon、WebSocket 通道、agent 生命周期管理；
- 自行补齐 PRD 中缺失的核心能力；
- 仅借鉴 `ruflo` 的 swarm / orchestration / tool / planner 设计思路，不把它当成 SwarmOS 的实际调度中台。

### 2.2 为什么不是“Crewden 做 UI，Ruflo 做核心”

表面上看，这个组合很合理：

- `crewden` 有聊天 UI、agent 面板、daemon 通道；
- `ruflo` 有 swarm、tool、memory、plugin、orchestration 概念。

但真正落地时会出现架构冲突：

1. `crewden` 本身不是纯 UI，而是完整的 `web + server + daemon` 骨架。
2. `ruflo` 也不是一个轻量 SDK，而是一个完整生态，包含 CLI、MCP、插件、memory、federation、swarm 等大系统。
3. 你的 PRD 强调的是本地安全执行闭环，而 `ruflo` 的重心在多 agent 编排与扩展生态，两者关注点不完全一致。
4. 如果把 `ruflo` 当“核心引擎”嵌入，那么 SwarmOS 自己的中台将沦为一层适配壳，很多协议、状态机和控制权要重新对齐，反而比自己在 `crewden` 上做 MVP 更重。

因此：

- **MVP 阶段不建议深度集成 `ruflo` runtime。**
- **MVP 阶段建议自主掌控调度中台逻辑。**

---

## 3. 现状评估

## 3.1 `crewden` 已具备的能力

`crewden` 已经具备与你的 PRD 高度接近的三层结构：

- `web`：React/Vite 聊天式界面
- `server`：Fastify + REST + WebSocket
- `daemon`：本地 CLI agent 拉起、stdout/stderr 收集、回传 server

它已经不是“一个 UI demo”，而是一套接近可运行产品的基础设施。可直接复用的部分包括：

- daemon 与 server 的 WebSocket 双向通信
- browser 与 server 的 WebSocket 实时事件推送
- agent 启停与消息投递
- 本地 runtime 检测与 CLI 进程拉起
- 基础任务、提醒、delegation、activity 日志模型
- 聊天频道、消息流、侧边栏、agent 详情、任务面板

### 3.2 `crewden` 与 PRD 的差距

`crewden` 目前还不满足以下核心需求：

1. **动态智能体工厂**
   - 需要一个面向业务的 `swarm/init` 接口
   - 需要支持运行时 JSON 动态组装 agent，而不是偏静态的 agent 配置

2. **思考链路实时流传输**
   - 当前有 `agent:activity`
   - 但没有标准化 thought stream 事件模型
   - 也没有前端“可折叠思考面板”视图

3. **本地文件排他锁**
   - 当前 daemon 没有完整的文件级 mutex 管理器
   - 缺少 `waiting_lock`、重试队列、锁释放通知闭环

4. **命令超时强杀**
   - 当前能管理 CLI 子进程
   - 但缺少统一的 `60s timeout -> kill -> structured TimeoutError` 机制

5. **高危操作人工审批**
   - 当前没有系统级风险动作拦截器
   - 没有“暂停 agent -> 前端审批 -> 恢复或拒绝”的状态机

### 3.3 `ruflo` 适合借鉴什么

`ruflo` 适合借鉴的是“理念与设计”，而不是整套运行时：

- swarm init / scale / status 的概念建模
- orchestration 与 tool routing 思路
- planner / workflow / agent delegation 的设计模式
- 面向 tool 的消息组织方式

### 3.4 `ruflo` 当前不建议直接复用什么

MVP 阶段不建议直接复用：

- 整套 swarm runtime
- 整套 MCP server 作为主执行核心
- plugin marketplace
- federation
- memory substrate
- 多 provider / 自学习 / 各类高级插件依赖链

这些能力不是没价值，而是对当前 MVP 来说过重，会显著推高集成成本。

---

## 4. 推荐技术路线

## 4.1 核心原则

SwarmOS MVP 应遵循以下原则：

1. **中台自主可控**
   - 调度逻辑、审批逻辑、锁控逻辑、超时逻辑必须掌握在 SwarmOS 自己手里。

2. **复用现成链路，不复用重生态**
   - 复用 `crewden` 的通信骨架、UI 骨架、daemon 骨架。
   - 不在 MVP 阶段引入 `ruflo` 的复杂运行时耦合。

3. **优先闭环，不优先高级能力**
   - 先跑通“需求 -> 动态 agent -> 文件操作/命令执行 -> 安全控制 -> 结果回显”。
   - planner、memory、复杂 swarm 拓扑可后置。

4. **为并行开发设计边界**
   - 任务拆分必须尽量按写入范围隔离。
   - 避免多个 agent 同时编辑同一批核心文件。

## 4.2 推荐架构

推荐架构如下：

```text
User
  -> SwarmOS Web UI
  -> SwarmOS Middleware (基于 crewden/server 扩展)
  -> SwarmOS Daemon (基于 crewden/daemon 扩展)
  -> Local Runtime / Tool Execution
```

其中：

- UI 继续使用 `crewden/packages/web` 改造
- Middleware 继续使用 `crewden/packages/server` 改造
- Daemon 继续使用 `crewden/packages/daemon` 改造
- Protocol 类型继续集中在 `crewden/packages/shared`

## 4.3 MVP 只做的事情

MVP 建议只做以下最小集：

1. `POST /api/v1/swarm/init`
2. agent runtime config 动态实例化
3. thought log 事件流
4. daemon 文件锁
5. daemon 命令超时强杀
6. 高危动作审批闭环
7. 端到端演示路径：
   - 用户在 UI 输入需求
   - 中台创建/唤醒 agent
   - agent 申请文件写入/命令执行
   - daemon 执行
   - 结果回到聊天界面

## 4.4 MVP 暂不做

以下能力明确后置：

- 复杂 DAG 编排
- 多机 federated swarm
- 向量记忆 / RAG
- 完整 MCP 平台化
- 多租户 / 企业权限
- 高级成本治理
- 自学习与自治优化

---

## 5. 模块改造清单

## 5.1 Shared 协议层

目标：补齐 SwarmOS 所需的标准消息与状态类型。

建议新增或扩展：

- `SwarmInitRequest`
- `SwarmInitResponse`
- `ThoughtLogEvent`
- `ApprovalRequest`
- `ApprovalDecision`
- `DaemonActionRequest`
- `DaemonActionResult`
- `LockStatus`
- `TimeoutErrorPayload`
- `RiskLevel`

建议新增事件类型：

- `thought_log`
- `approval:requested`
- `approval:resolved`
- `daemon:action:update`
- `lock:update`

建议新增状态：

- `waiting_lock`
- `awaiting_approval`
- `timed_out`
- `cancelled`

## 5.2 Server / Middleware 层

目标：把 `crewden/server` 从“agent 聊天编排器”升级为“SwarmOS 调度中台”。

关键改造点：

1. 新增 `swarm/init` 路由
   - 输入 channel_id 与 agents[] JSON
   - 动态写入内存 store
   - 返回 swarm session 信息

2. 新增中台级 action orchestration
   - 收 daemon 结果
   - 处理 `waiting_lock`
   - 管理重试队列
   - 处理审批挂起与恢复

3. 新增 approval store
   - 记录待审批动作
   - 记录审批结果
   - 驱动前端审批 UI

4. 新增 thought stream 广播
   - 将 agent 思考日志实时推送到浏览器

5. 新增 session / swarm 运行态
   - 一个 channel 下可能对应一组 agent
   - 需要有 swarm 级元数据

6. 新增风险动作策略
   - 命令规则匹配
   - 标记高危动作
   - 进入审批状态机

## 5.3 Daemon 层

目标：把 `crewden/daemon` 从“CLI 进程托管器”升级为“安全执行终端”。

关键改造点：

1. 文件锁管理器
   - 文件路径规范化
   - 独占锁表
   - 读/写策略
   - 锁释放通知

2. 动作执行抽象
   - 文件读写、命令执行、可能的目录操作统一走 action 接口
   - 而不是散在多个 driver 内部逻辑里

3. 超时 kill switch
   - 所有命令执行支持超时配置
   - 默认 60 秒
   - 超时后 kill 子进程并上报结构化错误

4. 风险动作本地拦截
   - daemon 最好也做最后一道校验
   - 避免中台漏拦截时直接执行危险命令

5. thought / activity 输出采集
   - 规范 stdout 中的 thought marker
   - 映射为 thought_log 事件

## 5.4 Web / UI 层

目标：在现有 `crewden` 聊天式界面上增加 SwarmOS 特有的执行观测和审批能力。

关键改造点：

1. 思考流面板
   - thought log 不进入普通气泡
   - 以可折叠卡片显示

2. 审批卡片
   - 展示风险动作
   - `[Approve]` / `[Reject]`
   - 显示来源 agent、目标命令、风险等级

3. 锁等待状态提示
   - 显示某个 agent 因锁等待被挂起

4. 执行状态时间线
   - thinking
   - waiting_lock
   - awaiting_approval
   - running
   - timed_out
   - success / error

5. swarm 初始化入口
   - 可以是临时管理面板或开发开关
   - MVP 不一定要复杂 UI，但至少要可调用

---

## 6. 建议的协议与状态机

## 6.1 `swarm/init` 接口

建议接口：

`POST /api/v1/swarm/init`

请求体：

```json
{
  "channel_id": "c_9901",
  "agents": [
    {
      "agent_id": "coder_main",
      "role": "Senior Developer",
      "model": "claude-3-5-sonnet",
      "system_prompt": "你负责处理具体的代码修改...",
      "allowed_tools": ["file_read", "file_write", "exec_cmd"]
    }
  ]
}
```

返回体建议包含：

```json
{
  "swarm_id": "sw_001",
  "channel_id": "c_9901",
  "agent_count": 1,
  "status": "initialized"
}
```

## 6.2 daemon action 模型

建议不要把“文件写入”“命令执行”“审批前置判断”散在各自代码路径里。  
应统一为 `action` 模型：

```json
{
  "action_id": "act_889",
  "agent_id": "coder_main",
  "tool": "file_write",
  "target_path": "/app/main.js",
  "params": {
    "content": "console.log('hello');"
  }
}
```

返回：

```json
{
  "action_id": "act_889",
  "status": "success"
}
```

或：

```json
{
  "action_id": "act_889",
  "status": "waiting_lock",
  "lock_owner": "coder_a"
}
```

或：

```json
{
  "action_id": "act_889",
  "status": "awaiting_approval",
  "approval_id": "ap_001"
}
```

或：

```json
{
  "action_id": "act_889",
  "status": "error",
  "error_type": "TimeoutError",
  "stdout_log": "...",
  "stderr_log": "..."
}
```

## 6.3 审批状态机

推荐状态机：

`planned -> risk_detected -> awaiting_approval -> approved/rejected -> executing -> finished`

要求：

- 审批必须是幂等的
- 同一 `approval_id` 不可重复执行
- reject 后必须显式恢复 agent 到可继续计划的状态，不能一直悬挂

## 6.4 文件锁状态机

推荐状态机：

`unlocked -> locked -> released`

当冲突发生时：

- 当前动作进入 `waiting_lock`
- server 将其加入重试队列
- 锁释放时按顺序重新调度

---

## 7. 并行开发总拆分

这一部分是本文档最重要的内容之一。目标是让多个 coding agent 可以同时工作，尽量避免互相修改同一组文件。

## 7.1 并行开发原则

1. 每个 agent 负责明确的写入范围。
2. `shared` 协议层尽量先由一个 agent 统一定义，减少后续冲突。
3. `server`、`daemon`、`web` 三大方向尽量分开。
4. 高耦合文件必须指定唯一 owner。
5. 测试可由各工作流内自带，也可单独设一个收口 agent。

## 7.2 推荐的工作流分组

推荐拆成六个工作流：

1. **协议与数据模型工作流**
2. **中台调度与审批工作流**
3. **Daemon 安全执行工作流**
4. **前端思考流与审批 UI 工作流**
5. **端到端验收与测试工作流**
6. **文档与集成收口工作流**

---

## 8. 可并行任务分配清单

下面给出适合直接分配给多个 coding agent 的任务清单。每个任务都明确了目标、主要文件范围、与其他任务的依赖和并行注意事项。

## 8.1 Agent A：协议与数据模型

### 目标

统一定义 SwarmOS 所需的 shared types、schema 和事件枚举，作为其他工作流的基础契约。

### 主要职责

- 设计 `swarm/init` 请求与响应类型
- 设计 thought log / approval / action / lock / timeout 的 shared 协议
- 扩展 browser / daemon / server 之间的消息类型
- 补齐 Zod schema 与测试

### 建议写入范围

- `crewden/packages/shared/src/protocol.ts`
- `crewden/packages/shared/src/validation.ts`
- `crewden/packages/shared/src/index.ts`
- `crewden/packages/shared/test/*`

### 不应修改

- `packages/server/*`
- `packages/daemon/*`
- `packages/web/*`

### 依赖

- 无，最先开始

### 交付标准

- 类型和 schema 可独立通过测试
- 为 server / daemon / web 提供稳定字段定义

## 8.2 Agent B：Server 中台调度与审批

### 目标

在 `crewden/server` 中实现 SwarmOS 的中台职责。

### 主要职责

- 新增 `POST /api/v1/swarm/init`
- 新增 action orchestration / waiting_lock 重试队列
- 新增审批数据模型与审批路由
- 新增 thought log 广播
- 新增 browser event 推送

### 建议写入范围

- `crewden/packages/server/src/app.ts`
- `crewden/packages/server/src/db.ts`
- `crewden/packages/server/src/events.ts`
- `crewden/packages/server/src/schema.ts`
- `crewden/packages/server/src/ws/*`
- `crewden/packages/server/src/routes/*`
- `crewden/packages/server/test/*`

### 不应修改

- `packages/daemon/*`
- `packages/web/*`
- `packages/shared/*` 仅在协议 owner 合入后消费

### 依赖

- 依赖 Agent A 先定义 shared 协议

### 交付标准

- 能通过接口创建 swarm
- 能接收 `waiting_lock` / `awaiting_approval` / `thought_log`
- 能将事件推送给前端

## 8.3 Agent C：Daemon 文件锁与超时强杀

### 目标

把 daemon 扩展成安全执行终端。

### 主要职责

- 实现文件路径锁管理器
- 实现统一 action 执行器
- 实现命令超时 kill switch
- 回传结构化 `waiting_lock`、`TimeoutError`
- 追加相关测试

### 建议写入范围

- `crewden/packages/daemon/src/agentProcessManager.ts`
- `crewden/packages/daemon/src/daemonClient.ts`
- `crewden/packages/daemon/src/index.ts`
- `crewden/packages/daemon/src/bridge/*`
- `crewden/packages/daemon/src/workspace/*`
- `crewden/packages/daemon/src/` 下新增 `locks.ts`、`actions.ts`、`timeouts.ts` 等文件
- `crewden/packages/daemon/test/*`

### 不应修改

- `packages/web/*`
- `packages/server/routes/*`

### 依赖

- 依赖 Agent A 提供 action / result shared 类型

### 交付标准

- 同一文件并发写入冲突可稳定返回 `waiting_lock`
- 超时命令可在 60 秒后被 kill
- 能回传结构化执行结果

## 8.4 Agent D：Daemon 高危动作审批前置

### 目标

实现 daemon 侧风险动作识别与审批前置校验。

### 主要职责

- 定义高危命令匹配策略
- 实现本地二次拦截
- 输出 `awaiting_approval` 结果
- 避免 server 漏拦截时危险命令直接执行

### 建议写入范围

- `crewden/packages/daemon/src/` 下新增 `riskPolicy.ts`
- `crewden/packages/daemon/src/bridge/*`
- `crewden/packages/daemon/src/drivers/*` 仅在必要时最小修改
- `crewden/packages/daemon/test/*risk*`

### 不应修改

- `packages/web/*`
- 大范围修改 `agentProcessManager.ts`，除非与 Agent C 明确分工

### 依赖

- 依赖 Agent A shared 类型
- 与 Agent C 高耦合，二者需要切开写入范围

### 协作建议

如果同时启动 Agent C 与 Agent D，建议：

- Agent C 拥有 `agentProcessManager.ts`
- Agent D 尽量通过新增模块与最小接入点完成集成

### 交付标准

- 高危动作可识别
- daemon 可返回审批挂起信号

## 8.5 Agent E：前端 thought stream 与审批 UI

### 目标

在现有聊天界面上实现 SwarmOS 的核心可视化能力。

### 主要职责

- thought stream 折叠面板
- 审批请求卡片
- approve / reject 按钮交互
- 锁等待状态显示
- 执行状态时间线或 activity 视图增强

### 建议写入范围

- `crewden/packages/web/src/App.tsx`
- `crewden/packages/web/src/api.ts`
- `crewden/packages/web/src/components/*`
- `crewden/packages/web/src/pixel.css`
- `crewden/packages/web/test/*`

### 不应修改

- `packages/server/*`
- `packages/daemon/*`

### 依赖

- 依赖 Agent A 的事件类型
- 部分依赖 Agent B 的 API 与 websocket 事件命名

### 交付标准

- thought log 不再作为普通消息展示
- 审批流前端可完整操作
- 锁等待与执行状态对用户可见

## 8.6 Agent F：测试与全链路验收

### 目标

围绕 MVP 验收标准建立自动化验证，减少联调风险。

### 主要职责

- 增补 server / daemon / web 的集成测试
- 编写并发锁冲突测试
- 编写审批流测试
- 编写 timeout kill 测试
- 编写 MVP 全链路 e2e 用例

### 建议写入范围

- `crewden/packages/server/test/*`
- `crewden/packages/daemon/test/*`
- `crewden/packages/web/test/*`
- 如有必要新增 `tests/e2e` 或扩展现有 e2e

### 不应修改

- 大量业务实现代码

### 依赖

- 依赖 Agent B/C/D/E 的功能基本成型

### 交付标准

- 能覆盖 PRD 中三条 MVP 验收要求
- 能作为最终收口验证基线

## 8.7 Agent G：文档与集成收口

### 目标

把最终设计、协议和运行方式补充为项目文档，方便后续协作与验收。

### 主要职责

- 更新实现文档
- 更新 API 与运行说明
- 输出联调手册
- 记录仍未覆盖的风险与后续路线

### 建议写入范围

- `crewden/docs/*`
- 根目录实施文档

### 不应修改

- 核心实现文件

### 依赖

- 依赖前述工作流完成后收口

---

## 9. 推荐并行启动顺序

建议不要一次性让所有 agent 同时开工。  
最稳妥的顺序如下：

### 第一批

1. Agent A：协议与数据模型
2. Agent B：中台调度骨架设计
3. Agent C：daemon 文件锁与 timeout 设计

说明：

- A 负责契约先行。
- B、C 可一边等待 shared 契约，一边先搭内部结构和测试骨架。

### 第二批

4. Agent D：风险动作审批前置
5. Agent E：前端 thought / approval UI

说明：

- D 在 C 的 daemon 结构上切入。
- E 可基于 mock 事件先搭 UI，再对接真实 websocket。

### 第三批

6. Agent F：测试与全链路验收
7. Agent G：文档与收口

说明：

- F 不应过早启动，否则只能写大量易变测试。
- G 最适合在协议和交互稳定后开始收口。

---

## 10. 并行开发时的冲突规避建议

## 10.1 高冲突文件

以下文件容易成为冲突点，应指定唯一 owner：

- `crewden/packages/shared/src/protocol.ts`
- `crewden/packages/shared/src/validation.ts`
- `crewden/packages/server/src/db.ts`
- `crewden/packages/server/src/ws/daemonSocket.ts`
- `crewden/packages/daemon/src/agentProcessManager.ts`
- `crewden/packages/web/src/App.tsx`
- `crewden/packages/web/src/api.ts`

## 10.2 推荐的 owner 策略

- `shared/*` 由 Agent A 独占
- `server/src/db.ts` 与 `server/src/ws/*` 由 Agent B 独占
- `daemon/src/agentProcessManager.ts` 由 Agent C 独占
- `web/src/App.tsx` 与 `web/src/api.ts` 由 Agent E 独占

## 10.3 并行协作约束

给并行 coding agent 的任务说明中，建议强制写入以下约束：

- 你不是代码库里唯一的 agent，不要回退他人改动。
- 仅修改你负责的文件范围。
- 如果需要修改他人 owner 文件，只允许最小接入点，并在结果里明确说明。
- 优先新增文件而不是侵入式改动共享核心文件。

---

## 11. 里程碑与工期评估

以下估算基于“1 个负责人 + 多个 coding agent 并行辅助”的开发模式。

## 11.1 MVP 工期估算

### 方案一：以 `crewden` 为主骨架，`ruflo` 仅做参考

- 预计工期：**3 到 6 周**
- 风险等级：**中**
- 推荐程度：**高**

### 方案二：`crewden` 做 UI，`ruflo` 做核心中台

- 预计工期：**6 到 12 周**
- 风险等级：**高**
- 推荐程度：**低**

## 11.2 里程碑建议

### M1：协议定版

- shared 类型确定
- websocket 事件确定
- action / approval / lock / timeout 字段确定

### M2：中台与 daemon 基础闭环

- swarm/init 可创建 agent
- daemon action 可执行
- 基本回传打通

### M3：安全闭环

- 文件锁
- 超时 kill
- 高危审批

### M4：前端可观测性

- thought stream
- 审批 UI
- 锁等待状态

### M5：验收与收口

- 完成并发锁测试
- 完成超时测试
- 完成前端输入“创建 utils.py 并执行”全链路演示

---

## 12. MVP 验收映射

本节用于把 PRD 中的验收标准映射到实际开发任务。

## 12.1 连通性验收

PRD 要求：

- 调度中台服务启动后，本地 daemon 能稳定连接并接收控制。

落地要求：

- server 能识别 daemon ready
- server 能下发 action / deliver
- daemon 能回传状态与结果

关联工作流：

- Agent A
- Agent B
- Agent C

## 12.2 安全性验收

PRD 要求：

- 两个脚本并发修改同一文件，系统能安全串行执行。

落地要求：

- daemon 持有文件锁表
- 冲突时返回 `waiting_lock`
- server 重试队列可在锁释放后恢复动作

关联工作流：

- Agent A
- Agent B
- Agent C
- Agent F

## 12.3 全链路业务验收

PRD 要求：

- 在 UI 输入“在本地创建一个 utils.py，写一个冒泡排序，然后执行它”
- 系统在 2 分钟内自动完成并回显结果

落地要求：

- agent 能被动态初始化
- 能申请文件写入和命令执行
- 命令不超时则正常回传
- UI 能显示 thought、执行状态与最终结果

关联工作流：

- Agent A
- Agent B
- Agent C
- Agent E
- Agent F

---

## 13. 风险与决策建议

## 13.1 当前主要风险

1. **协议定义发散**
   - 多个 agent 同时开工时，如果 shared 契约不先收敛，后续会频繁返工。

2. **daemon 改造过深**
   - 若文件锁、风险审批、timeout 都直接散改进 `agentProcessManager.ts`，后续会很难维护。

3. **thought stream 来源不稳定**
   - 不同 CLI runtime 的输出格式不一致，thought marker 设计要谨慎。

4. **审批流状态机复杂度被低估**
   - “暂停后恢复”通常比“只拦截一次”复杂得多，MVP 要避免过度设计。

5. **过早引入 `ruflo` 复杂能力**
   - 可能造成系统边界被污染，MVP 节奏失控。

## 13.2 对应建议

- 先定 shared 契约，再放开并行开发。
- daemon 的安全能力尽量模块化，减少把所有逻辑塞进一个 manager 文件。
- thought stream 先支持有限、可控的 marker 方案，不要一开始追求完整 CoT 抽取。
- 审批流优先支持命令类动作，不要同时覆盖所有可能工具。
- MVP 阶段避免深度嵌入 `ruflo`。

---

## 14. 最终建议

最终建议可以简化为一句话：

**把 SwarmOS 做成“基于 Crewden 的安全执行中台”，而不是“Crewden UI + Ruflo 内核”的拼装产品。**

如果目标是快速完成一个可验收的 MVP，这条路线最稳：

- 架构边界清楚
- 代码写入范围容易拆分
- 适合多 agent 并行开发
- 后续还能逐步吸收 `ruflo` 的 planner、workflow、memory 设计

---

## 15. 建议的下一步

建议按以下顺序推进：

1. 先以本文档为母文档，确认总体技术路线。
2. 先启动 Agent A，输出 shared 契约草案。
3. 同时启动 Agent B 与 Agent C，先搭 server / daemon 改造骨架。
4. 协议定版后再启动 Agent D 与 Agent E。
5. 最后由 Agent F 做收口测试。

如果需要进一步下钻，下一份文档建议写成：

- 《SwarmOS 协议规格说明》
- 《SwarmOS 中台状态机设计》
- 《SwarmOS 并行开发任务卡》

