import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  asRecord,
  isRecord,
  jsonPayload,
  leasedText,
  text,
  type GatewayClient,
  type JsonRecord,
} from '../gateway-client.js'
import {
  bufferToImageContent,
  dedupeNote,
  errorResult,
  extractPlanImagePaths,
  fileToImageContent,
  frameDedupe,
  pngSize,
  textResult,
  type McpContentItem,
  type McpToolResult,
} from '../media.js'

const BACKEND_HINT =
  '请确认 Blender 4.5 LTS 正在运行且 DSH Blender Bridge v2.0+ 已在 N 面板点击 Connect（连接至 127.0.0.1:39877）。'

// Mirror of upstream src/tools/op/read-only.ts so read-only /plan ops work without requiring a GUI session.
const READ_ONLY_OPS = new Set<string>([
  'status', 'help', 'ledger', 'check_envelope', 'check_interference', 'check_interface',
  'plan_status', 'plan_validate', 'plan_diag', 'plan_order', 'plan_graph',
  'audit_mesh', 'audit_scene', 'audit_duplicates', 'audit_help', 'audit_connectivity',
  'audit_drift', 'audit_measure', 'audit_gate', 'montage', 'motion_status', 'motion_help',
  'motion_joints', 'deliver_help', 'deliver_verify', 'generator_list', 'generator_get',
  'generator_diff', 'generator_help', 'catalog', 'catalog_help', 'help_all', 'material_scan',
  'material_help', 'gate_plan', 'gate_help', 'img_scan', 'img_help', 'calib_help',
  'face_ratios', 'face_compare', 'face_help', 'gltf_validate', 'clear_check', 'clear_help',
  'vehicle_package', 'vehicle_spec', 'vehicle_help', 'shape_draft', 'shape_draft_check',
  'shape_plan', 'shape_help', 'shape_sections', 'shape_revolve', 'render_state', 'render_wait',
  'sculpt_scan', 'sculpt_help', 'fix_help', 'uv_stats', 'uv_help', 'print_walls',
  'print_overhang', 'print_report', 'print_help', 'sweep_analyze', 'sweep_help', 'gui_frame',
  'gui_shading', 'gui_help', 'render_status', 'render_lock_status', 'gate_preflight',
  'gate_checkpoint', 'model_preflight', 'model_checkpoint', 'visualreport_report',
  'visualreport_help', 'qc_visual_report', 'shapesolve_help', 'eval_help', 'surface_help',
  'img_digest', 'img_probe', 'img_measure', 'img_calib', 'audit_interference', 'audit_overlap',
  'audit_snap_floaters', 'interference_report', 'asm_scan', 'asm_manifest', 'asm_gate',
  'asm_selftest', 'asm_help', 'fix_interference', 'blockout_help', 'blockout_selftest',
])

const PLAN_AUTO_ATTACH_OPS = new Set<string>([
  'img_digest',
  'qc_compare',
  'visualreport_report',
  'qc_visual_report',
  'shapesolve_solve',
])

const WRONG_INSPECT_TOOL: Record<string, { tool: string; hint: string }> = {
  export_scene: { tool: 'blender_op', hint: '导出请用 blender_op 的 deliver_* 算子' },
  set_texture: { tool: 'blender_op', hint: '材质/贴图请用 blender_op 的 material_* 算子' },
  execute_code: { tool: 'blender_py', hint: '执行 Python 请用 blender_py' },
  get_viewport_screenshot: { tool: 'blender_see', hint: '视口截图请用 blender_see' },
  drain_human_activity: { tool: 'blender_inspect', hint: '查询人工活动请用 get_activity_state' },
  send_selection_to_dsh: { tool: 'none', hint: '内部传输命令；查询选中请用 get_selection' },
  send_collection_to_dsh: { tool: 'none', hint: '内部传输命令；查询集合请用 get_collections' },
}

const ASPECT_RATIO: Record<string, [number, number]> = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '16:9': [16, 9],
}
const ASPECT_SIZES: Record<string, number[]> = {
  '1:1': [544, 768, 1024, 1280],
  '4:3': [640, 960, 1280],
  '16:9': [1024, 1152, 1280],
}
const CAMERA_SIZES = [544, 768, 1024, 1280]

function present(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

function splitCsv(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  const s = String(v ?? '').trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean)
    } catch {
      // Fallback to CSV split
    }
  }
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

function numTriple(v: unknown): number[] | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (Array.isArray(v)) return v.map((x) => Number(x))
  const parts = String(v)
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((x) => Number(x))
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : undefined
}

function prettyJson(v: unknown, cap = 16000): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? ''
  return s.length > cap ? `${s.slice(0, cap)}\n…[已截断，共 ${s.length} 字符]` : s
}

function resolveDims(aspect: string, maxSize?: number): { width: number; height: number; maxSize: number } | null {
  const allowed = ASPECT_SIZES[aspect]
  if (!allowed) return null
  const size = maxSize === undefined ? (aspect === '16:9' ? 1024 : allowed[0]) : maxSize
  if (!allowed.includes(size)) return null
  const [aw, ah] = ASPECT_RATIO[aspect]
  return { maxSize: size, width: size, height: Math.round((size * ah) / aw) }
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]
  }
  return prev[b.length]
}

