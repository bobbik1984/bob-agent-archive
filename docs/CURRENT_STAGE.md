# Bob — Current Stage

> 施工合同：现在做什么、下一项可派发工作是什么。修订：2026-10-28。
> **当前里程碑：BP0 真相与保护 → BP1 架构定案**（PDLC Stage 1–2：Vision、Initialization 与 Specification；**不写业务代码**）

## 1 当前事实

- 统一项目 `bob-agent` 版本基线定为 **`1.0.1`**（包含 Production 级文档骨架，2026-10-28），并在工作区 `project_registry.yaml` 中登记为 `bob_agent`（`bob-agent`）。前身单机版历史（`a4ff5fd`，v0.9.30）已归入 `legacy/v0.9` 分支，新主线从 `1.0.1` 分支推进开发。
- **WP-00 前身项目保护基线已完成并验证**：备份位于对应旧仓库的 `.backup/2026-10-28/`（已加入 `.git/info/exclude`），校验结果见 [evidence/2026-10-28-wp00-backup.md](evidence/2026-10-28-wp00-backup.md)。前身项目盘点见 [evidence/2026-10-28-legacy-inventory.md](evidence/2026-10-28-legacy-inventory.md)。
- **懒式响应与非即时发送可靠性审计已完成**：见 [evidence/2026-10-28-lazy-send-audit.md](evidence/2026-10-28-lazy-send-audit.md) 与 **BOB-D-008**（强制本地 Outbox 先落盘即成功、单飞唤醒等待、严格区分 `not_dispatched` 与 `unknown_send`）。
- **已接受的决策**：BOB-D-001（新目录、`legacy/v0.9` 归档、`1.0.1` 起步）、BOB-D-002（白领与普通开发者，单用户多设备）、BOB-D-003（Tauri Android，iOS 后期）、BOB-D-004（个人环境优先，**主库 Home 在 X1C**，代码走 GitHub 同步）、**BOB-D-005（单一 Rust 内核，多种部署形态）**、**BOB-D-008（懒式响应与非即时模式下发送必不失败铁律）**。
- **待裁决**：BOB-D-006（连接分层方案）、BOB-D-007（文档位置与 Drive 镜像）。

## 2 工作包

| ID | 内容 | 状态 | 授权 |
|---|---|---|---|
| **WP-00** | 前身项目保护基线 | **done** | 已批准并验证 |
| **WP-01** | 盘点补全（只读） | 可以派发 | 只读 |
| **WP-02** | 单一内核语义对齐与范围设计 | **下一个主任务** | 只写本仓库文档 |
| **WP-03** | 连接定案与威胁模型 | 可以派发（实测需批准） | 文档可写 |
| **WP-04** | 仓库初始化与登记 | **部分完成**（本地 Git + registry 已完成；GitHub 远端待配置） | 已批准 |

### WP-01 盘点补全（只读）

- 旧 App 同步引擎（`sync_engine.rs`、`device_trust.rs`）：同步哪些表，多主还是主从，冲突怎么处理，能否改造为“X1C Home 加手机 Replica”。
- 两个前身仓库的测试数量与 CI 状态（只统计，不运行）。
- Git 历史中是否出现过 secrets（只读扫描，只报类别和位置，不输出值）。
- 旧 Online 的实体清单与 API 路由清单；旧 App 的 LLM Key 存储代码路径。
- **输出**：追加到 `docs/evidence/`，更新 COMPONENT_MAP。

### WP-02 单一内核语义对齐与范围设计（BOB-D-005 已接受）

- 同名实体语义对齐表：Project、Task、Decision、Artifact、Evidence，以及旧 App 的 Goal/Milestone 与旧 Online 的 Execution/Verification/Review 如何合并进同一套模型。
- `bob-kernel` crate 内部模块划分：哪些进内核，哪些是 Provider 接口。
- X1C 作为 Home 的运行机制：X1C 在线与睡眠/关机时，手机 Replica 的读写边界、意图队列（outbox）和版本检查。
- 过渡期如何通过进程边界复用旧 Online 的 TS Harness 适配器。
- **输出**：更新 ARCHITECTURE，形成可审阅的内核 schema 草案。

### WP-03 连接定案与威胁模型

- 依据 [wiki/connectivity.md](wiki/connectivity.md) 给出个人环境（X1C Home ↔ Android Replica）的连接配置，以及开源默认方案。
- 威胁模型：配对、吊销、重放、被盗手机、中继与云盘元数据、Harness 执行沙箱。
- P2P 与云盘信箱的实测计划（执行实测需另行批准）。

### WP-04 仓库初始化（剩余项）

- 已完成：本地 `git init` 与首个提交；`project_registry.yaml` 登记 `bob_agent`（`bob-agent`）。
- 待完成：绑定 GitHub 远端并推送（本机未安装 `gh` CLI，需用户提供新建的 GitHub 仓库地址或授权创建方式）；引入工具链前做 `sync_cache_offloader` dry-run 审计。

## 3 允许与禁止

- **允许**：读取前身项目和 Drive 文档；在本仓库写文档并提交到本地 Git。
- **禁止**（除非对应工作包获批）：修改前身仓库的业务文件；复制业务代码进入本仓库；安装依赖；构建或打包；改动生产环境；对外发送网络请求；新建或轮换凭据。

## 4 退出门（BP0 → BP1 → BP2）

- BP0 退出：WP-00 已通过；WP-01 完成。
- BP1 退出：WP-02 内核实体与 schema 草案获批；WP-03 威胁模型与 BOB-D-006 获批；GitHub 远端已接通。

## 5 紧邻队列

BP2 骨架：Rust workspace（`crates/bob-kernel`）、Tauri v2 桌面与 Android 外壳、契约测试与 CI。
