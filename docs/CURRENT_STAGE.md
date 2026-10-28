# Bob — Current Stage（1.0.1 施工与交接合同）

> 施工合同：现在做什么、下一项可派发工作是什么、验收标准是什么。修订：2026-10-28。
> **当前版本与分支：`1.0.1`**（`main` 与 `1.0.1` 同步演进；旧版 v0.9.30 已归档至 `legacy/v0.9` 分支）。
> **当前里程碑：WP-03连接/威胁模型设计获批；BP2-01/02开始新写源码。轻量控制器6项测试通过；Windows离线内核9项测试通过（含独立进程强制中断恢复），Tauri接线、真实连接未验证。**

---

## 1 已完成事实（接手 Agent 无需重做）

1. **仓库、分支与远端已就绪（WP-00 & WP-04 完成）**：
   - 本地仓库位于高速区 `<local_code_root>/bob-agent`（不走 OneDrive/Syncthing，靠 GitHub 同步）。
   - GitHub 远端：`https://github.com/bobbik1984/bob-agent.git`（推送时建议使用 `git -c http.sslBackend=schannel push origin 1.0.1 main`）。
   - 分支结构：
     - `legacy/v0.9`（`a4ff5fd`）：完整封存旧单机 App v0.9.30 代码与 19 个历史 Tag。
     - `1.0.1` 与 `main`：基于 `a4ff5fd` 快进演进的 `1.0.1` 统一架构基线。
   - 前身仓库保护备份：`<workspace_root>/bob-agent/.backup/2026-10-28/` 与 `<workspace_root>/cloud-agent/.backup/2026-10-28/`（含搬移 worktree 备份）均已生成并校验通过（见 [evidence/2026-10-28-wp00-backup.md](evidence/2026-10-28-wp00-backup.md)）；`cloud-agent` 线上改动也已归档推送至其 GitHub 仓库（`d14a527`）。
2. **核心架构决策已锁定（见 [DECISIONS.md](DECISIONS.md)）**：
   - **BOB-D-001（accepted）**：旧版归入 `legacy/v0.9`，新主线以 `1.0.1` 推进，项目名保持 `bob-agent`。
   - **BOB-D-002（accepted）**：面向白领与普通开发者（单用户多设备，非企业级重型协同）。
   - **BOB-D-003（accepted）**：移动端为 Tauri Android，iOS 后期评估。
   - **BOB-D-004（accepted）**：优先搭建作者完整个人工作环境，**X1C 作为个人环境的 Home 主权威库**，手机作为 Replica。
   - **BOB-D-005（accepted）**：**单一 Rust 内核（`bob-kernel`）**，同时嵌入 Tauri Desktop、Tauri Android 与可选无头 `bob-node`；Harness 适配器走进程边界。
   - **BOB-D-008（accepted）**：**懒式响应（Lazy Dormant Sync）+ 输入框聚焦/打字静默预热（Speculative Pre-Warm）+ 单飞唤醒复用（`inFlightWakeupPromise`）+ 本地持久化发件箱（Local-First Durable Outbox）**，保证网络状态不阻塞本地持久接纳；远端接收/执行须各自有证据，永久离线或权限失效不承诺远端必达（审计报告见 [evidence/2026-10-28-lazy-send-audit.md](evidence/2026-10-28-lazy-send-audit.md)）。

---

## 2 下一步接手 Agent 的详细任务队列（按顺序执行）

