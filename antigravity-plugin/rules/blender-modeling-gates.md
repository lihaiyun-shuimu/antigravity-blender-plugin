# Blender Modeling Gates (Antigravity Blender Plugin)

1. **连接先行**：执行任何写场景操作前，先确认 GUI 会话就绪（读取 `blender://gateway/doctor` 或调用 `blender_session(action="status")` / `action="attach"`）。在 macOS 上严禁尝试 `start(kind="virtual-gui")`，必须引导用户在 Blender 4.5 LTS N 面板点击 Connect。
2. **优先契约算子，后用脚本**：优先使用 `blender_op` 的 34 family / 228 op（不确定名称先查 `blender_op(action="plan", op="catalog")`）；仅在契约算子未覆盖的定制几何/材质/节点逻辑中才使用 `blender_py`。
3. **写 `bpy` 前先查真实 API**：在 Blender 4.5 LTS 中编写涉及 `bpy.ops`、`ShaderNodeBsdfPrincipled` 或渲染引擎（如 `BLENDER_EEVEE_NEXT` / `CYCLES`）的脚本前，先核实真实属性与输入口名称，禁止凭旧版本记忆盲猜。
4. **大改前强制建 `txn` 快照**：在进入新建模阶段、执行布尔/重拓扑/曲面合并、或大批量修改材质前，必须先调用 `blender_session(action="txn", op="snapshot", label="<stage_name>")` 留存可回滚快照。
5. **视觉闭环与耗时隔离**：关键造型节点完成后必须通过 `blender_see` 回图自检；预计耗时超过 60 秒的重型渲染或批量计算必须提交给 `blender_run(action="submit", kind="render" | "headless")`，不得阻塞 GUI 通道。
6. **导出前必过审计门禁**：交付或导出资产前，必须通过拓扑/装配审计与视觉门禁（`audit_*` / `asm_*` / `gate_deliver`），`degraded` 不算 `pass`。
