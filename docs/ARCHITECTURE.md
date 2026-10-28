# Bob — Architecture

> 本文记录**已接受的边界与不变量**和**待决的架构候选**，两者分节标明。代码位置见 [COMPONENT_MAP](COMPONENT_MAP.md)，决策理由见 [DECISIONS](DECISIONS.md)。截至 2026-10-28，统一项目还没有代码，以下内容都不代表已实现的能力。

## 1 已接受的不变量

来源：用户在本项目中的确认（BOB-D-001 至 BOB-D-004），以及两个前身项目中**都已接受、并且与本项目定位一致**的原则（ONL 宪法第 1–12 条、APP-D-008 / D-009 / D-016 / D-018）。

1. **One truth per item**：每个对象任一时刻只有一个权威写入者；交接必须显式，并保留来源（ONL 宪法 11）。
2. **Project ≠ Workspace ≠ Host**：项目是逻辑主体；工作区是某台主机上的目录；只同步工作，不同步全部硬盘（ONL 宪法 1）。
3. **Task > Execution**：换模型、换 Harness、换主机都创建新的 Execution，保留同一个事项身份；不在原 Execution 内“换脑”（ONL 宪法 2、8）。
4. **Execution completed ≠ Task completed**：生成、登记、验证、审阅、接受分开记录（ONL 宪法 4，ONL-D-WEB-01）。
5. **Transcript ≠ Memory**：会话记录只是证据；长期记忆有来源、可检查、可纠正、可遗忘（ONL 宪法 5，APP-D-019）。
6. **Capability is real only when available**：能力只有在当前环境真实可用时才出现；降级必须诚实，不静默回退（APP-D-016，ONL 宪法 9、12）。
7. **Requested / Resolved / Observed**：模型和运行配置分开记录；没有观测证据就是 `unknown`。
8. **三个信任域分离**：设备配对、操作授权、Provider 认证相互独立。配对成功不等于可以写文件，有模型 Key 不等于批准执行。
9. **凭据留在边缘**：凭据存放在设备的系统安全存储（Windows DPAPI、Android Keystore）或执行主机本地；不同步、不进日志、不进成果、不进上下文包。
10. **懒式响应、打字预热与发送必达（BOB-D-008）**：连接默认采用懒式响应（空闲静止会话允许底层隧道休眠 `linkDormant`，不刷重连风暴）；当用户聚焦输入框（`@focus`）或开始打字（`@input`）时，后台静默触发预热重连（Pre-Warm），利用打字时间差提前完成握手并共享单飞 `inFlightWakeupPromise`。发送状态严格分层：`local_saved`（本机已落盘 Outbox，**此时 UI 发送动作即宣告成功**）→ `queued_for_wakeup`（等待预热/唤醒就绪）→ `dispatched`（已写入传输层）→ `peer_accepted`（对方已接收）→ `running` → `pending_verification` / `unknown_send`。**未写入网络流的本地/建连失败一律归为 `not_dispatched` 自动重连重发，严禁因为处于非即时模式而让用户发送失败，也严禁将未出网的请求误判为 `unknown_send` 锁死会话**；真正的 `unknown_send` 重连后必须先按 `request_id` 对账再决定补发或拉取结果。
11. **原始证据不被覆盖**：摘要、检索、纠正都不能覆盖原始捕获和证据。
12. **个人基础设施不进代码**：域名、IP、节点只能经配置或 Provider 注入（BOB-D-004）。

## 2 目标逻辑分层（BOB-D-005 已接受：单一 Rust 内核）

```text
┌──────────────── Shells ────────────────┐
│ Tauri Desktop │ Tauri Android │ (iOS later) │ bob-node (headless)
└───────────────┬─────────────────────────┘
                │  Vue 3 UI（沿用旧 App 设计语言，Online 的治理视图并入同一界面）
┌───────────────▼─────────────────────────┐
│ bob-kernel（Rust，单一实现）              │
│  · 个人连续性：Conversation、Capture、Memory、Decision、材料引用 │
│  · 工作治理：Project、Task、Execution、Artifact（版本）、Verification、Review │
│  · 个人事务域：日程、待办、笔记（领域模块，各有一个权威位置） │
│  · 授权与策略：Policy、批准、审计回执       │
│  · 存储：SQLite + 追加型事件日志            │
└───────┬───────────────┬─────────────────┘
        │               │
┌───────▼──────┐ ┌──────▼──────────────────────────┐
│ Connection   │ │ Capability Providers               │
│ Providers    │ │ 模型（BYOK）· 文件 · Harness runner（进程边界）· 通知 │
│ L1–L5        │ └──────────────────────────────────┘
└──────────────┘
```

## 3 数据所有权模型（BOB-D-004 / 005：Home 加 Replica）

- 每个用户有且只有一个 **Home** 内核作为主权威（**作者个人环境：X1C**；白领默认：自己的 PC）。
- 其他设备是 **Replica**：只读缓存加带 `expected_version` 的意图队列。
- 追加型对象（捕获、消息、证据）可以在任意一端用全局唯一 ID 创建，之后汇入 Home，不会冲突。
- 修改已有对象必须由 Home 接受；版本过期时拒绝，并向用户解释原因。不做多主合并，CRDT 不是首轮前提。
- Home 不可达时，Replica 可以独立完成基本对话（BYOK 直连模型）和捕获；涉及 Home 的操作进入队列，界面明确提示。
- 活动数据库**不通过文件同步**共享。

## 4 待决问题

| 问题 | 决策 | 前置工作 |
|---|---|---|
| 内核语义对齐（同名实体、迁移边界） | BOB-D-005（已接受统一内核） | WP-02 |
| 连接分层与默认方案 | BOB-D-006（proposed） | WP-03 |
| 旧 App PC↔Android 同步引擎的去留 | 待开题（审查 AD-6） | WP-01 |
| UI 收敛：直接演进旧 App UI，还是另起 UI 包 | 待开题（审查 AD-4） | WP-02 |
| 旧 App 微信网关等模块是否进入开源核心 | 待开题 | BP6 前 |

## 5 安全边界（必过门）

手机远程读取 PC 文件（F4）、Harness 在个人电脑上执行，是攻击面最大的两条路径。上线前必须完成 WP-03 威胁模型：设备配对与吊销、操作授权范围、默认拒绝的执行环境、重放防护、日志脱敏，以及丢失手机时的处置。