| 顺序 | 工作包 ID | 任务名称 | 当前状态 | 交付物位置 |
|---|---|---|---|---|
| **Step 1** | **WP-01** | 前身项目深度只读盘点补全 | **静态盘点完成**（不含旧测试执行/全历史secret扫描） | `docs/evidence/2026-10-28-wp01-deep-inventory.md`、`docs/COMPONENT_MAP.md` |
| **Step 2** | **WP-02** | `bob-kernel` 单一内核 Schema 与懒式预热 Outbox 状态机定案 | **设计与25项DDL约束通过**；内核实现已开始但未编译验证 | `docs/ARCHITECTURE.md`、`docs/wiki/kernel-schema.md` |
| **Step 3** | **WP-03** | X1C Home ↔ Android 连接配置与安全威胁模型 | 设计已获批；实现安全验证待做 | `docs/wiki/connectivity.md`、`docs/wiki/threat-model.md`、`DECISIONS.md` |
| **Step 4** | **BP2-01** | 建立 `1.0.1` 代码工程骨架（Rust Workspace + Tauri v2 + Vue 3） | 新写内核/控制器骨架进行中；构建待单独授权 | `Cargo.toml`、`crates/bob-kernel/`、`apps/bob-app/` |
| **Step 5** | **BP2-02** | 实现 `BOB-D-008` 懒式响应、打字静默预热与本地 Durable Outbox 闭环 | 待 BP2-01 完成后执行 | `crates/bob-kernel/src/outbox/`、`src/work/` 契约测试 |

---

### Step 1 — WP-01：前身项目深度只读盘点补全（只读，不改旧仓库）

1. **旧 App 同步与信任引擎审计**：
   - 读取 `<workspace_root>/bob-agent/src-tauri/src/sync_engine.rs`、`<workspace_root>/bob-agent/src-tauri/src/device_trust.rs`、`<workspace_root>/bob-agent/src-tauri/src/outbox.rs`。
   - 梳理清楚：现有 SQLite 表清单、哪些表参与同步、`rpc_staged_outbox` / `peer_revocation_outbox` 表结构及 `write_mobile_outbox` JSON命令的幂等差异（后者并非表）、哪些可直接复用到 `1.0.1` 的“X1C Home + 手机 Replica”架构中。
2. **旧 Online（Bob Core）实体与治理状态机盘点**：
   - 读取 `<workspace_root>/cloud-agent/packages/shared/src/types.ts`、`<workspace_root>/cloud-agent/packages/server/src/db/` 及路由层。
   - 列出完整的表结构、状态流转（`Project`、`Task`、`Execution`、`Artifact`、`Verification`、`Review`）与 Harness Runner（DSH / AGY / Codex / Generic API）调用接口。
3. **凭据存储与安全扫描**：
   - 检查旧 App `<workspace_root>/bob-agent/src-tauri/src/llm.rs` 与 `crypto.rs` 中 API Key 和设备私钥的存储方式（区分系统安全存储 vs 明文 `config.json`）。
   - 统计两个旧仓库的测试文件数量与CI工作流定义（只统计不运行；不把定义存在写成远端CI通过）。
4. **验收输出**：
   - 写入 `docs/evidence/2026-10-28-wp01-deep-inventory.md`，并更新 [COMPONENT_MAP.md](COMPONENT_MAP.md) 中的模块复用映射表。

---

### Step 2 — WP-02：`bob-kernel` 单一内核 Schema 与懒式预热 Outbox 状态机设计

1. **同名实体统一 Schema（SQLite DDL 草案）**：
   - 2026-10-28交付见 [kernel-schema](wiki/kernel-schema.md)，来源与验证见 [WP-01/02 Evidence](evidence/2026-10-28-wp01-deep-inventory.md)；31张草案表、25项内存DDL约束检查通过，不代表运行状态机/真机验证。
   - 将旧 App 的 `Conversation / Message / Capture / Memory / Goal / Milestone / Task / Decision / Artifact / Evidence` 与旧 Online 的 `Project / Task / Execution / Artifact(带版本) / Verification / Review` 合并为同一套无歧义的 SQLite 表结构：
     - 明确 `Goal/Milestone`（目标分组层）→ `Task`（用户事项层，唯一权威）→ `Execution`（单次模型/Harness 执行尝试，含 `requested / resolved / observed`）的三层关系。
