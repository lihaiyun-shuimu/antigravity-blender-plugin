import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { text, type GatewayClient } from '../gateway-client.js'
import { errorResult, textResult, type McpToolResult } from '../media.js'

const NODE_ALIASES: Record<string, string> = {
  'principled bsdf': 'ShaderNodeBsdfPrincipled',
  'principled': 'ShaderNodeBsdfPrincipled',
  'material output': 'ShaderNodeOutputMaterial',
  'mix': 'ShaderNodeMix',
  'mix shader': 'ShaderNodeMixShader',
  'noise texture': 'ShaderNodeTexNoise',
  'voronoi texture': 'ShaderNodeTexVoronoi',
  'bump': 'ShaderNodeBump',
  'color ramp': 'ShaderNodeValToRGB',
  'mapping': 'ShaderNodeMapping',
  'texture coordinate': 'ShaderNodeTexCoord',
  'fresnel': 'ShaderNodeFresnel',
  'layer weight': 'ShaderNodeLayerWeight',
  'glossy bsdf': 'ShaderNodeBsdfGlossy',
  'glass bsdf': 'ShaderNodeBsdfGlass',
  'transparent bsdf': 'ShaderNodeBsdfTransparent',
  'environment texture': 'ShaderNodeTexEnvironment',
  'background': 'ShaderNodeBackground',
  'world output': 'ShaderNodeOutputWorld',
}

function buildIntrospectionPython(
  query: string,
  kind: 'auto' | 'op' | 'type' | 'node',
  filter: string,
  limit: number,
): string {
  const normalized = query.trim()
  const aliasTarget = NODE_ALIASES[normalized.toLowerCase()] ?? normalized

  return [
    'import bpy, json',
    `QUERY = ${JSON.stringify(normalized)}`,
    `ALIAS = ${JSON.stringify(aliasTarget)}`,
    `KIND = ${JSON.stringify(kind)}`,
    `FILTER = ${JSON.stringify(filter.trim().toLowerCase())}`,
    `LIMIT = ${Math.max(1, Math.min(200, limit))}`,
    '',
    'def _safe_default(val):',
    '    if val is None or isinstance(val, (bool, int, float, str)):',
    '        return val',
    '    try:',
    '        return [round(float(x), 6) if isinstance(x, float) else x for x in val]',
    '    except Exception:',
    '        return str(val)',
    '',
    'def _serialize_prop(prop):',
    '    info = {',
    '        "identifier": prop.identifier,',
    '        "name": prop.name,',
    '        "type": prop.type,',
    '        "description": (prop.description or "")[:180],',
    '    }',
    '    if hasattr(prop, "default"):',
    '        try:',
    '            info["default"] = _safe_default(prop.default)',
    '        except Exception:',
    '            pass',
    '    if hasattr(prop, "default_array") and getattr(prop, "array_length", 0) > 0:',
    '        try:',
    '            info["default"] = _safe_default(prop.default_array)',
    '            info["array_length"] = prop.array_length',
    '        except Exception:',
    '            pass',
    '    if prop.type == "ENUM":',
    '        try:',
    '            info["enum_items"] = [item.identifier for item in prop.enum_items][:40]',
    '        except Exception:',
    '            pass',
    '    if prop.type in ("INT", "FLOAT"):',
    '        for k in ("soft_min", "soft_max", "hard_min", "hard_max"):',
    '            if hasattr(prop, k):',
    '                try:',
    '                    info[k] = getattr(prop, k)',
    '                except Exception:',
    '                    pass',
    '    return info',
    '',
    'def _match(text_val):',
    '    return (not FILTER) or (FILTER in (text_val or "").lower())',
    '',
    'def _inspect_node(type_name):',
    '    nt = bpy.data.node_groups.new("_agy_introspect_tmp", "ShaderNodeTree")',
    '    try:',
    '        node = nt.nodes.new(type_name)',
    '        inputs = []',
    '        for idx, sock in enumerate(node.inputs):',
    '            if not (_match(sock.name) or _match(sock.identifier)):',
    '                continue',
    '            item = {',
    '                "index": idx,',
    '                "name": sock.name,',
    '                "identifier": sock.identifier,',
    '                "type": sock.type,',
    '            }',
    '            if hasattr(sock, "default_value"):',
    '                item["default_value"] = _safe_default(sock.default_value)',
    '            inputs.append(item)',
    '        outputs = [{"index": i, "name": s.name, "identifier": s.identifier, "type": s.type} for i, s in enumerate(node.outputs)]',
    '        props = [_serialize_prop(p) for p in node.bl_rna.properties if p.identifier != "rna_type" and _match(p.identifier + " " + p.name)][:LIMIT]',
    '        return {',
    '            "ok": True,',
    '            "kind": "node",',
    '            "blender_version": bpy.app.version_string,',
    '            "node_type": type_name,',
    '            "bl_label": getattr(node, "bl_label", type_name),',
    '            "input_count": len(node.inputs),',
    '            "inputs": inputs[:LIMIT],',
    '            "outputs": outputs,',
    '            "properties": props,',
    '        }',
    '    finally:',
    '        bpy.data.node_groups.remove(nt)',
    '',
    'def _inspect_op(op_path):',
    '    clean = op_path[8:] if op_path.startswith("bpy.ops.") else op_path',
    '    if "." not in clean:',
    '        mod = getattr(bpy.ops, clean, None)',
    '        if mod is None:',
    '            return {"ok": False, "error": f"Unknown bpy.ops module: {clean}"}',
    '        ops = [name for name in dir(mod) if not name.startswith("_") and _match(name)][:LIMIT]',
    '        return {"ok": True, "kind": "op_module", "blender_version": bpy.app.version_string, "module": clean, "operators": ops}',
    '    mod_name, op_name = clean.split(".", 1)',
    '    mod = getattr(bpy.ops, mod_name, None)',
    '    op = getattr(mod, op_name, None) if mod is not None else None',
    '    if op is None:',
    '        return {"ok": False, "error": f"Unknown operator: bpy.ops.{clean}"}',
    '    rna = op.get_rna_type()',
    '    props = [_serialize_prop(p) for p in rna.properties if p.identifier != "rna_type" and _match(p.identifier + " " + p.name)][:LIMIT]',
    '    return {',
    '        "ok": True,',
    '        "kind": "op",',
    '        "blender_version": bpy.app.version_string,',
    '        "operator": f"bpy.ops.{clean}",',
    '        "description": (rna.description or "")[:300],',
    '        "parameters": props,',
    '    }',
    '',
    'def _inspect_type(type_name):',
    '    clean = type_name[10:] if type_name.startswith("bpy.types.") else type_name',
    '    cls = getattr(bpy.types, clean, None)',
    '    if cls is None:',
    '        matches = [t for t in dir(bpy.types) if clean.lower() in t.lower()][:25]',
    '        return {"ok": False, "error": f"Unknown bpy.types.{clean}", "suggestions": matches}',
    '    rna = cls.bl_rna',
    '    props = [_serialize_prop(p) for p in rna.properties if p.identifier != "rna_type" and _match(p.identifier + " " + p.name)][:LIMIT]',
    '    funcs = [f.identifier for f in rna.functions if _match(f.identifier)][:LIMIT]',
    '    return {',
    '        "ok": True,',
    '        "kind": "type",',
    '        "blender_version": bpy.app.version_string,',
    '        "type": f"bpy.types.{clean}",',
    '        "description": (rna.description or "")[:300],',
    '        "properties": props,',
    '        "functions": funcs,',
    '    }',
    '',
    'try:',
    '    if KIND == "node":',
    '        res = _inspect_node(ALIAS)',
    '    elif KIND == "op":',
    '        res = _inspect_op(QUERY)',
    '    elif KIND == "type":',
    '        res = _inspect_type(ALIAS)',
    '    else:',
    '        if QUERY.startswith("bpy.ops.") or ("." in QUERY and not QUERY.startswith("bpy.types.")):',
    '            res = _inspect_op(QUERY)',
    '        elif ALIAS.startswith("ShaderNode") and hasattr(bpy.types, ALIAS):',
    '            res = _inspect_node(ALIAS)',
    '        elif hasattr(bpy.types, ALIAS):',
    '            res = _inspect_type(ALIAS)',
    '        else:',
    '            res = _inspect_op(QUERY)',
    'except Exception as exc:',
    '    res = {"ok": False, "blender_version": bpy.app.version_string, "error": str(exc)}',
    '',
    'print(json.dumps(res, ensure_ascii=False))',
  ].join('\n')
}

