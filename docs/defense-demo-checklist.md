# 功能清单

## 一、动态智能体工厂（Swarm/Init）

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| Swarm 初始化面板 — 选择 agent、指定角色、配置 tools，一键创建 swarm | 前端：侧边栏 SWARM INIT 面板 | 文档2 §6.1, 文档3 §1.3-1 |
| 动态 Agent 创建 — 运行时根据 JSON 动态组装 agent，非预设静态 | API 调用 POST /api/v1/swarm/init，返回 swarm_id + agent_count + status | 文档1 §4.2, 文档2 §5.2-1 |
| 批量启动多个 Agent — 一次 init 可以同时拉入多个 agent（如 developer + reviewer） | 前端 SwarmInitPanel 多选 agent + 配置角色 → 一次 Init | 文档1 §4.2, 文档3 §1.3-2 |

## 二、中台调度与通信

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| Agent 生命周期管理 — start / stop / 状态流转 (inactive → starting → running → error) | 前端 AgentDetailPanel 点击 START/STOP，实时状态变化 | 文档2 §3.1 |
| 聊天频道消息 — 用户与 agent 在频道中实时对话，支持 @mention | 前端 ChannelView 发消息 → agent 回复 | 文档2 §3.1 |
| Agent 私信 (DM) — agent 之间可以互相发私信 | AgentDetailPanel → DM Thread | 文档2 §3.1 |
| Agent 委派 (Delegation) — agent A 可以委托任务给 agent B | API 调用 delegate 接口 | 文档2 §3.1 |

## 三、可观测性面板（核心 MVP 亮点）

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| Thought Stream 思考流 — agent 的 thinking/working/output 日志，独立于聊天消息展示 | 前端 ObservabilityPanel → THOUGHT STREAM 折叠卡片 | 文档1 §4.4, 文档2 §5.4-1, 文档3 §1.3-3 |
| 审批卡片 — 高危动作自动触发审批，显示风险等级 + 来源 agent + 命令详情 | ObservabilityPanel → APPROVAL CARDS，有 [APPROVE] [REJECT] 按钮 | 文档1 §4.4, 文档2 §5.4-2, 文档3 §1.3-6 |
| 锁等待状态 — 并发写入同一文件时显示 LOCKED / RELEASED 状态 | ObservabilityPanel → ACTIVE FILE LOCKS + RECENT LOCK RELEASES | 文档1 §4.4, 文档2 §5.4-3, 文档3 §1.3-4 |
| Action Timeline 时间线 — waiting_lock / awaiting_approval / running / timed_out / success / error 全状态追踪 | ObservabilityPanel → ACTION TIMELINE | 文档1 §4.4, 文档2 §5.4-4 |
| Agent 工作区浏览器 — 查看 agent workspace 文件结构和内容 | 前端 WorkspaceBrowser 面板 | 文档2 §3.1 |

## 四、安全执行控制（核心 MVP 亮点）

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| 文件排他锁 — 两个 agent 同时写同一文件，先到者获得锁，后者返回 waiting_lock | 并发 API 调用 file_write → 观察 lock:update 事件 | 文档1 §5.2, 文档2 §5.3-1, 文档3 §1.3-4 |
| 锁释放自动重试 — 锁释放后 server 自动重试队列中的 action | 观察 lock released → daemon 重新执行 | 文档1 §5.2, 文档2 §6.4 |
| 命令超时强杀 (60s) — 超时命令被 kill，返回 TimeoutError | 发送带 timeout 的命令 → 观察 timed_out 返回 | 文档1 §5.3, 文档2 §5.3-3, 文档3 §1.3-5 |
| 高危命令拦截（双重防线） — rm -rf / sudo / chmod 777 等 17 种模式被拦截，必须审批 | 发 exec_cmd rm -rf /tmp → 返回 risk_detected → 等待审批 | 文档1 §5.4, 文档2 §5.3-4, 文档3 §1.3-6 |
| 审批流状态机 — planned → risk_detected → awaiting_approval → approved/rejected → executing → finished | 审批卡片 approve/reject → 观察状态流转 | 文档1 §4.3, 文档2 §6.3 |
| Server 端风险策略 (17 规则) + Daemon 端二次拦截 (17 规则) | 双重安全防线可单独演示 | 文档2 §5.2-6, §5.3-4 |

## 五、全链路 E2E 演示

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| "创建 utils.py + 冒泡排序 + 执行" 完整链路 | 前端输入需求 → swarm init → agent 写文件 → 执行 → 结果回显 | 文档1 §7.4-5, 文档2 §12.3, 文档3 §1.3-7 |
| 审批 E2E — 高危命令 → 拦截 → 审批通过 → 执行成功 | API: exec_cmd rm -rf → risk_detected → approve → success | 文档2 §12.2 |
| 审批拒绝 E2E — 高危命令 → 拦截 → 审批拒绝 → 状态 rejected | API: exec_cmd sudo rm -rf → risk_detected → reject → rejected | 文档2 §6.3 |

## 六、架构与技术路线

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| Crewden 主骨架 + Ruflo 仅参考 — 自主掌控调度中台 | 架构图 + 代码结构说明 | 文档3 §0, 文档2 §2.1 |
| 三层架构 — Browser (React) ↔ Server (Fastify) ↔ Daemon (Node.js) ↔ CLI Agent | 架构图 | 文档2 §4.2 |
| 双人分工 owner 边界 — A: shared/server/web, B: daemon，协议层强对齐 | 代码目录归属说明 | 文档1 §3, §6 |
| Zod Schema 协议层 — SwarmInitRequest/Response, DaemonActionRequest/Result, LockStatus, TimeoutErrorPayload 等全类型校验 | protocol.ts | 文档2 §5.1 |
| 422 条测试全部通过 — shared 53 + web 30 + hub-core 17 + daemon 167 + server 155 | 运行 pnpm test | 文档2 §8.6 |

## 七、其他可演示功能

| 演示项 | 演示方式 | 对应需求 |
|---|---|---|
| 任务看板 (Task Board) — 创建/认领/流转/审查任务 | 前端 TaskBoard 面板 | 文档2 §3.1 |
| 目标管理 (Goal + Alignment) — 从消息创建目标 → 澄清 → 拆解任务 | GoalDraftPanel + GoalAlignmentPanel | 文档2 §3.1 |
| 知识库 (Knowledge) — 存储/搜索项目知识 | KnowledgePanel | 文档2 §3.1 |
| Machine 管理 — 查看 daemon 连接状态、runtime 版本、在线/离线 | MachinePanel + API /api/machines | 文档2 §3.1 |
| WebSocket 实时推送 — browser 和 daemon 双通道实时事件 | 浏览器 WS /ws, daemon WS /daemon/connect | 文档2 §5.2-4 |

---

## 建议答辩演示路径（15-20 分钟）

1. **架构概述 (2min)** — 三层架构图 + 双人分工
2. **Swarm Init (2min)** — 前端选 agent → 一键创建 swarm
3. **Agent 对话 (3min)** — 发消息 → agent 回复（完整链路）
4. **安全闭环 (5min)** — 高危命令拦截 → 审批卡 approve/reject → 状态机流转
5. **文件锁 (2min)** — 并发写入冲突 → waiting_lock → 释放重试
6. **超时强杀 (1min)** — 60s timeout → TimeoutError
7. **可观测性面板 (2min)** — Thought Stream + Lock Status + Action Timeline
8. **全链路 Demo (2min)** — utils.py 冒泡排序端到端
