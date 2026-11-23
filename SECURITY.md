# Security Policy (`antigravity-blender-plugin`)

本安全策略适用于 [`lihaiyun-shuimu/antigravity-blender-plugin`](https://github.com/lihaiyun-shuimu/antigravity-blender-plugin) 的最新 `main` 分支及最新发布的插件版本。

---

## 报告安全漏洞

请**不要**在公开 Issue 中披露安全漏洞细节。请通过 GitHub 私密安全通道提交报告：

1. 访问：<https://github.com/lihaiyun-shuimu/antigravity-blender-plugin/security/advisories/new>
   （仓库页面 → **Security** → **Advisories** → **Report a vulnerability**）。
2. 如无法使用上述通道，可提交一条**仅包含以下一句话**的 Issue（切勿附带漏洞详情）：
   > "I would like to report a security issue; please provide a private contact."

报告时请尽量包含受影响版本、操作系统与 Blender 版本、复现步骤及影响范围。我们会尽快评估并在修复后致谢报告者（如你希望匿名请注明）。

---

## 执行面与信任边界说明

本插件按设计用于驱动本机 Blender 并执行自动化脚本，属于**可执行代码型插件**，使用前请知晓以下本地边界：

| 边界面 | 说明 |
| :--- | :--- |
| **Blender 侧 Python 执行** | `blender_py`、`blender_api_lookup`、`blender_lookdev_preset`、`blender_see`（macOS Metal 安全捕获）及 `blender_run(kind="headless")` 会在本机 Blender 的 `bpy` 环境中执行 Python 代码。 |
| **本地进程管理** | `antigravity-plugin/mcp-server/` 通过 Stdio 与 Google Antigravity 通信，并按需自动拉起本机上游 Gateway 进程（`node lib/runtime/gateway.js`）或后台 `blender -b` 作业，退出时仅清理自己拉起的子进程。 |
| **本地网络监听** | Gateway 仅监听本机回环地址 `127.0.0.1:39877`（不对外网开放）；Blender 扩展通过反向 WebSocket（`ws://127.0.0.1:39877/addon`）主动连接 Gateway，Blender 侧无入站监听端口。 |
| **本地文件 I/O** | 运行日志、渲染输出与事务快照默认写入 `~/.dsh-blender-rt` 及系统临时目录（`mac-capture.ts` 产生的临时 PNG 在读取后 `finally` 内立即删除）。 |
| **凭据与遥测** | 本插件不收集任何遥测数据，也不读取或外传 Antigravity / 系统凭据；Blender 扩展中的第三方资产开关凭据仅保存在本机 Blender 偏好设置中。 |

---

## 上游安全问题

若漏洞位于上游 `runtime/`、`src/` 或 `extension/dsh_blender_bridge.zip`，我们会在本仓库采取缓解措施的同时协助同步或上报给上游 [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin)。