export function registerApiLookupTool(server: McpServer, client: GatewayClient): void {
  server.tool(
    'blender_api_lookup',
    '【运行时 bpy API 内省】向当前运行的 Blender 4.5 LTS 实例实时查询 bpy.ops 算子参数、bpy.types RNA 属性/枚举值，或 Shader 节点（如 Principled BSDF）的精确输入/输出口签名与默认值，从根源避免跨版本 API 幻觉。',
    {
      query: z
        .string()
        .describe('查询目标，如 "Principled BSDF"、"ShaderNodeBsdfPrincipled"、"bpy.ops.mesh.bevel"、"RenderSettings"、"ColorManagedViewSettings"'),
      kind: z
        .enum(['auto', 'op', 'type', 'node'])
        .optional()
        .describe('查询类型：auto（默认自动识别）| node（Shader 节点输入/输出口）| op（bpy.ops 算子）| type（bpy.types RNA 类型）'),
      filter: z.string().optional().describe('可选关键词过滤属性或输入口名称（不区分大小写）'),
      limit: z.number().int().optional().describe('返回最大条目数，默认 60（1..200）'),
    },
    async (args): Promise<McpToolResult> => {
      if (!(await client.ensureReady())) {
        return errorResult('gateway_unreachable', `Gateway 不可用（127.0.0.1:${client.port}）`)
      }
      const ready = await client.requireReadySession()
      if (!ready.ok) return textResult(ready.message, true)

      const code = buildIntrospectionPython(
        args.query,
        args.kind ?? 'auto',
        args.filter ?? '',
        args.limit ?? 60,
      )
      const r = await client.postJson(
        '/act',
        { code, file: null, py: true, sessionId: ready.sessionId, waitMs: 2000 },
        60000,
      )
      if (r.ok !== true) {
        return errorResult('api_lookup_error', `API 内省失败 · ${text(r.error || r.raw || 'unknown')}`)
      }
      const stdout = text(r.stdout).trim()
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>
        return textResult(JSON.stringify(parsed, null, 2), parsed.ok === false)
      } catch {
        return textResult(stdout || JSON.stringify(r, null, 2))
      }
    },
  )
}
