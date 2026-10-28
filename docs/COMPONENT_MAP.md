# Bob — Component Map

> 把逻辑组件映射到真实代码。统一项目新源码见本页末段；前身落点仅供只读参考，去留判断（retain、adapt、replace、merge、retire，均为 proposed，在 BP1 去留表获批后才生效）。
> 路径相对于 `<workspace_root>`。观察时间：2026-10-28，旧 App HEAD `a4ff5fd`，旧 Online HEAD `d14a527`，13个tracked修改、111个untracked项（只读采样）。详细表、状态、凭据及测试清单见[WP-01](evidence/2026-10-28-wp01-deep-inventory.md)。

## 1 统一项目（本仓库）

| 逻辑组件 | 落点 | 状态 |
|---|---|---|
| 文档与治理 | `AGENTS.md`、`docs/`、`references/` | 已建立 |
| bob-kernel、外壳、契约 | `docs/wiki/kernel-schema.md`仅设计；`docs/evidence/wp02-schema-check.py`仅DDL检查 | Rust/Vue实现尚未建立（BP2） |

## 2 旧 App（`bob-agent/`，Tauri v2 + Vue 3，0.9.30）

| 能力 | 主要落点 | 初判 |
|---|---|---|
| 设计系统、视图、i18n | `src/`（views、components、locales），`design_principles.md`，`design_system.html` | retain（ONL-D-003 已认定其为 Canonical UI） |
| Bridge 适配层 | `src/tauri-bridge.js` | adapt |
| LLM 引擎、Provider、工具循环 | `src-tauri/src/llm.rs`、`tools.rs` | adapt（Provider 注册改为配置驱动） |
| Persistent Work Core | `src-tauri/src/work_core/`（`repository.rs`、`project_links.rs`、`decision_change.rs`） | adapt（并入 bob-kernel，与 Online 的语义对齐） |
| Goal Runtime、Complexity Router | `src-tauri/src/goal_runtime/`、`complexity_router.rs` | retain 或 adapt |
| 捕获、笔记、知识库、知识图谱 | `capture.rs`、`capture_router.rs`、`notebook.rs`、`kb_indexer.rs`、`kb_extractor.rs`、`kg.rs` | retain（个人事务域） |
| 日程与待办 | `calendar.rs`、`scheduler.rs` | retain |
| Dream、记忆、演化 | `dream.rs`、`evolution.rs`、`assistant_context.rs` | retain，需评估 |
| PC↔Android 同步与设备信任 | `sync_engine.rs`（530KB）、`device_trust.rs`（324KB）、`sync_protocol.rs`、`sync_diagnostics.rs` | **replace/adapt建议**：双向LWW/冲突副本→Home事件与intent；work_*/goal_*未同步；不整文件迁入 |
| HTTP API | `http_api.rs`（285KB） | 待评估 |
| 中继（生产实例在 VPS3） | `relay/`（权威源码）；`bob-relay.js`、`src-tauri/src/bin/bob-relay.rs` 为遗留实现 | adapt（改为可替换的 Connection Provider） |
| 远程 Agent（DSH）与 Core 客户端 | `src-tauri/src/remote_agent/`（`dsh.rs`、`live.rs`、`core.rs`） | adapt（变成 Harness runner 或契约客户端） |
| 设备凭据保护 | `src-tauri/plugins/tauri-plugin-device-vault`；`keychain.rs`（已停用） | adapt：Remote Agent用DPAPI/Android vault；LLM Key仍明文；crypto设备PIN方案不是OS保护，Linux vault尚缺 |
| 微信网关 | `src-tauri/src/wechat/` | 待定（开源合规） |
| 其他：Web Drop、PPTX 导出、Daily Brief、MCP、Doctor、llama sidecar | `web-drop/`、`exports/pptx.rs`、`daily_brief/`、`plugins.rs`、`doctor.rs`、`sidecar.rs` | 逐项评估 |
| 旧交换契约（UDES） | `docs/contracts/bob_cloud_agent_interchange.yaml` | retire（已被 ONL core-client-contract-v1 取代） |

## 3 旧 Online（`cloud-agent/`，pnpm monorepo，Node/TS）

| 能力 | 主要落点 | 初判 |
|---|---|---|
| 协议类型 | `packages/shared/` | 作为契约参考，进入新 schema |
| Core：State Store、Task/Execution/Artifact/Verification/Review | `packages/server/src/` | 语义移植到 bob-kernel（BOB-D-005） |
| Runtime 与 Harness 适配（DSH、AGY、Codex、pi） | `packages/server/src/runtime/`（本轮按正式入口只读核对，冲突副本不迁入） | 过渡期作为 runner 复用（进程边界） |
| 节点原生会话 | `packages/server/src/routes/node-work.ts`、`runtime/dsh-web-session.ts` | 参考协议/UI；内存回执不承担新Outbox可靠性 |
| WebUI（Studio、NodeWork、Review、Dual-Diff） | `packages/ui/src/` | merge：治理视图并入统一 UI |
| 部署与发布脚本 | `deploy/`（工作树状态以本次Evidence为准） | 参考；不进入统一项目 |
| Lab、实验 | `packages/server/src/lab/` | 待评估（含个人主机引用） |

## 4 其他相关

| 项 | 落点 | 说明 |
|---|---|---|
| 独立 relay 目录 | `bob-relay/`（不是 Git 仓库） | 与旧 App 的 `relay/` 关系待核 |
| 搬移的 worktree | 工作区规定的外置 worktree 缓存目录下的 `cloud-agent-r06d-r05e` | 2707 项未提交改动，含 `.ssot-staging/b4*`；**禁止 prune** |

## 5 WP-01 → WP-02 的复用边界

- 保留语义：Goal/Milestone分组、唯一Task、Execution尝试、不可变成果父版、检查与人审、请求幂等、签名/吊销及进程归属。
- 必须适配：旧App的rpc_staged_outbox为接收配置暂存；write_mobile_outbox是JSON写命令；旧Online四条governed路径是AGY/Pi/DSH/Codex，Generic API仍是旧PTY路径。
- 必须重写：Home/Replica同步、跨认证会话的持久请求回执、单飞预热与Outbox、统一领域写入入口。不能迁入磁盘失败退回内存或吞SQL错误的“成功”路径。
- 代码迁入尚未获文件级批准；本表不是搬迁许可。统一项目没有运行时实现，Schema检查不替代产品验收。

## 1.0.1 新写源码落点（2026-10-28）

- `Cargo.toml`、`crates/bob-kernel/`：持久消息/Outbox、迁移、预热纯状态机；Windows离线内核9项测试通过；Unix/真实Provider未验证。
- `apps/bob-app/src/send-controller.mjs`：输入框本地保存确认控制器；注入bridge，尚无Tauri/Provider接线。
- `apps/bob-app/tests/send-controller.test.mjs`：6项本地模拟bridge测试，不证明真实内核IPC或网络。
