# SwarmOS 双人开发分工说明

## 1. 文档目的

本文档用于将 `SwarmOS-基于Crewden的实施方案与并行开发清单.md` 拆分为适合两个人并行推进的明确分工方案。

目标不是简单地把工作平均分配，而是：

- 降低代码冲突
- 保持系统边界清晰
- 让两个人可以尽快并行开工
- 保证最终能落到需求文档中的核心目标：
  - 中台动态组装多个 Agent
  - 同时启动多个 Agent
  - 本地执行安全可控
  - 前端可观测、可审批

---

## 2. 分工原则

两个人开发这个项目，最稳妥的拆法不是“一个人前端，一个人后端”。

原因是这个项目真正复杂的地方不在传统页面开发，而在：

- 中台如何动态创建多个 Agent
- 中台与 daemon 如何对齐执行协议
- 多 Agent 并发执行时如何做锁控、超时与审批

因此，推荐按下面两个方向拆分：

1. **控制面负责人**
   - 负责协议、中台、前端、状态流转、审批交互

2. **执行面负责人**
   - 负责 daemon、本地执行安全、文件锁、超时与高危动作控制

这是当前最适合 SwarmOS 的双人拆法。

---

## 3. 总体分工结论

### A 负责人

**中台与前端负责人**

负责范围：

- `shared` 协议定义主导
- `server` 中台改造
- `web` 前端改造
- `swarm/init` 接口
- 多 Agent 运行态管理
- thought stream 事件定义与展示
- approval 审批流
- browser websocket 事件
- UI 到中台的主闭环

### B 负责人

**Daemon 与执行安全负责人**

负责范围：

- `daemon` 改造主导
- 文件锁
- action 执行器
- 命令超时强杀
- 高危动作识别与本地审批前置
- 执行结果结构化回传
- daemon 侧测试与并发验证

---

## 4. A 负责人任务说明

## 4.1 角色定义

A 负责人负责把 SwarmOS 做成一个真正的“中台控制面”。

重点不是单纯做页面，而是负责：

- 动态智能体工厂的协议定义
- SwarmOS 中台的数据结构和状态机
- 中台与前端之间的事件流
- 最终用户可见的交互闭环

换句话说，A 负责人是：

- 动态工厂 owner
- 中台 owner
- UI owner

## 4.2 核心目标

A 负责人需要完成四类目标。

### 目标一：定义动态智能体工厂协议

需要主导设计 `swarm/init` 所需 shared 类型和 schema，至少覆盖：

- `channel_id`
- `agents[]`
- 每个 agent 的：
  - `agent_id`
  - `role`
  - `model`
  - `system_prompt`
  - `allowed_tools`
- `swarm_id`
- `session` 或等效运行态标识

同时补齐以下中台通用结构：

- `thought_log`
- `approval:requested`
- `approval:resolved`
- `daemon:action:update`
- `waiting_lock`
- `awaiting_approval`
- `timed_out`

### 目标二：实现中台动态组装与批量启动多个 Agent

需要在 `server` 中实现：

- `POST /api/v1/swarm/init`
- 按请求动态创建多个 agent runtime config
- 将一组 agent 注册到同一个 swarm/session
- 为后续启动、调度、可视化提供统一的数据结构

这里的关键点是：

- 不是预设静态 agent
- 而是运行时根据 JSON 动态组装多个 agent

### 目标三：实现中台事件流与审批流

需要让 `server` 真正成为系统唯一大脑。

需要实现的能力包括：

- 接收 daemon 返回的 `waiting_lock`
- 接收 daemon 返回的 `awaiting_approval`
- 接收 `thought_log`
- 记录 approval 请求及结果
- 广播 websocket 事件到前端
- 提供 approve / reject 的 API 或等效路由
- 管理多 agent 的运行态

### 目标四：实现前端可视化与审批 UI

需要在前端实现以下用户可见能力：

- 多个 agent 的运行状态
- thought stream 折叠面板
- 审批卡片
- 锁等待状态
- 执行状态时间线

重点是：

- thought log 不作为普通消息气泡展示
- approval 必须是可操作交互

## 4.3 代码 owner 范围

A 负责人独占 owner 的建议范围如下：

- `crewden/packages/shared/src/protocol.ts`
- `crewden/packages/shared/src/validation.ts`
- `crewden/packages/shared/src/index.ts`
- `crewden/packages/server/src/app.ts`
- `crewden/packages/server/src/db.ts`
- `crewden/packages/server/src/events.ts`
- `crewden/packages/server/src/schema.ts`
- `crewden/packages/server/src/ws/*`
- `crewden/packages/server/src/routes/*`
- `crewden/packages/web/src/App.tsx`
- `crewden/packages/web/src/api.ts`
- `crewden/packages/web/src/components/*`
- `crewden/packages/web/src/pixel.css`
- 对应的 `server/web/shared` 测试文件

