# Bob — Component Map

> 把逻辑组件映射到真实代码。统一项目**尚无代码**；本页当前只记录前身项目中的落点和初步去留判断（retain、adapt、replace、merge、retire，均为 proposed，在 BP1 去留表获批后才生效）。
> 路径相对于 `<workspace_root>`。观察时间：2026-10-28，旧 App HEAD `a4ff5fd`，旧 Online HEAD `97e3480`，后者有大量未提交改动。

## 1 统一项目（本仓库）

| 逻辑组件 | 落点 | 状态 |
|---|---|---|
| 文档与治理 | `AGENTS.md`、`docs/`、`references/` | 已建立 |
| bob-kernel、外壳、契约 | — | 尚未建立（BP2） |

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
| PC↔Android 同步与设备信任 | `sync_engine.rs`（530KB）、`device_trust.rs`（324KB）、`sync_protocol.rs`、`sync_diagnostics.rs` | **待定**（WP-01 先弄清模型） |
| HTTP API | `http_api.rs`（285KB） | 待评估 |
| 中继（生产实例在 VPS3） | `relay/`（权威源码）；`bob-relay.js`、`src-tauri/src/bin/bob-relay.rs` 为遗留实现 | adapt（改为可替换的 Connection Provider） |
| 远程 Agent（DSH）与 Core 客户端 | `src-tauri/src/remote_agent/`（`dsh.rs`、`live.rs`、`core.rs`） | adapt（变成 Harness runner 或契约客户端） |
| 设备凭据保护 | `src-tauri/plugins/tauri-plugin-device-vault`；`keychain.rs`（已停用） | retain vault；LLM Key 存储需整改 |
| 微信网关 | `src-tauri/src/wechat/` | 待定（开源合规） |
| 其他：Web Drop、PPTX 导出、Daily Brief、MCP、Doctor、llama sidecar | `web-drop/`、`exports/pptx.rs`、`daily_brief/`、`plugins.rs`、`doctor.rs`、`sidecar.rs` | 逐项评估 |
| 旧交换契约（UDES） | `docs/contracts/bob_cloud_agent_interchange.yaml` | retire（已被 ONL core-client-contract-v1 取代） |

## 3 旧 Online（`cloud-agent/`，pnpm monorepo，Node/TS）

| 能力 | 主要落点 | 初判 |
|---|---|---|
| 协议类型 | `packages/shared/` | 作为契约参考，进入新 schema |
| Core：State Store、Task/Execution/Artifact/Verification/Review | `packages/server/src/` | 语义移植到 bob-kernel（BOB-D-005） |
| Runtime 与 Harness 适配（DSH、AGY、Codex、pi） | `packages/server/src/runtime/`（其中多项**未跟踪**） | 过渡期作为 runner 复用（进程边界） |
| 节点原生会话 | `packages/server/src/routes/node-work.ts`、`runtime/dsh-web-session.ts` | 参考 |
| WebUI（Studio、NodeWork、Review、Dual-Diff） | `packages/ui/src/` | merge：治理视图并入统一 UI |
| 部署与发布脚本 | `deploy/`（约 120 个未跟踪文件） | 参考；不进入统一项目 |
| Lab、实验 | `packages/server/src/lab/` | 待评估（含个人主机引用） |

## 4 其他相关

| 项 | 落点 | 说明 |
|---|---|---|
| 独立 relay 目录 | `bob-relay/`（不是 Git 仓库） | 与旧 App 的 `relay/` 关系待核 |
| 搬移的 worktree | 工作区规定的外置 worktree 缓存目录下的 `cloud-agent-r06d-r05e` | 2707 项未提交改动，含 `.ssot-staging/b4*`；**禁止 prune** |