2. **`BOB-D-008` 懒式响应 + 打字预热 + 本地 Outbox 协议规范**：
   - 完整定义 `intent_outbox` 表结构（`request_id`、`session_id`、`target_device_id`、`kind`、`payload_json`、`expected_version`、`send_state`、`attempts`、`last_error`、`created_at`、`dispatched_at`、`acked_at`）。
   - 画出状态机流转图并固化边界：
     - **触发端（UI 输入框）**：`@focus` / `@input`（15s 冷却）触发静默预热 `prewarm()`，与 `send()` 共享单飞 `inFlightWakeupPromise`。
     - **落盘即成功**：`send()` 写入 `intent_outbox`（状态 `local_saved` → `queued_for_wakeup`）即返回 `true`，UI 立即清空输入框并上屏显示消息。
     - **出网分界线**：字节写入传输层前失败（如 `!alive`、唤醒超时、旧 `watchId`）一律记为 `not_dispatched`，自动重连并刷新 `watchId` 后重发，**绝不打入 `REMOTE_OUTCOME_UNKNOWN`**；字节已写入传输层但未收到 ACK 记为 `unknown_send`，重连后先按 `request_id` 对账再决定补发或拉取结果。
     - **空会话休眠**：移除 `messages.length > 0` 限制，空会话在静止阶段同样允许进入 `linkDormant`。
3. **`bob-kernel` Crate 模块划分与进程边界契约**：
   - 明确 `crates/bob-kernel` 内部子模块：`storage`、`domain`（continuity + governance + personal_ops）、`outbox`、`sync`（Home/Replica）、`policy`、`providers`（Connection / Capability / Harness Runner IPC）。
4. **验收输出**：
   - 新增 `docs/wiki/kernel-schema.md` 并更新 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

### Step 3 — WP-03：连接配置与安全威胁模型

1. **个人环境与开源默认连接配置**：
   - 基于 [wiki/connectivity.md](wiki/connectivity.md)，定义 Connection Provider 接口（L1 局域网 mDNS/HTTP → L2 QUIC/iroh P2P → L3 可配置 E2EE Relay → L4 云盘异步信箱 → L5 常开节点）。
   - 作者个人环境（X1C Home ↔ Android）通过外部配置文件注入现有 Relay 与 Headscale 地址（读取工作区 `cluster-ops` 的 `service_map.md`，**严禁硬编码进源码**）。
2. **安全威胁模型（必过门）**：
   - 针对“手机远程读取 X1C 文件（F4）”与“触发 X1C Harness 执行”编写威胁模型：设备配对（QR + PoP）、一键吊销出件箱、操作级授权（R0–R3）、工作区路径沙箱、重放防护（nonce + timestamp + request_id）及手机丢失处置。
3. **验收输出**：
   - 新增 `docs/wiki/threat-model.md`，推动 `BOB-D-006` 与 `BOB-D-007` 状态更新。

---

### Step 4 & Step 5 — BP2：工程骨架搭建与核心链路落地（需注意重型操作防火墙）

