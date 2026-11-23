# Antigravity Blender Plugin (`antigravity-blender-plugin`)

[![Google Antigravity](https://img.shields.io/badge/Google-Antigravity%20Plugin-4285F4?logo=google&logoColor=white)](https://antigravity.google/docs/plugins/)
[![Blender](https://img.shields.io/badge/Blender-%E2%89%A54.2%20(Tested%204.5%20LTS)-F5792A?logo=blender&logoColor=white)](https://www.blender.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.9-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-BSD--3--Clause%20%2F%20GPL--3.0%20%2F%20MIT-blue)](./antigravity-plugin/NOTICE.md)

> **Google Antigravity × Blender 原生 MCP 接口插件**
> 本仓库 Fork 自 [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin)，以**零侵入上游主干**的方式在独立目录 [`antigravity-plugin/`](./antigravity-plugin/) 中完整构建 Google Antigravity 原生插件接口（Stdio MCP Server + Tools + Resources + Skills + Rules）。
>
> **兼容性说明**：依托上游扩展（`blender_version_min = 4.2.0`）与 Node.js 运行时，本插件支持 **Blender 4.2+** 及 **macOS / Windows / Linux**；当前 Antigravity 适配层与全链路验收**仅在 macOS + Blender 4.5 LTS（Metal）环境中实测通过**，其他平台与 Blender 4.2+ 版本欢迎实测反馈。

---

## 核心特性

- **零侵入上游主干**：完整保留上游 `src/`、`runtime/` 与 `extension/`，日后可直接 `git fetch upstream` 同步上游 34 family / 228 op 契约层更新。
- **8 个 Antigravity MCP 工具 + 2 个只读 MCP Resources**：
  - **6 个上游核心工具透传**：`blender_session`、`blender_op`、`blender_py`、`blender_see`、`blender_run`、`blender_inspect`（高频 4 工具在 `mcp_config.json` 中默认开启 `eager: true`，超时上限 `timeoutSeconds: 600`）。
  - **2 个 Antigravity 专属增强工具**：
    - `blender_api_lookup`：面向运行中的 Blender 实例实时内省 `bpy.ops`、`bpy.types` 与 Shader 节点（如 `Principled BSDF` 全部真实输入口），从根源消除跨版本 API 幻觉。
    - `blender_lookdev_preset`：一键生成/应用跑车双层清漆车漆（`car_paint_clearcoat`）、汽车玻璃（`automotive_glass`）、拉丝合金（`brushed_alloy`）、碳纤维（`carbon_fiber`）、轮胎橡胶（`tire_rubber`）与 AgX 三点柔光棚拍（`studio_three_point_agx`）。
  - **2 个只读 MCP Resources**：`blender://gateway/doctor`（健康/连接诊断）与 `blender://scene/summary`（当前场景物体/集合/相机/材质概览）。
- **标准 MCP 媒体协议**：`blender_see` / `blender_py(see=true)` / `blender_op` 产物图全部转换为标准 MCP `ImageContent`（Base64 + MIME），Gateway 与 MCP 日志严格走 `stderr`，绝不污染 `stdout`。
- **随包内置专业 Skills 与门禁 Rules**：
  - `skills/blender-modeling/`（对齐 Antigravity 命名空间的通用 3D 建模与装配验收技能）
  - `skills/sports-car-workflow/`（Stage 0 参考测量 → Stage 1 Blockout → Stage 2 参数化曲面 → Stage 3 多部件装配审计 → Stage 4 车漆与 AgX 棚拍 LookDev → Stage 5 视觉验收与 Cycles 成片渲染）
  - `rules/blender-modeling-gates.md`（优先契约算子、写前建 `txn` 快照、导出前过审计门禁）

---

## 架构总览

```text
Google Antigravity (Desktop App / IDE / CLI)
  ├─ Plugin: antigravity-blender (antigravity-plugin/)
  │    ├─ Skills: blender-modeling, sports-car-workflow
  │    ├─ Rules:  rules/blender-modeling-gates.md
  │    └─ MCP Server: antigravity-blender (stdio, Node.js ≥ 24.9, timeoutSeconds: 600)
  │          ├─ GatewayManager (自动检测/拉起上游 lib/runtime/gateway.js 127.0.0.1:39877)
  │          ├─ 6 个上游核心工具 + 2 个增强工具 (api_lookup / lookdev_preset)
  │          └─ 2 个只读 Resources (blender://gateway/doctor, blender://scene/summary)
  │
  ▼  HTTP: http://127.0.0.1:39877 (/health, /status, /doctor, /lease, /act, /plan, /view, /txn, /job...)
[上游内核: lib/runtime/ (由 runtime/ 编译，零改动复用)]
  ▲  WebSocket: ws://127.0.0.1:39877/addon (反向连接，Blender 侧无入站端口)
  │
[Blender 扩展: extension/dsh_blender_bridge.zip (Blender ≥ 4.2)]
```

---

## 快速开始

### 1. 环境准备
- **Google Antigravity**（桌面端 App / IDE / CLI）
- **Blender ≥ 4.2**（已实测环境：**macOS + Blender 4.5.16 LTS**；Windows / Linux 理论兼容）
- **Node.js ≥ 24.9**
- 请在 Blender 中**停用旧版** `mcp-for-blender` / `blender_mcp`（9876 端口），仅保留本仓自带扩展。

### 2. 克隆仓库并编译
```bash
git clone https://github.com/lihaiyun-shuimu/antigravity-blender-plugin.git
cd antigravity-blender-plugin

# 1) 仓库根目录：编译上游 Gateway 与 228 op 运行时（生成 lib/runtime/）
npm ci --legacy-peer-deps
npm run build

# 2) 编译 Antigravity 原生 MCP 适配层
cd antigravity-plugin/mcp-server
npm install
npm run build
cd ../..
```

### 3. 在 Blender 中安装并连接扩展
1. 打开 Blender，进入 `Edit > Preferences > Extensions > Install from Disk...`；
2. 选择本仓库下的 [`extension/dsh_blender_bridge.zip`](./extension/dsh_blender_bridge.zip) 完成安装并勾选启用；
3. 在 3D 视口按 `N` 打开侧边栏，切换到 **DSH Blender Bridge** 面板，点击 **Connect**。

### 4. 在 Google Antigravity 中加载插件
在**仓库根目录**将 `antigravity-plugin/` 软链至 Antigravity 全局插件目录（修改代码编译后立即生效）：
```bash
ln -sfn "$(pwd)/antigravity-plugin" ~/.gemini/config/plugins/antigravity-blender
```
在 Antigravity 桌面端 Customizations / Plugins 页面即可看到并管理 **Antigravity Blender** 插件；若安装了 `agy` CLI，也可执行：
```bash
agy plugin validate --strict ./antigravity-plugin
```

### 5. 验证联通
在 Antigravity 新对话中直接发送：
> 「检查 Blender 连接状态，并帮我抓一张当前视口截图。」

当返回 `addon.kind: "ok"` 且成功回传清晰视口图，即表示全部配置就绪。

---

## 接口清单（`antigravity-blender`）

| 工具 / 资源 | 加载策略 | 说明 |
| :--- | :--- | :--- |
| `blender_session` | `eager: true` | 会话附着/归属/写权限 `scope`、`/doctor` 体检、`action="txn"` 快照与回滚 |
| `blender_op` | `eager: true` | 34 family / 228 op 契约层（`plan` / `loop` / `opt` / `preset`） |
| `blender_see` | `eager: true` | 视口/相机/自定义视角单帧与序列帧捕获，返回 MCP `ImageContent` |
| `blender_py` | `eager: true` | GUI 持久 Python 内核执行（支持 `see=true` 顺带抓帧） |
| `blender_run` | 懒加载 | 异步 `blender -b` 无头脚本与 Cycles/EEVEE 最终渲染队列 |
| `blender_inspect` | 懒加载 | Blender 扩展只读诊断命令目录与执行 |
| `blender_api_lookup` | 懒加载 | 运行时内省当前 Blender 实例的 `bpy.ops` / `bpy.types` / Shader 节点签名 |
| `blender_lookdev_preset` | 懒加载 | 跑车 PBR 材质（双层清漆车漆/玻璃/拉丝金属/碳纤维/轮胎）与 AgX 三点棚拍预设 |
| `blender://gateway/doctor` | Resource | 只读返回 Gateway 与 Blender 联通诊断 JSON |
| `blender://scene/summary` | Resource | 只读返回当前场景物体、集合、相机与材质摘要 |

---

## 平台与实测注意事项

1. **已实测基线**：本插件的 Antigravity 适配层与全链路验收目前仅在 **macOS + Blender 4.5.16 LTS（Metal）** 下完成；Windows / Linux 及其他 Blender 4.2+ 版本依赖上游通用架构运行，欢迎反馈兼容性问题。
2. **macOS 运行模式**：`virtual-gui` 仅支持 Windows / Linux，macOS 固定采用「手动打开 Blender GUI 点击 Connect + `blender_run(kind="headless" | "render")` 后台异步作业」双轨模式。
3. **macOS Metal 视口抓帧修复（已内置）**：在 Blender 4.5 LTS + macOS Metal 下，上游 `GPUOffScreen` 离屏绘制存在条纹花屏问题；本插件已在 `antigravity-plugin/mcp-server/src/mac-capture.ts` 内置 macOS Metal 安全捕获通道（改走原生 `bpy.ops.render.opengl(write_still=True)` 并在 `finally` 中完整恢复场景状态），`blender_see` 的 `viewport` / `custom` / `camera` 与 `blender_py(see=true)` 均已实测 <100ms 高清无花屏。

---

## 目录结构

```text
antigravity-blender-plugin/
├── antigravity-plugin/              # [新增] Google Antigravity 原生插件独立目录
│   ├── plugin.json                  # Antigravity 插件清单
│   ├── mcp_config.json              # Stdio MCP 配置 (timeoutSeconds: 600, eager: true)
│   ├── README.md                    # 插件安装与排错文档
│   ├── NOTICE.md                    # 开源许可与上游归属声明
│   ├── mcp-server/                  # TypeScript Stdio MCP Server
│   ├── rules/                       # blender-modeling-gates.md
│   └── skills/                      # blender-modeling + sports-car-workflow
├── runtime/                         # [上游] Gateway & 228 op 内核（零改动）
├── src/                             # [上游] 原 DSH 适配层（零改动）
├── extension/                       # [上游] Blender 扩展 dsh_blender_bridge.zip（零改动）
└── lib/                             # [构建产物] npm run build 生成，不提交至 git
```

---

## 开源许可与致谢

本项目严格遵循并保留所有上游模块许可声明，详见 [`antigravity-plugin/NOTICE.md`](./antigravity-plugin/NOTICE.md) 与 [`LICENSE`](./LICENSE)：
- **上游核心运行时与 Gateway**：[`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin)（BSD-3-Clause）
- **Blender 桥接扩展**：`extension/dsh_blender_bridge.zip`（GPL-3.0-or-later，派生自 `ahujasid/blender-mcp` MIT）
- **通用建模技能**：`skills/blender-modeling/`（MIT，融合自 `RobLe3/cc-blender-skill` 与 `arjun988/blender-skills`）
- **Antigravity 适配层与增强工具**：独立编写实现，未复制任何外部 GPL-3.0 源码。
