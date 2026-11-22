---
name: sports-car-workflow
description: 跑车全流程 Blender 4.5 LTS 建模与 LookDev 工作流（Stage 0 参考图测量 → Stage 1 Blockout → Stage 2 参数化曲面 → Stage 3 多部件装配审计 → Stage 4 车漆与 AgX 棚拍 LookDev → Stage 5 视觉验收与 Cycles 成片渲染）。当用户要在 Blender 中制作跑车/超跑/概念车、配置汽车车漆与棚拍布光或进行多部件车辆装配体检时使用。
---

# 跑车综合建模与 LookDev 工作流（Blender 4.5 LTS · Antigravity）

> **工具命名空间**：本技能默认调用 `antigravity-blender` 插件暴露的 8 个 MCP 工具（在 Antigravity 中可能带有 `mcp_antigravity-blender_antigravity-blender_` 前缀）：`blender_session`、`blender_op`、`blender_py`、`blender_see`、`blender_run`、`blender_inspect`、`blender_api_lookup`、`blender_lookdev_preset`，以及只读资源 `blender://gateway/doctor`、`blender://scene/summary`。

## 前置检查（开始前必做）

1. 读取 `blender://gateway/doctor` 或调用 `blender_session(action="doctor")`，确认 `addon.kind == "ok"` 且 Blender 4.5 LTS 已连接。
2. 调用 `blender_session(action="attach")` 绑定会话。
3. 冻结全车单位与坐标系：`1 BU = 1 m`（`scale_length = 1.0`），车头朝 `-Y`，车顶朝 `+Z`，左右对称沿 `X = 0`（左 `-X` / 右 `+X`）。
4. 参考 [car-proportions.md](./references/car-proportions.md) 锁定轴距、轮径、车宽、车高与离地间隙，禁止凭空猜比例。

---

## Stage 0：参考图测量与规格冻结

- **主用工具**：`blender_op`（`img_digest` / `img_probe` / `img_measure` / `img_calib` / `vehicle_package`）
- **关键动作**：
  1. 若有跑车三视图（侧/前/后/顶），先用 `blender_op(op="img_calib")` 标定 `px_per_mm`；无三视图时直接选用 [car-proportions.md](./references/car-proportions.md) 中的中置超跑或 GT 跑车基准尺寸。
  2. 冻结尺寸表：全长 `L`、全宽 `W`、全高 `H`、轴距 `WB`、前/后轮外径 `D_f / D_r`、前/后轮距 `T_f / T_r`、离地间隙 `GC`、前/后悬长度。
- **过关门禁**：输出确定性毫米级规格表，创建基线快照 `blender_session(action="txn", op="snapshot", label="stage0_spec")`。

---

## Stage 1：低模 Blockout 与整车姿态

- **主用工具**：`blender_op`（`blockout_*`）+ `blender_py` + `blender_see`
- **关键动作**：
  1. 建立清晰集合结构：`Car_Body`、`Car_Cabin_Glass`、`Car_Wheels`、`Car_Details`、`AGY_Studio_Rig`。
  2. 先放四轮圆柱占位（严格按轮径/胎宽/轮距，轮胎底部贴 `Z = 0`），再搭底盘、引擎盖、座舱、车顶溜背与轮拱空间。
  3. 调用 `blender_see(viewpoint="custom", ortho=true, ...)` 依次拍侧视、前视、后视、顶视正交四视图自检整车姿态（重点看轮拱贴合度、车顶流线与离地姿态）。
- **过关门禁**：四视图轮廓与比例无失真；保存快照 `stage1_blockout`。

---

## Stage 2：车身参数化曲面（Class-A 近似）

- **主用工具**：`blender_op`（`surface_loft` / `surface_sweep` / `surface_patch` / `surface_tessellate` / `audit_mesh`）+ `blender_see`
- **关键动作**：
  1. 优先用 `blender_op(op="catalog", args={"family":"surface"})` 查参数化曲面算子，分块构建引擎盖、前/后翼子板、车门肩线、车顶溜背、侧裙与前后保险杠。
  2. 车身面板全部使用对称修改器（`Mirror`）+ 合理 `Subdivision` + 锐边控制（Crease/Support Loops）+ `Solidify` 面板壁厚，避免折纸感与三角面挤压。
  3. 跑 `blender_op(op="audit_mesh")` 检查非流形、法线翻转、自交与零面积面。
- **过关门禁**：曲率顺滑、高光流线连贯、`audit_mesh` 无致命缺陷；保存快照 `stage2_body`。

---

## Stage 3：细节与多部件装配审计

- **主用工具**：`blender_op`（`asm_scan` / `asm_repair` / `asm_gate`）+ `blender_api_lookup` + `blender_py`
- **关键动作**：
  1. 细化四轮组件（轮毂辐条、刹车盘、卡钳、轮胎胎纹）、前后灯组（灯罩+内胆+日行灯条）、风挡与侧窗玻璃、后视镜、尾翼、扩散器、进气格栅与排气管。
  2. 写任何定制 `bpy` 代码前，先用 `blender_api_lookup` 核实 Blender 4.5 LTS 的算子参数与属性名。
  3. 运行 `blender_op(op="asm_scan")` 检查全车穿模（clash）与浮空件（float），必要时用 `asm_repair(policy="safe")` 吸附修整。
- **过关门禁**：**零穿模、零浮空件、接缝间隙均匀可控**，`asm_gate` 返回 `pass`；保存快照 `stage3_assembly`。

---

## Stage 4：车漆与 AgX 棚拍 LookDev

- **主用工具**：`blender_lookdev_preset` + `blender_api_lookup` + `blender_see`
- **关键动作**：
  1. 参考 [lookdev-recipes.md](./references/lookdev-recipes.md)，使用 `blender_lookdev_preset` 批量赋予材质：
     - 车身主漆：`car_paint_clearcoat`（可选 `rosso_corsa` / `midnight_blue` / `liquid_silver` / `emerald_green`）
     - 风挡与侧窗：`automotive_glass`
     - 轮毂与金属件：`brushed_alloy`
     - 扩散器/尾翼/前唇：`carbon_fiber`
     - 轮胎：`tire_rubber`
  2. 调用 `blender_lookdev_preset(preset="studio_three_point_agx")` 部署 AgX 色彩管理、三点柔光箱、暗色棚拍地面与 65mm 3/4 英雄机位相机。
  3. 调用 `blender_see(viewpoint="camera")` 检查车漆高光流线、反射过渡与暗部层次。
- **过关门禁**：清漆反射流畅、玻璃通透、无死黑或法线破面；保存快照 `stage4_lookdev`。

---

## Stage 5：视觉验收与成片渲染

- **主用工具**：`blender_op`（`visualreport_report` / `gate_deliver`）+ `blender_run`
- **关键动作**：
  1. 跑交付前门禁 `gate_deliver` / `visualreport_report`，确认 `verdict == "pass"`（`degraded` 不算通过）。
  2. 高采样 Cycles（macOS Metal GPU）静态成片或 360° 转盘动画统一提交异步队列：
     `blender_run(action="submit", kind="render", engine="CYCLES", samples=128, resolution=[1920, 1080], camera="AGY_Studio_Camera", ...)`，再用 `wait` / `collect` 回收成片。
- **过关门禁**：交付门禁 `pass`，输出高分辨率成片与 `.blend` 交付包。
