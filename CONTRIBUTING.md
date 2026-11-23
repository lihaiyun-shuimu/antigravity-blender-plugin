# Contributing to Antigravity Blender Plugin (`antigravity-blender-plugin`)

欢迎为 **Antigravity Blender Plugin** 提交 Issue 与 Pull Request（支持中文或英文）！
本项目由 [`lihaiyun-shuimu`](https://github.com/lihaiyun-shuimu) 维护，Fork 自 [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin)，旨在以**零侵入上游主干**的方式为 Google Antigravity 提供原生 Blender MCP 插件接口。

---

## 贡献边界（零侵入原则）

1. **Antigravity 插件适配与增强（本仓库主攻方向）**：
   - 所有新增代码、MCP 工具、Resources、Skills、Rules 与文档均应放在 [`antigravity-plugin/`](./antigravity-plugin/) 目录下；
   - 包含：Stdio MCP Server（`antigravity-plugin/mcp-server/`）、`blender_api_lookup`、`blender_lookdev_preset`、`mac-capture.ts`、建模/跑车 Skills 与门禁 Rules。
2. **上游核心引擎与 Blender 扩展**：
   - 根目录的 `src/`、`runtime/`、`extension/` 为上游内核，原则上保持零改动，以便通过 `git fetch upstream` 持续同步上游 34 family / 228 op 更新；
   - 若发现上游 228 op 或 Gateway 通用 Bug，建议优先向上游 [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin) 提交修复。

---

## 本地开发环境搭建

### 环境要求
- **Node.js ≥ 24.9**
- **Blender ≥ 4.2**（当前已实测基线：**macOS + Blender 4.5.16 LTS**；欢迎在 Windows / Linux 或其他 4.2+ 版本实测反馈）
- **Google Antigravity**（桌面端 App / IDE / CLI）

### 构建步骤
```bash
git clone https://github.com/lihaiyun-shuimu/antigravity-blender-plugin.git
cd antigravity-blender-plugin

# 1. 编译上游 Gateway 运行时（生成 lib/runtime/）
npm ci --legacy-peer-deps
npm run build

# 2. 编译 Antigravity 原生 MCP Server
cd antigravity-plugin/mcp-server
npm install
npm run build
cd ../..

# 3. 挂载到本机 Antigravity 插件目录
ln -sfn "$(pwd)/antigravity-plugin" ~/.gemini/config/plugins/antigravity-blender
```

### 验证清单
- `cd antigravity-plugin/mcp-server && npm run typecheck && npm run build` 零报错；
- Blender 安装 [`extension/dsh_blender_bridge.zip`](./extension/dsh_blender_bridge.zip) 并在 N 面板点击 **Connect**；
- `curl -sS http://127.0.0.1:39877/doctor` 返回 `addon.kind == "ok"`；
- MCP Server 所有日志仅输出至 `stderr`，绝不污染 `stdout`；
- 在 Antigravity 中完成一次 `blender_see` 回图与 `blender_session(action="txn")` 快照/回滚实测。

---

## 提交 Issue 与 PR 规范

- **Bug 报告**：请附上操作系统、Blender 版本、Node.js 版本、复现步骤，以及 `blender_session(action="doctor")` 的输出。
- **Commit 风格**：使用 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`），不提交 `node_modules/`、`dist/`、`lib/` 或临时日志。
- **开源许可隔离**：新增代码须独立编写或仅引入与 BSD-3-Clause / MIT 兼容的依赖，**禁止向 `antigravity-plugin/mcp-server/` 复制外部 GPL-3.0 源码**。
- **安全问题**：请勿在公开 Issue 中披露漏洞，请按 [SECURITY.md](./SECURITY.md) 的私密渠道报告。

---

## 开源许可

本仓库主干及 Antigravity 适配层遵循 [BSD-3-Clause](./LICENSE) 许可，各模块许可边界与归属声明详见 [antigravity-plugin/NOTICE.md](./antigravity-plugin/NOTICE.md)。提交 PR 即表示你同意所贡献的代码按对应模块的开源许可发布。