> ⚠️ **注意**：根据全局 `AGENTS.md` 重型操作防火墙规则，执行 `cargo build`、`npm/pnpm install`、`tauri build` 前需向用户确认授权；且所有缓存/编译产物必须留在本地 `D:\Code\` 下，绝不污染 OneDrive。

1. **BP2-01 工程骨架与旧代码按模块迁入**：
   - 在本仓库建立 Cargo Workspace（`crates/bob-kernel`、`apps/bob-app/src-tauri`）与前端工程（基于 `legacy/v0.9` 的 Vue 3 设计语言演进，合入 Online 的任务治理视图）。
2. **BP2-02 落地 `BOB-D-008` 懒式预热与发送必达闭环**：
   - 修复 `legacy/v0.9` 审计出的 4 处非即时发送漏洞（`dsh.rs` 未出网误报 `REMOTE_OUTCOME_UNKNOWN`、`remote-agent-service.js` 的 `connecting` 跳过唤醒与旧 `watchId` 残留、空会话不进 `linkDormant`、`ChatView.vue` `@pc` 离线拒发）。
   - 实现输入框 `@focus` / `@input` 静默预热（`prewarm`）+ 单飞 `inFlightWakeupPromise` + SQLite `intent_outbox` 本地先落盘状态机，并编写覆盖“休眠秒发、预热中途点发送、未出网断连重发、已出网断连对账、空会话休眠”5 大场景的自动化测试。

---

## 3 允许与禁止（安全护栏）

- **允许**：只读查阅 `<workspace_root>/bob-agent`、`<workspace_root>/cloud-agent` 与 Google Drive 文档；在本仓库编写文档、设计 Schema，并在获得对应阶段授权后编写 `1.0.1` 代码与测试；向 `origin` 的 `1.0.1` 与 `main` 分支提交并推送。
- **禁止**：修改前身仓库的业务代码（除非用户专门要求给 `legacy/v0.9` 打热补丁）；在代码中硬编码 `bobbik.org`、IP 或任何密钥；未经用户确认执行耗时的全量打包编译。

## 4 历史交接（2026-10-28，WP-01 / WP-02；当前状态以第5节为准）

- 基线：1.0.1/main=`d842924`，接手干净；旧App=`a4ff5fd`，旧Online=`d14a527`，保留所有既有改动。
- WP-01：48个旧App静态表、20个Online业务表+3个认证表，含同步范围、状态门、Runner差异、凭据风险与测试/CI口径；检查并归并审计中的四处发送漏洞。
- WP-02：Schema与实体映射、Home两跳、首次离线接纳、workspace租约、预热/投递单飞、已证明未发与未知分界、持久接收回执、父版本/验证/人工审阅合同。文档设计自检完成，未将细节变更写成用户新决策。
- 已通过：SQLite内存DDL及关系约束25项；旧系统测试、Rust状态机、磁盘崩溃恢复、手机真机、节点/模型/生产检查均未运行。具体范围及可复现脚本见Evidence。
- 下一项：原WP-03。BOB-D-006/007仍proposed，许可证/文件级代码迁入清单、连接威胁模型与构建授权未满足，Step4/5不启动。新项目文档按BOB-D-004通过GitHub同步；未擅自建立Drive新镜像。
- 进度投影经project_aligner的reviewed-patch生成：当前工具限定工作区内部路径，故在临时目录校验同一投影后按原文件hash比对写回本项目；不修改旧项目投影或全局注册表。
- 回退：仅恢复本轮统一项目文档差异；没有旧仓库、数据库、凭据或生产变更要撤销。

## 5 当前执行：WP-03获批，BP2-01/02源码实现

用户2026-10-28确认connectivity与threat-model两份文档并要求连续推进。BOB-D-006设计接受；BOB-D-007是否添加Drive只读镜像仍未决，不阻塞内核实现。用户随后批准离线内核编译测试及修复；未授权联网安装依赖、Tauri打包、现场密钥/网络操作或发布。

- 新写Cargo workspace和bob-kernel：从本项目Schema提取迁移，持久SQLite Outbox、本地消息事务、请求身份冲突、发送模糊边界、Home回执与纯预热状态机。没有复制legacy业务源码。
- 新写App发送控制器与6项Node内置测试：本地确认才清草稿、等待期间输入保护、重复点击合并、IPC不确定重试同ID。6/6通过，但bridge为测试替身，没有Tauri/Rust端到端。
- 内核Rust离线编译成功，Windows适用9项测试通过；包含磁盘重开、锁竞争、独立子进程强制退出后的unknown恢复与禁止重派。Unix链接用例未运行；无真实网络/模型。源码与边界见[BP2 Evidence](evidence/2026-10-28-bp2-source.md)。
- 当前只包含Rust workspace及App控制器；Vue/Tauri壳、IPC、真实异步共享等待、认证Provider、Home Inbox消费及control lane尚未实现。BP2-01/02保持进行中。

### 下一执行顺序与门槛

1. 已按授权完成`cargo test --offline --locked -p bob-kernel`，产物位于仓库外；新增Cargo.lock固定本次解析。9项通过，1项默认ignored为被父测试显式调用的子进程夹具，不计额外独立通过项。未运行Unix专属用例。
2. 下一项接共享异步唤醒、Home接收事务和有界dispatcher；补控制消息不被未知普通发送堵塞的测试。
3. 建立Vue/Tauri壳和IPC，接入同一内核。安装依赖与构建另按具体命令批准；UI必须展示本地保存/等待Home/已接收的真实区别。
4. 接经授权的Provider和配对流程，再验证真实PC/手机；不把模拟bridge或设计威胁模型当作设备连通、安全或发送必达证明。

回退：撤回本轮新源码与文档提交即可；没有业务数据库迁移、legacy改动、凭据或生产变化。日常小步编码/轻量检查连续执行，重型操作集中授权。
