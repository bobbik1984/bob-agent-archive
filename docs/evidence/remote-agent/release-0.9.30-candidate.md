# 0.9.30 双端候选交付

## 冻结来源与授权

用户明确授权推送 GitHub 并通过 Actions 生成同版本 Windows / Android 安装包。未授权替换官网稳定下载别名，本轮不进行该操作。

- 源码：`971a7ce34d30e124fc33d7c858300fd77ca1c139`，`main`（在 `1d5af0e76f88e7473a5073f14f23fde19e711259` 基础上合入 Work 远程节点扫码配对与两阶段确认）。
- 主应用与安装器版本：`0.9.30`；Android versionCode：`9030`。
- 推送前前端回归：17 files / 112 passed，exit 0。
- 版本契约与 Git 空白检查通过；系统保护本地验证见 [RH-02](RH-02-system-unlock.md)。
- Windows Actions：[40194900621](https://github.com/bobbik1984/bob-agent/actions/runs/40194900621)。
- Android Actions：[40194900708](https://github.com/bobbik1984/bob-agent/actions/runs/40194900708)。
- GitHub 候选预发布：[v0.9.30-rc.971a7ce](https://github.com/bobbik1984/bob-agent/releases/tag/v0.9.30-rc.971a7ce)。
- Windows 与 Android 构建均为 completed / success；Android Sign APK 与 Upload APK Artifact 均 success，不代表真机验收。

## 产物核验

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| bob-v0.9.30-installer.exe | 44459008 | `9639dc94341dff7961c10c10a467d4f4a9e865d29faecb9fe3aaaccd35085cae` |
| bob-v0.9.30-portable.zip | 34222661 | `1976eff35f80a8054f1022032379d1e7e44fb8a322f9a91c9c839e9fe57ccc57` |
| bob-v0.9.30-signed.apk | 94454114 | `f4ca8419ce042c062bc7f438fc75331921ab0617bf797ce3a42dd81edd5d1835` |

本地目录：`dist-release/candidate-v0.9.30-971a7ce34d30/`（并已同步至 `dist-release/` 与官网下载中心）。

## 手机系统解锁手工验证

前置：Android 11 或更新系统，已设置系统锁屏 PIN / 图案 / 密码。覆盖安装同签名候选 APK，不卸载、不清除应用数据。无需向任何人提供 PIN、指纹、人脸或 DSH Token。

1. 打开 Bob，确认首屏正常、原项目与工作记录仍可查看。
2. 进入 **设置 → 连接 → 远程执行端 → 使用系统解锁**。应出现系统认证界面，不应要求创建 Bob 密码。
3. 第一次取消认证：应仍为锁定状态，已有连接不得丢失；再次点击应可重新认证。
4. 选择系统 PIN / 图案 / 密码并成功认证：应解锁连接管理界面。支持强生物识别的手机可另外验证指纹或人脸；弱人脸不可用时选择系统锁屏凭据，不属于要求新增 Bob 密码。
5. 首次使用时填写连接名称与 DSH 地址 / Token，保存并连接；进入 **工作** 选择远程会话，发送一条无副作用的测试消息，检查实时回复。保存过的连接应可选择重连，不必再次粘贴 Token（远端认证过期除外）。
6. 手动锁定连接库，再次系统解锁；然后完全退出 Bob 并重开，重复解锁。连接名称、地址和最近会话应保留，不应重复发送上一次指令。
7. 开启连接的自动重连后短暂断网再恢复，检查可恢复网络错误的重连；如果远端 Cookie 已过期，应提示更新认证，不应无限重试或声称连接成功。

系统解锁只解封本机保存的连接凭据，不等于 DSH 已连接；两个步骤分别记录。Windows 使用当前 Windows 登录账户 DPAPI 保护，不要求额外 Bob 密码，也不保证每次弹 Windows Hello。旧未发布试验版密码库才需要一次旧密码迁移，普通 0.9.29 用户不应出现这个步骤。

禁止在日常手机上通过移除系统锁屏、卸载 Bob 或清除数据测试密钥失效；这些负向测试仅适用于专用测试数据。

## 验收边界

Android 系统认证、真机连接及恢复流程尚未手工验收。CI 成功只证明构建与签名步骤通过，不能据此标记上述手工测试 PASS。
