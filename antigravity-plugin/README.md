# Antigravity Blender — Google Antigravity 原生插件

> **Google Antigravity × Blender 4.5 LTS 原生 MCP 接口插件**（Fork 自 [`sixtysevenlf/dsh-blender-plugin`](https://github.com/sixtysevenlf/dsh-blender-plugin)，零侵入上游 `src/`、`runtime/` 与 `lib/`）。

## 环境要求（macOS 基线）

- **Google Antigravity**（桌面端 App / IDE / CLI）
- **macOS** + **Blender 4.5 LTS**（默认路径 `/Applications/Blender.app/Contents/MacOS/Blender`）
- **Node.js ≥ 24.9**
- 已在 Blender 中**停用**旧版 `mcp-for-blender` / `blender_mcp`（9876 端口），仅启用本仓自带的 `DSH Blender Bridge`（`extension/dsh_blender_bridge.zip`）

## 快速安装与启用

1. **编译上游内核**（仓库根目录，生成 `lib/runtime/gateway.js`）：
   ```bash
   npm ci --legacy-peer-deps
   npm run build
   ```
2. **编译 Antigravity MCP 适配层**：
   ```bash
   cd antigravity-plugin/mcp-server
   npm install
   npm run build
   ```
3. **在 Blender 4.5 LTS 安装扩展**：
   - 打开 `Edit > Preferences > Extensions > Install from Disk...`
   - 选择仓库下的 `extension/dsh_blender_bridge.zip`
   - 在 3D 视口按 `N` 打开侧边栏，切换到 **DSH Blender Bridge** 面板点击 **Connect**（反向连接至 `ws://127.0.0.1:39877/addon`）。
4. **挂载到 Google Antigravity 插件目录**：
   ```bash
   ln -sfn "$(pwd)/antigravity-plugin" ~/.gemini/config/plugins/antigravity-blender
   ```
   （如已安装 `agy` CLI，也可运行 `agy plugin validate --strict ./antigravity-plugin` 校验。）

## Antigravity 接口面（8 Tools + 2 Resources）

MCP Server 名称：`antigravity-blender`（`timeoutSeconds: 600`）

| 名称 | 类型 | 加载策略 | 职责说明 |
| :--- | :--- | :--- | :--- |
| `blender_session` | 上游透传 | `eager: true` | 会话附着/状态/`doctor`/写权限 scope/`txn` 快照与回滚 |
| `blender_op` | 上游透传 | `eager: true` | 34 family / 228 op 契约层（参考图测量、参数化曲面、装配审计修复、`loop`、`opt`、`preset`） |
| `blender_see` | 上游透传 | `eager: true` | 多机位截帧（`viewport` / `camera` / `custom` + `frame` / `sequence`），返回标准 MCP `ImageContent` |
| `blender_py` | 上游透传 | `eager: true` | GUI 持久 Python 内核执行（支持 `see=true` 顺带回帧） |
| `blender_run` | 上游透传 | 懒加载 | 独立 `blender -b` 无头脚本与高采样 Cycles/EEVEE 渲染异步队列 |
| `blender_inspect` | 上游透传 | 懒加载 | 只读诊断命令目录与执行 |
| `blender_api_lookup` | **Antigravity 新增** | 懒加载 | Blender 4.5 LTS 运行时 `bpy.ops` / `bpy.types` / Shader 节点（如 `Principled BSDF`）实时内省 |
| `blender_lookdev_preset` | **Antigravity 新增** | 懒加载 | 跑车双层清漆车漆/玻璃/拉丝金属/碳纤维/轮胎与 AgX 三点柔光棚拍一键预设 |
| `blender://gateway/doctor` | **MCP Resource** | 只读 | Gateway 存活状态、已连接 Blender 实例与协议版本诊断 |
| `blender://scene/summary` | **MCP Resource** | 只读 | 当前场景物体、集合、相机与材质概览 |

## 常见排错

- **Gateway 自动拉起**：MCP Server 启动时自动检测并复用 `127.0.0.1:39877`，未启动时自动拉起上游 `lib/runtime/gateway.js`；所有日志强制写入 `stderr` 或临时日志，绝不污染 MCP `stdout`。
- **macOS 无 `virtual-gui`**：macOS 请始终手动打开 Blender 4.5 LTS GUI 并点击 N 面板 Connect；长耗时渲染或批量脚本使用 `blender_run(action="submit", kind="render" | "headless")`。
- **Blender 4.5 LTS（macOS Metal）离屏抓帧说明**：实测在 macOS Metal + Blender 4.5.16 LTS 下，上游 `/view` 的 `GPUOffScreen` 离屏抓帧在 `MATERIAL`/`RENDERED` 模式下可能出现条纹花屏；日常视口查看请用 `blender_see(viewpoint="viewport", full=true)`，车漆/棚拍 LookDev 验收请用 `blender_run(kind="render", engine="BLENDER_EEVEE_NEXT" | "CYCLES")` 真实渲染出图。