## 4.4 不负责的内容

A 负责人不应主动接管以下内容：

- daemon 文件锁实现
- daemon 命令超时 kill switch
- daemon 高危动作本地二次拦截
- `crewden/packages/daemon/src/agentProcessManager.ts` 的主导权

若确需修改 daemon owner 文件，只允许最小接入点，并先与 B 负责人对齐。

## 4.5 阶段性交付标准

A 负责人至少要交付以下成果：

1. `swarm/init` 的 shared 协议与 schema 第一版
2. server 侧 swarm/session 数据结构
3. server 可记录一个 swarm 下多个 agent
4. websocket 可推送 thought / approval / lock 状态
5. UI 可展示 mock 事件
6. UI 最终接上真实中台事件

## 4.6 建议开发顺序

建议 A 负责人按以下顺序推进：

1. 先定 `shared` 契约
2. 再加 `swarm/init` 路由与 store 结构
3. 再加 approval / thought / action update 事件流
4. 前端先做 mock 版可视化
5. 最后接真实 websocket 与 API

---

## 5. B 负责人任务说明

## 5.1 角色定义

B 负责人负责把 daemon 改造成一个安全、受控、可被中台调度的本地执行终端。

重点不是做 UI，也不是做中台状态流转，而是：

- 保证多个 agent 同时开发时，本地执行不会失控
- 保证文件不会被并发覆盖
- 保证高危动作不会绕过审批
- 保证死循环或超时命令可以被及时强杀

换句话说，B 负责人是：

- daemon owner
- 本地执行安全 owner

## 5.2 核心目标

B 负责人需要完成四类目标。

### 目标一：实现 daemon action 执行抽象

执行侧不能继续只依赖散落的 CLI 输出逻辑，需要抽象成统一 action。

至少应支持：

- 文件读
- 文件写
- 命令执行
- 必要时的目录操作

并且所有执行结果都需要回传结构化数据。

### 目标二：实现本地文件排他锁

这是 daemon 侧最高优先级能力之一。

需要支持：

- 文件路径规范化
- 独占锁表
- 写冲突识别
- 冲突时返回 `waiting_lock`
- 锁释放后供中台重试

目标是保证：

- 同一文件不会被多个 agent 同时覆盖写

### 目标三：实现命令超时强杀

所有命令执行都需要具备 timeout 包装能力。

默认按需求文档实现：

- 超时时间：60 秒

超时后行为要求：

- kill 子进程
- 回传结构化 `TimeoutError`
- 携带必要日志信息
- 不遗留悬挂状态

### 目标四：实现高危动作本地二次拦截

daemon 必须作为最后一道安全防线。

需要支持：

- 定义高危命令识别策略
- 命中高危动作时不直接执行
- 返回 `awaiting_approval`
- 获批后再继续执行

目标是保证：

- 就算中台漏拦截，daemon 也不会裸执行危险命令

## 5.3 代码 owner 范围

B 负责人独占 owner 的建议范围如下：

- `crewden/packages/daemon/src/agentProcessManager.ts`
- `crewden/packages/daemon/src/daemonClient.ts`
- `crewden/packages/daemon/src/index.ts`
- `crewden/packages/daemon/src/bridge/*`
- `crewden/packages/daemon/src/drivers/*`
- `crewden/packages/daemon/src/workspace/*`
- `crewden/packages/daemon/test/*`

可新增的模块建议包括：

- `locks.ts`
- `actions.ts`
- `timeouts.ts`
- `riskPolicy.ts`
- `approvalGate.ts`

## 5.4 不负责的内容

B 负责人不应主动接管以下内容：

- `shared` 协议主导权
- server 路由与 store 主导权
- browser 事件格式设计主导权
- 前端 UI 与展示逻辑

若确需修改 server 或 shared 的 owner 文件，只允许最小接入点，并先与 A 负责人对齐。

## 5.5 阶段性交付标准

B 负责人至少要交付以下成果：

1. daemon action 执行模型成型
2. 同一文件并发写入时稳定返回 `waiting_lock`
3. 超时命令可被 kill 并回传 `TimeoutError`
4. 高危动作可返回 `awaiting_approval`
5. daemon 结果结构能被中台消费

