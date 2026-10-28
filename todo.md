# todo — 需求池

> 尚未进入施工合同的需求、风险与待判断事项。进入施工的工作写在 `docs/CURRENT_STAGE.md`，不在这里重复步骤。

## 待用户裁决

- [ ] BOB-D-006 连接分层方案，以及个人环境用哪种中继
- [ ] BOB-D-007 文档权威位置；是否在 Drive 放只读镜像
- [ ] WP-04 提供 GitHub 远端仓库地址（例如 `https://github.com/bobbik1984/<repo>.git`），用于推送统一项目

## 前身项目需要修正（只记录，不在本仓库动手；需要时到对应项目执行）

- [ ] 旧 Online 统一提案 §2 中“worktree 注册项可 prune”的表述应改为“禁止 prune，其中有 2707 项未提交改动”
- [ ] 旧 Online ONL-D-005 仍写 VPS3 为 Core，实际生产在 Hostinger，决策已过期
- [ ] 旧 Online CURRENT_STAGE 记录的 App 基线 `2598428` 已过期（实际 `a4ff5fd`）
- [ ] 旧 App `docs/contracts/bob_cloud_agent_interchange.yaml` 应标为 superseded
- [ ] 旧仓库都在 OneDrive 上，Git 对象全是 loose object，旧 App 还有中断的 tmp pack：在 WP-00 完成后再评估 `git gc` 或搬离 OneDrive

## 开源前提（BP6，日常开发中就要避免返工）

- [ ] 选定许可证并补齐 LICENSE；审计依赖许可证
- [ ] 去个人化：域名、IP、节点名全部改为配置
- [ ] 包名与商标：旧 Online 的 `antigravity-nexus` 不能沿用
- [ ] LLM Key 改用系统安全存储（旧 App 中疑似明文）
- [ ] 复用并修订旧 App 的 `OPEN_SOURCE_WORKFLOW.md`（双仓库、无历史快照式发布）
- [ ] Git 历史 secrets 扫描结论
- [ ] 微信网关等模块的开源合规评估

## 产品缺口（统一审查 G14）

- [ ] 没有服务器时手机如何收到推送和提醒（Android 后台限制）
- [ ] BYOK 费用可见性与预算上限
- [ ] 两套 UI 的 i18n 键对齐
- [ ] 旧 App 0.9.x 已安装用户的数据迁移（`bob.db`）
- [ ] 遥测和崩溃上报的隐私策略
- [ ] AGY / Codex 订阅在开源场景下的使用许可
- [ ] 在工作区 `project_registry.yaml` 中登记统一项目，并归并 `bob_mobile`、`bob_notebook` 等 idea 条目（WP-04）
- [ ] UI 收敛方式（审查 AD-4）：直接演进旧 App UI，还是另起共享 UI 包