async function ensureGatewayOrError(client: GatewayClient): Promise<McpToolResult | null> {
  if (await client.ensureReady()) return null
  return errorResult('gateway_unreachable', `Gateway 不可用（127.0.0.1:${client.port}）`, BACKEND_HINT)
}

export function registerCoreTools(server: McpServer, client: GatewayClient): void {
  // 1. blender_session
  server.tool(
    'blender_session',
    '【会话 / 归属 / 权限 / 事务】管理 Blender GUI 会话：list/status/doctor 看状态；attach/claim 附着已打开的 Blender；grant/revoke 管理写 scope；mark_read 清掉 human_modified 冲突；action=txn 执行文件/对象级快照与回滚（snapshot/restore/list/prune/mark/revert/marks/drop）。',
    {
      action: z.string().describe('list | status | doctor | attach | claim | detach | release | grant | revoke | grants | pause | resume | mark_read | presence | heartbeat | start | stop | txn | help'),
      session_id: z.string().optional().describe('会话 id'),
      instance_id: z.string().optional().describe('attach/claim 时的 addon 实例 id'),
      kind: z.string().optional().describe('start 的会话类型（仅 virtual-gui；macOS 请用 GUI Connect + attach）'),
      scopes: z.string().optional().describe('grant/mark_read 的 scope 列表，逗号分隔'),
      target_agent_id: z.string().optional().describe('grant 的目标 agent id'),
      target_dsh_session_id: z.string().optional().describe('grant 的目标 session id'),
      target_host_id: z.string().optional().describe('grant 的目标 host id'),
      grant_id: z.string().optional().describe('revoke 的 grant id'),
      ttl_ms: z.number().int().optional().describe('grant 有效期毫秒'),
      op: z.string().optional().describe('txn 子动作：snapshot | restore | list | prune | mark | revert | marks | drop | help'),
      label: z.string().optional().describe('txn：快照或 mark 名称'),
      note: z.string().optional().describe('txn：snapshot 备注'),
      objects: z.string().optional().describe('txn：mark 限定的对象（逗号分隔）'),
      keep: z.number().int().optional().describe('txn prune：保留最近 N 个快照'),
      into: z.string().optional().describe('txn restore：auto | snapshot | original'),
      backup: z.boolean().optional().describe('txn restore：是否先留 pre_restore 备份'),
      force: z.boolean().optional().describe('保留参数'),
    },
    async (args): Promise<McpToolResult> => {
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr

      const action = text(args.action).trim() || 'list'
      if (action === 'help') {
        return textResult(
          'blender_session 动作：list | status | doctor | attach | claim | detach | release | grant | revoke | grants | pause | resume | mark_read | presence | heartbeat | start | stop | txn | help\n' +
            'txn 子动作（action="txn"）：op=snapshot | restore | list | prune | mark | revert | marks | drop | help',
        )
      }

      if (action === 'txn') {
        const op = text(args.op).trim() || 'list'
        const txnArgs: JsonRecord = {}
        if (args.label) txnArgs.label = args.label
        if (args.note) txnArgs.note = args.note
        if (args.keep !== undefined) txnArgs.keep = args.keep
        if (args.into) txnArgs.into = args.into
        if (typeof args.backup === 'boolean') txnArgs.backup = args.backup
        if (args.objects) txnArgs.objects = splitCsv(args.objects)
        const r = await client.postJson('/txn', { op, args: txnArgs }, 300000)
        const lt = leasedText(r)
        if (lt) return textResult(lt, true)
        if (r.ok !== true) {
          return errorResult('txn_error', `TXN ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`, '用 blender_session(action="txn", op="list") 查看快照')
        }
        return textResult(`TXN ${op} ok\n${prettyJson(r.result ?? r)}`)
      }

      if (action === 'doctor') {
        const body = await client.getJson('/doctor', 60000)
        return textResult(prettyJson(body), body.ok === false && body.kind !== 'ok')
      }

      if (action === 'status') {
        const [listed, status] = await Promise.all([client.listSessions(), client.getJson('/status', 20000)])
        return textResult(prettyJson({ status, sessions: listed.ok ? listed.sessions : listed.error }))
      }

      if (action === 'list') {
        const listed = await client.listSessions()
        if (!listed.ok) return errorResult('session_error', prettyJson(listed.error))
        return textResult(prettyJson({ ok: true, sessions: listed.sessions }))
      }

      const payload: JsonRecord = {}
      const map: Array<[keyof typeof args, string]> = [
        ['session_id', 'sessionId'],
        ['instance_id', 'instanceId'],
        ['kind', 'kind'],
        ['grant_id', 'grantId'],
        ['ttl_ms', 'ttlMs'],
        ['target_agent_id', 'targetAgentId'],
        ['target_dsh_session_id', 'targetDshSessionId'],
        ['target_host_id', 'targetHostId'],
        ['force', 'force'],
      ]
      for (const [snake, camel] of map) {
        if (present(args[snake])) payload[camel] = args[snake]
      }
      if (present(args.scopes)) payload.scopes = splitCsv(args.scopes)
      if (action === 'start' && !present(payload.kind)) payload.kind = 'virtual-gui'

      const body = await client.sessionAction(action, payload)
      if (body.ok === false) {
        return errorResult(
          text(body.code || body.error || 'session_error'),
          `SESSION ${action} 失败 · ${text(body.root_cause || body.error || 'unknown')}`,
          text(body.fix || body.hint || '检查会话状态后重试'),
        )
      }
      return textResult(`SESSION ${action} ok\n${prettyJson(body)}`)
    },
  )

  // 2. blender_op
  server.tool(
    'blender_op',
    '【算子】执行 catalog 的 plan 算子（34 family / 228 op；op="catalog" 查目录），以及参数搜索 loop、对象精简 opt、配方库 preset。',
    {
      action: z.string().optional().describe('plan（默认）| loop | opt | preset | help'),
      op: z.string().optional().describe('plan 算子名（如 catalog / audit_mesh / surface_loft / asm_scan）或 loop/opt/preset 子动作'),
      args: z.unknown().optional().describe('plan/opt/preset 参数对象（JSON 对象或 JSON 字符串）'),
      path: z.string().optional().describe('plan report / loop export 输出路径'),
      attach_images: z.boolean().optional().describe('plan：是否将产物图片转为 ImageContent 返回'),
      session: z.string().optional().describe('loop target=session 的无头 worker 名'),
      target: z.string().optional().describe('loop：gui（默认）| session'),
      spec: z.unknown().optional().describe('loop start 的 spec 对象'),
      history: z.number().int().optional().describe('loop status：指标尾迹长度'),
      board: z.number().int().optional().describe('loop status：返回前 N 个候选'),
      limit: z.number().int().optional().describe('loop board：候选条数'),
      groups: z.boolean().optional().describe('loop board：是否包含分组候选'),
      top: z.number().int().optional().describe('loop export：变体数量'),
      include_variants: z.boolean().optional().describe('loop export：是否导出候选表'),
      note: z.string().optional().describe('loop export / preset save 备注'),
      iterations: z.number().int().optional().describe('loop bench 迭代次数'),
      name: z.string().optional().describe('preset 配方名'),
      kind: z.string().optional().describe('preset 分类（material/object/scene）'),
      tags: z.string().optional().describe('preset 标签（逗号分隔）'),
      names: z.string().optional().describe('preset export 配方名（逗号分隔）'),
      targets: z.string().optional().describe('preset apply 目标（逗号分隔）'),
      data: z.unknown().optional().describe('preset save 点路径 JSON'),
      overwrite: z.boolean().optional().describe('preset save/import 是否覆盖'),
    },
    async (args): Promise<McpToolResult> => {
      const action = text(args.action).trim() || 'plan'
      if (action === 'help') {
        return textResult(
          'blender_op 动作：plan（34 family / 228 op，op="catalog" 看目录）| loop | opt | preset | help',
        )
      }
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr

      if (action === 'plan') {
        const op = text(args.op).trim() || 'status'
        const payload = jsonPayload(args.args)
        const dryRun = payload.dry_run === true
        if (!READ_ONLY_OPS.has(op) && !dryRun) {
          const ready = await client.requireReadySession()
          if (!ready.ok) return textResult(ready.message, true)
        }
        if (op === 'report' && args.path) payload.path = args.path
        const r = await client.postJson('/plan', { op, args: payload }, 300000)
        const lt = leasedText(r)
        if (lt) return textResult(lt, true)
        if (r.ok !== true) {
          return errorResult('op_error', `OP ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`, '先调用 blender_op(action="plan", op="catalog") 核对算子名与参数')
        }
        const content: McpContentItem[] = [{ type: 'text', text: `OP ${op} ok\n${prettyJson(r.result ?? r, 14000)}` }]
        const wantImages = args.attach_images !== undefined ? args.attach_images : PLAN_AUTO_ATTACH_OPS.has(op)
        if (wantImages) {
          for (const imgPath of extractPlanImagePaths(r.result, 2)) {
            const img = fileToImageContent(imgPath)
            if (img) content.push(img)
          }
        }
        return { content }
      }

      if (action === 'loop') {
        const target = text(args.target).trim() || 'gui'
        const op = text(args.op).trim() || 'status'
        if (target !== 'gui' && target !== 'session') {
          return errorResult('invalid_params', 'loop target 只能是 gui 或 session')
        }
        if (target === 'gui') {
          const ready = await client.requireReadySession()
          if (!ready.ok) return textResult(ready.message, true)
          const r = await client.postJson(
            '/loop',
            {
              op,
              spec: jsonPayload(args.spec),
              history: args.history ?? 8,
              board: args.board ?? 0,
              limit: args.limit ?? 10,
              groups: args.groups !== false,
              path: args.path,
              top: args.top ?? 1,
              include_variants: Boolean(args.include_variants),
              note: args.note ?? '',
              iterations: args.iterations ?? 5000,
            },
            300000,
          )
          const lt = leasedText(r)
          if (lt) return textResult(lt, true)
          if (r.ok !== true) return errorResult('loop_error', `LOOP ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`)
          return textResult(`LOOP ${op} ok\n${prettyJson(r.result ?? r)}`)
        }
        const workerName = text(args.session).trim() || 'dsh-loop'
        const st = await client.postJson(
          '/worker',
          { op: 'start', name: workerName, preload: 'runner', engine: 'workbench', warmup: true, isolated: true },
          120000,
        )
        if (st.ok !== true) return errorResult('loop_error', `LOOP session 启动失败 · ${text(st.error || st.raw || 'unknown')}`)
        const specJson = JSON.stringify(JSON.stringify(jsonPayload(args.spec)))
        const code =
          op === 'start'
            ? `import json as _json\n_s = _json.loads(${specJson})\n_r = K.dsh_loop_api["sync"](_s)\nprint("HEADLESS " + (_r if isinstance(_r, str) else _json.dumps(_r, ensure_ascii=False)))`
            : op === 'status'
              ? `print("HEADLESS " + K.dsh_loop_api["status"](${args.history ?? 8}, ${args.board ?? 0}))`
              : op === 'board'
                ? `print("HEADLESS " + K.dsh_loop_api["board"](${args.limit ?? 10}, ${args.groups === false ? 'False' : 'True'}))`
                : op === 'export'
                  ? `print("HEADLESS " + K.dsh_loop_api["export"](${JSON.stringify(args.path ?? null)}, ${args.top ?? 1}, ${args.include_variants ? 'True' : 'False'}, ${JSON.stringify(args.note ?? '')}))`
                  : op === 'stop'
                    ? 'print("HEADLESS " + K.dsh_loop_api["stop"]())'
                    : op === 'bench'
                      ? `print("HEADLESS " + K.dsh_loop_api["bench"](${args.iterations ?? 5000}))`
                      : 'print("HEADLESS " + K.dsh_loop_api["help"]())'
        const r = await client.postJson('/worker', { op: 'exec', name: workerName, code, isolated: true }, 300000)
        if (r.ok !== true) return errorResult('loop_error', `LOOP session ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`)
        return textResult(`LOOP session(${workerName}) ${op} ok\n${prettyJson(r.result ?? r)}`)
      }

      if (action === 'opt') {
        const ready = await client.requireReadySession()
        if (!ready.ok) return textResult(ready.message, true)
        const op = text(args.op).trim() || 'analyze'
        const oargs = jsonPayload(args.args)
        const r = await client.postJson(
          '/opt',
          { op: op === 'join' ? 'opt_join' : 'opt_analyze', args: Object.keys(oargs).length ? oargs : undefined },
          600000,
        )
        const lt = leasedText(r)
        if (lt) return textResult(lt, true)
        if (r.ok !== true) return errorResult('opt_error', `OPT ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`)
        return textResult(`OPT ${op} ok\n${prettyJson(r.result ?? r)}`)
      }

      if (action === 'preset') {
        const ready = await client.requireReadySession()
        if (!ready.ok) return textResult(ready.message, true)
        const op = text(args.op).trim() || 'list'
        const pargs: JsonRecord = {}
        if (args.name) pargs.name = args.name
        if (args.kind) pargs.kind = args.kind
        if (args.note) pargs.note = args.note
        if (args.path) pargs.path = args.path
        if (args.tags) pargs.tags = splitCsv(args.tags)
        if (args.names) pargs.names = splitCsv(args.names)
        if (args.targets) pargs.targets = splitCsv(args.targets)
        if (args.data !== undefined) pargs.data = jsonPayload(args.data)
        if (args.overwrite === false) pargs.overwrite = false
        const r = await client.postJson('/preset', { op, args: pargs }, 300000)
        const lt = leasedText(r)
        if (lt) return textResult(lt, true)
        if (r.ok !== true) return errorResult('preset_error', `PRESET ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`)
        return textResult(`PRESET ${op} ok\n${prettyJson(r.result ?? r)}`)
      }

      return errorResult('invalid_params', `未知 blender_op action：${action}`, '可用 action：plan | loop | opt | preset | help')
    },
  )

  // 3. blender_py
  server.tool(
    'blender_py',
    '【执行 Python】在 ready 的 GUI 会话中执行 Python 代码（/act 通道，固定 exclusive）；可选 see=true（默认）执行后顺带抓取视口截图并转为标准 MCP ImageContent 返回。',
    {
      code: z.string().optional().describe('要执行的 Python 源码（与 file 二选一）'),
      file: z.string().optional().describe('要执行的 .py 脚本文件路径（与 code 二选一）'),
      see: z.boolean().optional().describe('执行完是否顺带抓当前视口一帧（默认 true）'),
      max_size: z.number().int().optional().describe('see 的最长边像素，默认 560（120..1600）'),
      force: z.boolean().optional().describe('see：同画面默认去重，true 强制重发'),
      wait_ms: z.number().int().optional().describe('等待其他 py 释放的毫秒数（0..5000，默认 0）'),
    },
    async (args): Promise<McpToolResult> => {
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr
      const ready = await client.requireReadySession()
      if (!ready.ok) return textResult(ready.message, true)

      const code = text(args.code)
      const file = args.file ? text(args.file) : null
      if (!code && !file) {
        return errorResult('invalid_params', 'blender_py 需要 code 或 file 之一')
      }

      const r = await client.postJson(
        '/act',
        { code, file, py: true, sessionId: ready.sessionId, waitMs: args.wait_ms ?? 0 },
        180000,
      )
      const lt = leasedText(r)
      if (lt) return textResult(lt, true)
      if (r.ok !== true) {
        return errorResult(
          'py_error',
          `PY 执行失败 · ${text(r.error || r.raw || 'unknown')}`,
          '检查 traceback 后修正脚本；耗时 >60s 的任务请改用 blender_run(kind="headless")。',
        )
      }

      const lines: string[] = []
      if (present(r.stdout)) lines.push(text(r.stdout))
      if (present(r.result) && !present(r.stdout)) lines.push(prettyJson(r.result))
      if (present(r.stderr)) lines.push(`stderr:\n${text(r.stderr)}`)
      if (lines.length === 0) lines.push('PY ok')

      const content: McpContentItem[] = [{ type: 'text', text: lines.join('\n') }]

      if (args.see !== false) {
        const size = Math.max(120, Math.min(1600, Number(args.max_size ?? 560)))
        try {
          const frame = await client.fetchFrame(size)
          const dd = frameDedupe(`py-see:${size}`, frame.hash, Boolean(args.force))
          if (dd.dup) {
            content[0] = { type: 'text', text: `${content[0].type === 'text' ? content[0].text : ''}${dedupeNote(dd.repeats)}` }
          } else {
            content[0] = {
              type: 'text',
              text: `${content[0].type === 'text' ? content[0].text : ''}\nSEE ${size}px · ${frame.ms}ms · hash ${frame.hash}`,
            }
            content.push(bufferToImageContent(frame.png, 'image/png'))
          }
        } catch (err) {
          content[0] = {
            type: 'text',
            text: `${content[0].type === 'text' ? content[0].text : ''}\n⚠ 自动抓帧失败：${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
      return { content }
    },
  )

  // 4. blender_see
  server.tool(
    'blender_see',
    '【看 GUI】捕获 GUI 视口/相机/自定义机位画面（mode=frame 单帧或 sequence 序列帧），返回标准 MCP ImageContent 供视觉检查。',
    {
      viewpoint: z.enum(['viewport', 'camera', 'custom']).optional().describe('viewport（默认）| camera | custom（需 from+look_at）'),
      mode: z.enum(['frame', 'sequence']).optional().describe('frame（默认单帧）| sequence（序列帧，仅 viewport/custom）'),
      camera: z.union([z.string(), z.boolean()]).optional().describe('viewpoint=camera 时可选相机名或 true'),
      aspect: z.enum(['1:1', '4:3', '16:9']).optional().describe('画幅比例（默认 16:9，camera 不接受）'),
      max_size: z.number().int().optional().describe('固定档位：1:1(544/768/1024/1280) 4:3(640/960/1280) 16:9(1024/1152/1280) camera(544/768/1024/1280)'),
      from: z.string().optional().describe('custom：相机位置 "x,y,z"'),
      look_at: z.string().optional().describe('custom：看向的点 "x,y,z"'),
      lens: z.number().optional().describe('custom：焦距 mm，默认 50'),
      ortho: z.boolean().optional().describe('custom：正交投影'),
      ortho_scale: z.number().optional().describe('custom：正交尺度'),
      full: z.boolean().optional().describe('frame+viewport：整窗口/区域截图'),
      area: z.number().int().optional().describe('full=true 时的区域序号，默认 0'),
      shading: z.string().optional().describe('custom/sequence：WIREFRAME | SOLID | MATERIAL | RENDERED'),
      overlays: z.boolean().optional().describe('custom/sequence：临时开关覆盖物'),
      diagnostics: z.boolean().optional().describe('frame+custom：覆盖率/空帧诊断'),
      seconds: z.number().optional().describe('sequence：采样时长 0.2..20s，默认 2'),
      fps: z.number().optional().describe('sequence：采样频率 0.5..8，默认 4'),
      force: z.boolean().optional().describe('同画面默认去重；true 强制重发'),
    },
    async (args): Promise<McpToolResult> => {
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr
      const ready = await client.requireReadySession()
      if (!ready.ok) return textResult(ready.message, true)

      const mode = args.mode ?? 'frame'
      const hasCustomCoords = present(args.from) || present(args.look_at)
      const viewpoint = args.viewpoint ?? (hasCustomCoords ? 'custom' : 'viewport')

      if (mode === 'sequence') {
        if (viewpoint === 'camera') {
          return errorResult('invalid_params', 'sequence 不支持 camera', '相机动画请用 blender_run(kind="render")')
        }
        const seconds = args.seconds ?? 2
        const fps = args.fps ?? 4
        const total = Math.round(seconds * fps)
        if (seconds < 0.2 || seconds > 20 || fps < 0.5 || fps > 8 || total < 1 || total > 32) {
          return errorResult('invalid_params', 'sequence 参数超限（seconds 0.2..20, fps 0.5..8, 帧数 1..32）')
        }
        const dims = resolveDims(args.aspect ?? '16:9', args.max_size)
        if (!dims) return errorResult('invalid_params', 'aspect/max_size 组合不合法')
        if (viewpoint === 'custom' && (!present(args.from) || !present(args.look_at))) {
          return errorResult('invalid_params', 'custom 视角必须同时给 from 与 look_at')
        }
        const spec: JsonRecord =
          viewpoint === 'custom'
            ? {
                mode: 'viewport',
                from: numTriple(args.from),
                look_at: numTriple(args.look_at),
                lens: args.lens,
                ortho: args.ortho,
                ortho_scale: args.ortho_scale,
                width: dims.width,
                height: dims.height,
                shading: args.shading,
                overlays: args.overlays,
              }
            : { mode: 'current', width: dims.width, height: dims.height }
        const interval = (seconds * 1000) / total
        const shots: Array<{ ms: number; hash: string; png: Uint8Array }> = []
        for (let i = 0; i < total; i++) {
          const t0 = Date.now()
          try {
            const fv = await client.fetchView(spec)
            shots.push({ ms: fv.ms, hash: fv.hash, png: fv.png })
          } catch {
            // Continue sequence capture
          }
          const wait = interval - (Date.now() - t0)
          if (i < total - 1 && wait > 0) await new Promise((r) => setTimeout(r, wait))
        }
        if (shots.length === 0) return errorResult('backend_error', 'SEE sequence 全部帧采集失败', BACKEND_HINT)
        const content: McpContentItem[] = [
          { type: 'text', text: `SEE sequence (${viewpoint}) · ${shots.length}/${total} frames · ${dims.width}x${dims.height}` },
        ]
        const seen = new Set<string>()
        for (const s of shots) {
          if (seen.has(s.hash) || content.length >= 7) continue
          seen.add(s.hash)
          content.push(bufferToImageContent(s.png, 'image/png'))
        }
        return { content }
      }

      // Single frame mode
      if (viewpoint === 'camera') {
        const size = args.max_size ?? 1024
        if (!CAMERA_SIZES.includes(size)) {
          return errorResult('invalid_params', 'camera max_size 只接受 544 / 768 / 1024 / 1280')
        }
        const camName = args.camera === true ? '' : text(args.camera).trim()
        try {
          const fv = await client.fetchView({ mode: 'camera', camera: camName, max_size: size })
          const mt = asRecord(fv.meta)
          const dd = frameDedupe('see:camera', fv.hash, Boolean(args.force))
          const info = `SEE camera · ${text(mt.width || '?')}x${text(mt.height || '?')} · ${fv.ms}ms · hash ${fv.hash}${dd.dup ? dedupeNote(dd.repeats) : ''}`
          const content: McpContentItem[] = [{ type: 'text', text: info }]
          if (!dd.dup) content.push(bufferToImageContent(fv.png, 'image/png'))
          await client.publishView(ready.sessionId, { viewpoint: 'camera', camera: text(mt.camera) || camName, frame: mt.frame })
          return { content }
        } catch (err) {
          return errorResult('backend_error', `SEE camera 失败 · ${err instanceof Error ? err.message : String(err)}`, BACKEND_HINT)
        }
      }

      if (viewpoint === 'viewport' && args.full === true) {
        const area = args.area ?? 0
        try {
          const fr = await client.fetchFrame(1024, true, area)
          const [w, h] = pngSize(fr.png)
          const dd = frameDedupe(`see:full:${area}`, fr.hash, Boolean(args.force))
          const info = `SEE full · ${w}x${h} · ${fr.ms}ms · ${fr.png.length}B · hash ${fr.hash}${dd.dup ? dedupeNote(dd.repeats) : ''}`
          const content: McpContentItem[] = [{ type: 'text', text: info }]
          if (!dd.dup) content.push(bufferToImageContent(fr.png, 'image/png'))
          await client.publishView(ready.sessionId, { viewpoint: 'viewport', followUser: true })
          return { content }
        } catch (err) {
          return errorResult('backend_error', `SEE full 失败 · ${err instanceof Error ? err.message : String(err)}`, BACKEND_HINT)
        }
      }

      const dims = resolveDims(args.aspect ?? '16:9', args.max_size)
      if (!dims) {
        return errorResult('invalid_params', 'aspect/max_size 组合不合法', '1:1(544/768/1024/1280) 4:3(640/960/1280) 16:9(1024/1152/1280)')
      }
      if (viewpoint === 'custom' && (!present(args.from) || !present(args.look_at))) {
        return errorResult('invalid_params', 'custom 视角必须同时给 from 与 look_at')
      }
      const spec: JsonRecord =
        viewpoint === 'custom'
          ? {
              mode: 'viewport',
              from: numTriple(args.from),
              look_at: numTriple(args.look_at),
              lens: args.lens,
              ortho: args.ortho,
              ortho_scale: args.ortho_scale,
              width: dims.width,
              height: dims.height,
              shading: args.shading,
              overlays: args.overlays,
              diagnostics: args.diagnostics,
            }
          : { mode: 'current', width: dims.width, height: dims.height }

      try {
        const fv = await client.fetchView(spec)
        const key = viewpoint === 'custom' ? `see:custom:${JSON.stringify(spec)}` : `see:current:${dims.width}x${dims.height}`
        const dd = frameDedupe(key, fv.hash, Boolean(args.force))
        const mt = asRecord(fv.meta)
        const warn = present(mt.warning) ? `\n⚠ ${text(mt.warning)}` : ''
        const info = `SEE ${viewpoint} · ${dims.width}x${dims.height} · ${fv.ms}ms · ${fv.png.length}B · hash ${fv.hash}${dd.dup ? dedupeNote(dd.repeats) : ''}${warn}`
        const content: McpContentItem[] = [{ type: 'text', text: info }]
        if (!dd.dup) content.push(bufferToImageContent(fv.png, 'image/png'))
        await client.publishView(
          ready.sessionId,
          viewpoint === 'custom'
            ? { viewpoint: 'custom', from: args.from, lookAt: args.look_at, lens: args.lens }
            : { viewpoint: 'viewport', followUser: true },
        )
        return { content }
      } catch (err) {
        return errorResult('backend_error', `SEE ${viewpoint} 失败 · ${err instanceof Error ? err.message : String(err)}`, BACKEND_HINT)
      }
    },
  )

  // 5. blender_run
  server.tool(
    'blender_run',
    '【作业 / 渲染】提交独立 blender -b 无头脚本（kind="headless"）或高采样最终渲染（kind="render"），返回 jobId 并支持 status/wait/collect/cancel/list/perf/tune。',
    {
      action: z.string().optional().describe('submit | status | wait | collect | cancel | list | perf | tune | help'),
      kind: z.string().optional().describe('submit：render | headless'),
      id: z.string().optional().describe('status/wait/collect/cancel 的 jobId'),
      priority: z.number().int().optional().describe('submit 优先级 -100..100'),
      timeout_ms: z.number().int().optional().describe('wait 等待上限或 headless 进程超时毫秒'),
      tail: z.number().int().optional().describe('collect 日志尾部字符数，默认 4000'),
      state: z.string().optional().describe('list 状态过滤'),
      owner: z.string().optional().describe('list 按 session 过滤'),
      file: z.string().optional().describe('.blend 文件路径'),
      output: z.string().optional().describe('render 输出模板'),
      outdir: z.string().optional().describe('render/headless 输出目录'),
      frames: z.unknown().optional().describe('render 帧区间 [start,end] / "1-10" / 单帧数字'),
      resolution: z.unknown().optional().describe('render [width, height]'),
      samples: z.number().int().optional().describe('render 采样数'),
      engine: z.string().optional().describe('CYCLES | BLENDER_EEVEE_NEXT | BLENDER_WORKBENCH'),
      format: z.string().optional().describe('PNG | JPEG | OPEN_EXR ...'),
      camera: z.union([z.string(), z.boolean()]).optional().describe('render 相机名或 true'),
      script: z.string().optional().describe('headless Python 脚本内容'),
      script_file: z.string().optional().describe('headless 磁盘 .py 路径'),
      preload: z.string().optional().describe('headless 预载模块（逗号分隔）'),
      factory_startup: z.boolean().optional().describe('headless --factory-startup'),
      bootstrap: z.boolean().optional().describe('headless 是否注入内核 K'),
      workdir: z.string().optional().describe('headless 工作目录'),
      include_noise: z.boolean().optional().describe('headless 是否含噪音文件'),
      out_json: z.string().optional().describe('headless 结构化结果路径'),
      args: z.unknown().optional().describe('headless 追加命令行参数；tune 参数对象'),
      env: z.unknown().optional().describe('headless 环境变量对象'),
      op: z.string().optional().describe('tune 子动作：status | analyze | apply | revert | help'),
    },
    async (args): Promise<McpToolResult> => {
      const action = text(args.action).trim() || (present(args.kind) ? 'submit' : 'list')
      if (action === 'help') {
        return textResult('blender_run 动作：submit(kind=render|headless) | status | wait | collect | cancel | list | perf | tune | help')
      }
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr

      if (action === 'tune') {
        const op = text(args.op).trim() || 'status'
        const pargs = jsonPayload(args.args)
        const r = await client.postJson('/perf', { op, args: Object.keys(pargs).length ? pargs : undefined }, 600000)
        if (r.ok !== true) return errorResult('run_tune_error', `RUN tune ${op} 失败 · ${text(r.error || r.raw || 'unknown')}`)
        return textResult(`RUN tune ${op} ok\n${prettyJson(r.result ?? r)}`)
      }

      if (action === 'submit') {
        const kind = text(args.kind).trim()
        if (kind !== 'render' && kind !== 'headless') {
          return errorResult('invalid_params', 'submit 需要 kind="render" 或 "headless"')
        }
        const payload: JsonRecord = { surface: 'queue', op: 'submit', kind }
        if (args.priority !== undefined) payload.priority = args.priority
        if (kind === 'render') {
          if (present(args.script) || present(args.script_file)) {
            return errorResult('invalid_params', 'kind=render 不接受 script/script_file；跑脚本请用 kind=headless')
          }
          for (const k of ['file', 'output', 'outdir', 'frames', 'resolution', 'samples', 'engine', 'format', 'camera'] as const) {
            if (present(args[k])) payload[k] = args[k]
          }
        } else {
          if (!present(args.script) && !present(args.script_file) && !present(args.file)) {
            return errorResult('invalid_params', 'kind=headless 需要 script / script_file / file 之一')
          }
          for (const k of ['script', 'script_file', 'file', 'outdir', 'timeout_ms', 'engine', 'preload', 'factory_startup', 'bootstrap', 'workdir', 'include_noise', 'out_json', 'args', 'env'] as const) {
            if (present(args[k])) payload[k] = args[k]
          }
        }
        const r = await client.postJson('/job', payload, 60000)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), `RUN submit 失败 · ${text(r.root_cause || r.error || 'unknown')}`, text(r.fix || ''))
        return textResult(`RUN submit ok\n${prettyJson(r.job ?? r)}`)
      }

      if (action === 'list') {
        const payload: JsonRecord = { surface: 'queue', op: 'list' }
        for (const k of ['state', 'kind', 'owner'] as const) {
          if (present(args[k])) payload[k] = args[k]
        }
        const r = await client.postJson('/job', payload, 60000)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), prettyJson(r))
        return textResult(prettyJson(r.jobs ?? r))
      }

      if (action === 'perf') {
        const r = await client.postJson('/job', { surface: 'queue', op: 'perf' }, 60000)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), prettyJson(r))
        return textResult(prettyJson(r.perf ?? r))
      }

      if (!present(args.id)) return errorResult('invalid_params', `${action} 需要 id（jobId）`)
      const id = text(args.id)

      if (action === 'wait') {
        const timeoutMs = args.timeout_ms ?? 120000
        const budget = Math.min(600000, Math.max(1000, timeoutMs)) + 30000
        const r = await client.postJson('/job', { surface: 'queue', op: 'wait', id, timeout_ms: timeoutMs }, budget)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), prettyJson(r))
        return textResult(prettyJson(r))
      }

      if (action === 'collect') {
        const r = await client.postJson('/job', { surface: 'queue', op: 'collect', id, tail: args.tail ?? 4000 }, 60000)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), prettyJson(r))
        return textResult(prettyJson(r.job ?? r))
      }

      if (action === 'status' || action === 'cancel') {
        const r = await client.postJson('/job', { surface: 'queue', op: action, id }, 60000)
        if (r.ok !== true) return errorResult(text(r.code || 'run_error'), prettyJson(r))
        return textResult(prettyJson(r.job ?? r))
      }

      return errorResult('invalid_params', `未知 blender_run action：${action}`)
    },
  )

  // 6. blender_inspect
  server.tool(
    'blender_inspect',
    '【只读检查】省略 command 或 command="help" 列出 Blender 扩展可执行只读命令与集成开关状态；传 command + args 执行只读诊断命令。',
    {
      command: z.string().optional().describe('只读命令名（如 get_addon_info / get_scene_info / get_object_info / get_collections）；省略=help'),
      args: z.unknown().optional().describe('命令参数对象（JSON）'),
    },
    async (args): Promise<McpToolResult> => {
      const gwErr = await ensureGatewayOrError(client)
      if (gwErr) return gwErr

      const command = text(args.command).trim() || 'help'
      const wrong = WRONG_INSPECT_TOOL[command]
      if (wrong) {
        return errorResult('wrong_tool', `INSPECT ${command} 不是只读命令（${wrong.hint}）`, wrong.tool === 'none' ? wrong.hint : `改用 ${wrong.tool}`)
      }

      const catalog = await client.getJson('/commands', 45000)
      if (catalog.ok === false && !Array.isArray(catalog.commands)) {
        return errorResult('addon_unreachable', `INSPECT 失败 · ${text(catalog.error || catalog.raw || 'unknown')}`, BACKEND_HINT)
      }

      const rows = Array.isArray(catalog.commands) ? catalog.commands.filter(isRecord) : []
      if (command === 'help') {
        const readable = rows
          .filter((r) => r.access !== 'internal')
          .map((r) => ({
            name: r.name,
            enabled: r.enabled,
            access: r.access,
            gate: r.gate ?? null,
            description: r.description ?? '',
          }))
        return textResult(prettyJson({ scene: catalog.scene ?? null, file: catalog.file ?? null, total: readable.length, commands: readable }))
      }

      const row = rows.find((r) => String(r.name) === command)
      if (!row) {
        const suggestions = rows
          .filter((r) => r.access === 'read')
          .map((r) => ({ name: String(r.name), d: levenshtein(command, String(r.name)) }))
          .filter((x) => x.d <= Math.max(2, Math.floor(command.length / 3)))
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map((x) => x.name)
        return errorResult(
          'unknown_command',
          `INSPECT 未知命令：${command}`,
          suggestions.length ? `did_you_mean: ${suggestions.join(', ')}` : '调用 blender_inspect(command="help") 查看可用只读命令',
        )
      }
      if (row.access === 'internal') {
        return errorResult('wrong_tool', `INSPECT ${command} 是内部传输命令，不面向模型`)
      }
      if (row.enabled === false) {
        return errorResult('command_disabled', `INSPECT ${command} 已被集成开关禁用（${text(row.gate || 'gate')}）`, '在 Blender N 面板开启对应开关后重试')
      }

      const r = await client.postJson('/cmd', { name: command, params: jsonPayload(args.args), timeoutMs: 120000 }, 300000)
      const lt = leasedText(r)
      if (lt) return textResult(lt, true)
      if (r.ok !== true) {
        return errorResult('inspect_error', `INSPECT ${command} 失败 · ${text(r.error || r.raw || 'unknown')}`)
      }
      return textResult(prettyJson(r.result ?? r))
    },
  )
}