## 5.6 建议开发顺序

建议 B 负责人按以下顺序推进：

1. 先基于 shared 契约定义 daemon action 输入输出
2. 再实现文件锁管理器
3. 再实现 timeout 包装器
4. 再实现风险动作识别与审批前置
5. 最后接入主执行链路和测试

---

## 6. 两人之间的协作边界

## 6.1 唯一必须强对齐的内容

两个人真正需要同步的核心只有以下协议与状态字段：

1. `POST /api/v1/swarm/init` 的 request/response
2. swarm/session 的中台数据结构
3. daemon action request 格式
4. daemon action result 格式
5. `waiting_lock` 的返回字段
6. `awaiting_approval` 的返回字段
7. `thought_log` 的事件字段

只要这一层契约稳定，两人就可以长时间并行开发。

## 6.2 高冲突文件

以下文件是本项目的高冲突点，应避免双人同时编辑：

- `crewden/packages/shared/src/protocol.ts`
- `crewden/packages/shared/src/validation.ts`
- `crewden/packages/server/src/db.ts`
- `crewden/packages/server/src/ws/daemonSocket.ts`
- `crewden/packages/daemon/src/agentProcessManager.ts`
- `crewden/packages/web/src/App.tsx`
- `crewden/packages/web/src/api.ts`

## 6.3 Owner 策略

建议采用如下 owner 策略：

- `shared/*`：A 负责人独占
- `server/*`：A 负责人独占
- `web/*`：A 负责人独占
- `daemon/*`：B 负责人独占

这是当前最少冲突的边界划分。

---

## 7. 推荐执行顺序

## 7.1 第一阶段：协议对齐

A 与 B 先共同完成协议对齐，建议控制在半天到 1 天内完成。

需要一起定下来的内容：

- `swarm/init` request/response
- daemon action request/result
- `waiting_lock` 字段
- `awaiting_approval` 字段
- `TimeoutError` 字段
- `thought_log` 字段
- 运行状态枚举

这一阶段的输出物建议包括：

- shared 协议草案
- 一页状态机说明

## 7.2 第二阶段：并行开发

协议一旦稳定，两人立刻并行。

### A 开工内容

- `shared`
- `server`
- `web`

### B 开工内容

- `daemon`
- `daemon test`

## 7.3 第三阶段：联调

联调阶段建议按下面方式推进：

### A 提供

- 中台 mock action 调度
- 前端 mock websocket 事件
- 中台 API 与 websocket 接口

### B 提供

- daemon 真实返回结构
- 文件锁返回结果
- timeout 返回结果
- 审批挂起返回结果

## 7.4 第四阶段：收口验证

两人共同完成以下目标：

1. 中台可动态初始化多个 agent
2. 多 agent 并发写同一文件可触发锁机制
3. 高危动作可进入审批流
4. 前端可看到 thought / approval / lock 状态
5. 完成需求文档里的全链路 demo：
   - 创建 `utils.py`
   - 写入冒泡排序
   - 执行脚本
   - 展示结果

---

## 8. 不建议的拆法

以下几种拆法不推荐使用。

## 8.1 一个人前端，一个人后端加 daemon

问题：

- 这个项目最复杂的部分不是页面，而是中台与执行面的协议
- 把 server 和 daemon 绑在一个人身上，会让这个人负担过重

## 8.2 一个人做动态工厂，一个人做安全控制

问题：

- 两边都会改 `shared`
- 两边都会碰 `server`
- 边界不清晰，冲突反而更多

## 8.3 一个人主开发，另一个人只写测试

问题：

- 第二个人长期阻塞
- 人力利用率低
- 不能真正并行推进核心能力

---

## 9. 最终推荐

最适合当前项目的双人分工是：

- **A：中台 + 前端 + 协议 owner**
- **B：daemon + 本地执行安全 owner**

这是当前最稳、最符合需求文档、最容易并行推进的双人分工方式。

它的优势是：

- 系统边界清晰
- 代码 owner 明确
- 高冲突文件最少
- 满足中台动态组装并启动多个 Agent 的目标
- 满足本地执行安全可控的目标

---

## 10. 共同开发约束

建议把下面这段作为两位开发者的共同协作规则：

1. 你不是仓库里唯一的开发者，不要回退对方改动。
2. 先对齐 shared 契约，再各自大规模开发。
3. 高冲突 owner 文件默认不跨界修改。
4. 如需修改对方 owner 文件，只允许最小接入点，并提前说明原因。
5. 先保证最小可运行闭环，再考虑抽象重构。

