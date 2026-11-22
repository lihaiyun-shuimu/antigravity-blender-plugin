---
name: blender-modeling
description: Blender 建模与交付教程（Antigravity 适配版，v3.1.0-alpha.1，GUI 优先，后台作业备用）——按决策树选形（分面硬表面 / 光滑硬表面 / 有机 / 重复阵列 / 布尔），走标准流水线（冻结规格 → 场景准备 → 白模 → 粗形精修 → 修改器栈 → 清理 → 装配/验收 → 交付）。覆盖参考图量测、无头多视轮廓拟合、装配扫描/修复/门禁、白模与参考包、同机位 QC、GUI 会话内 Python 与取帧、运行时 bpy 内省与后台渲染作业。
license: MIT（融合自 RobLe3/cc-blender-skill 与 arjun988/blender-skills，见 NOTICE.md）
---

# Blender 建模流程（Google Antigravity 适配版）

> **Antigravity 命名空间与增补说明**：在 Google Antigravity 插件环境中，所有 MCP 工具由插件 `antigravity-blender` 的 `antigravity-blender` server 提供（实际工具名可能带有 `mcp_antigravity-blender_antigravity-blender_` 前缀）：
> - **Eager 核心工具**：`blender_session`、`blender_op`、`blender_py`、`blender_see`
> - **懒加载工具**：`blender_run`、`blender_inspect`、`blender_api_lookup`（Blender 4.5 LTS 运行时 `bpy` / RNA / Shader 节点实时内省）、`blender_lookdev_preset`（跑车 PBR 材质与 AgX 三点棚拍预设）
> - **只读 MCP Resources**：`blender://gateway/doctor`、`blender://scene/summary`
> - **macOS 约束**：macOS 不支持 `virtual-gui`，请始终由用户打开 Blender 4.5 LTS GUI 并在 N 面板点击 Connect；长耗时渲染与批量脚本走 `blender_run(action="submit", kind="render" | "headless")`。
> - **完整上游参考手册**：见本仓库根目录 `skills/blender-modeling/SKILL.md` 与 `skills/blender-modeling/references/`。

## 核心工作纪律

1. **先查目录，不要猜 op**：`blender_op(op="catalog")` 查看 34 family / 228 op；单族查 `args={"family":"audit"}`。
2. **写 `bpy` 前先查真实 API**：在 Blender 4.5 LTS 中写定制脚本前，先调用 `blender_api_lookup` 核实算子参数、RNA 属性或 `Principled BSDF` 输入口。
3. **大改前必建 `txn` 快照**：`blender_session(action="txn", op="snapshot", label="<stage>")`，出问题立刻 `restore` 回滚。
4. **改一步看一眼**：每完成关键造型节点通过 `blender_see` 留图自检（macOS Metal 视口查看优先 `viewpoint="viewport", full=true`，材质/棚拍验收走 `blender_run(kind="render")`）。
5. **回执先读 `verdict`**：`gate` / `audit` / `asm` / `visualreport` 均为 `pass | fail | degraded` 三态，`degraded` 不算通过；导出前必过 `gate_deliver` / `asm_gate`。
