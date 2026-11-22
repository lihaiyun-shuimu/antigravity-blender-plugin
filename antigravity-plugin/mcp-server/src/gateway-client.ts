import { createHash } from 'node:crypto'
import type { GatewayManager } from './gateway-manager.js'

export type JsonRecord = Record<string, unknown>

export interface FrameResult {
  png: Uint8Array
  ms: number
  hash: string
}

export interface ViewResult extends FrameResult {
  meta: JsonRecord | null
}

export const HOLDER = process.env.DSH_BLENDER_HOLDER || 'antigravity-blender-mcp'
export const CALLER_HEADERS: Record<string, string> = {
  'x-dsh-host-id': process.env.DSH_HOST_ID || 'antigravity-desktop-host',
  'x-dsh-session-id': process.env.DSH_SESSION_ID || 'antigravity-desktop-session',
  'x-dsh-agent-id': process.env.DSH_AGENT_ID || 'antigravity-main',
  'x-dsh-agent-role': 'main',
  'x-dsh-display-name': 'Antigravity',
}

export function isRecord(v: unknown): v is JsonRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function asRecord(v: unknown): JsonRecord {
  return isRecord(v) ? v : {}
}

export function text(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

export function jsonPayload(v: unknown): JsonRecord {
  if (v === undefined || v === null || v === '') return {}
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  if (isRecord(v)) return { ...v }
  return {}
}

/**
 * Parse Gateway HTTP response body.
 * Supports both single-JSON routes and NDJSON streaming routes (/headless, /worker, /txn, /preset)
 * that emit periodic {"heartbeat":true,...} lines before the final result object.
 */
export function parseBackendBody(body: unknown): JsonRecord {
  const raw = String(body ?? '')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed)) return parsed
  } catch {
    // Fall through to NDJSON line scan
  }
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  let last: JsonRecord | null = null
  let heartbeats = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(lines[i])
      if (isRecord(parsed) && parsed.heartbeat !== true) {
        last = parsed
        break
      }
    } catch {
      continue
    }
  }
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed) && parsed.heartbeat === true) heartbeats++
    } catch {
      // Ignore non-JSON lines
    }
  }
  if (last) {
    last.__heartbeats = heartbeats
    last.__streamLines = lines.length
    return last
  }
  return {
    ok: false,
    raw: raw.slice(-500),
    streamLines: lines.length,
    parseError: 'no JSON line found',
  }
}

export function leasedText(r: unknown): string | undefined {
  const body = asRecord(r)
  if (body.error !== 'leased') return undefined
  return (
    `写通道被别的会话占用（holder=${text(body.holder)}，剩余 ${Math.round(Number(body.expiresInMs || 0) / 1000)}s）。` +
    `${text(body.hint)}；写 scope 由 blender_session action=grant 管理\n` +
    'code: lease_conflict\n' +
    'next_action: 等当前写操作结束或 release 后重试'
  )
}

export class GatewayClient {
  constructor(public readonly manager: GatewayManager) {}

  public get port(): number {
    return this.manager.port
  }

  public async ensureReady(): Promise<boolean> {
    return this.manager.ensureRunning()
  }

  public async getJson(path: string, timeoutMs = 20000): Promise<JsonRecord> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetch(`${this.manager.baseUrl()}${path}`, {
        headers: { ...CALLER_HEADERS },
        signal: ac.signal,
      })
      const body = await r.text()
      try {
        const parsed: unknown = JSON.parse(body)
        return isRecord(parsed) ? parsed : { ok: r.ok, value: parsed }
      } catch {
        return { ok: false, raw: body.slice(0, 500), __status: r.status }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  public async postJson(path: string, body: unknown, timeoutMs = 60000): Promise<JsonRecord> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetch(`${this.manager.baseUrl()}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...CALLER_HEADERS },
        body: JSON.stringify({ ...asRecord(body), holder: HOLDER }),
        signal: ac.signal,
      })
      const bodyText = await r.text()
      const parsed = parseBackendBody(bodyText)
      parsed.__status = r.status
      return parsed
    } finally {
      clearTimeout(timer)
    }
  }

  public async fetchFrame(size: number, full = false, area = 0): Promise<FrameResult> {
    const t0 = Date.now()
    const query = full ? `full=1&area=${area}` : `size=${size}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 60000)
    try {
      const r = await fetch(`${this.manager.baseUrl()}/frame.png?${query}`, {
        headers: { ...CALLER_HEADERS },
        signal: ac.signal,
      })
      if (!r.ok) throw new Error(`frame http ${r.status}`)
      const buf = new Uint8Array(await r.arrayBuffer())
      return {
        png: buf,
        ms: Date.now() - t0,
        hash: createHash('md5').update(buf).digest('hex').slice(0, 8),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  public async fetchView(spec: JsonRecord, timeoutMs = 180000): Promise<ViewResult> {
    const t0 = Date.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const r = await fetch(`${this.manager.baseUrl()}/view`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...CALLER_HEADERS },
        body: JSON.stringify(spec),
        signal: ac.signal,
      })
      if (!r.ok) {
        const bodyText = await r.text()
        let errText = bodyText.slice(0, 300)
        try {
          const parsed: unknown = JSON.parse(bodyText)
          if (isRecord(parsed) && parsed.error) errText = String(parsed.error)
        } catch {
          // Keep raw body slice
        }
        throw new Error(`view http ${r.status} · ${errText}`)
      }
      let meta: JsonRecord | null = null
      try {
        const rawHdr = String(r.headers.get('x-dsh-view') || 'null')
        const decoded = rawHdr.startsWith('%7B') ? decodeURIComponent(rawHdr) : rawHdr
        const parsed: unknown = JSON.parse(decoded)
        meta = isRecord(parsed) ? parsed : null
      } catch {
        meta = null
      }
      const buf = new Uint8Array(await r.arrayBuffer())
      return {
        png: buf,
        ms: Date.now() - t0,
        meta,
        hash: createHash('md5').update(buf).digest('hex').slice(0, 8),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  public async sessionAction(
    action: string,
    payload: JsonRecord = {},
    timeoutMs = 20000,
  ): Promise<JsonRecord> {
    try {
      return await this.postJson('/lease', { action, ...payload }, timeoutMs)
    } catch (err) {
      return {
        ok: false,
        code: 'gateway_unreachable',
        stage: 'transport',
        root_cause: `Gateway 不可达 · ${err instanceof Error ? err.message : String(err)}`,
        fix: `确认本地 DSH Gateway（127.0.0.1:${this.port}）已启动，并在 Blender N 面板点击 Connect。`,
      }
    }
  }

  public async listSessions(): Promise<{ ok: true; sessions: JsonRecord[] } | { ok: false; error: JsonRecord }> {
    const r = await this.sessionAction('list')
    if (r.ok !== true) return { ok: false, error: r }
    const rows = Array.isArray(r.sessions) ? r.sessions.filter(isRecord).map(asRecord) : []
    return { ok: true, sessions: rows }
  }

  public async requireReadySession(
    kind?: string,
  ): Promise<{ ok: true; session: JsonRecord; sessionId: string; instanceId: string } | { ok: false; message: string }> {
    const listed = await this.listSessions()
    if (!listed.ok) {
      const err = listed.error
      return {
        ok: false,
        message: `session list 失败 · ${text(err.root_cause || err.error || 'unknown')}\nfix: ${text(err.fix || err.hint || '检查 Gateway 与 Blender 连接')}`,
      }
    }
    const ready = listed.sessions.filter(
      (s) => String(s.status || '') === 'ready' && Boolean(String(s.instanceId || '')),
    )
    const filtered = kind ? ready.filter((s) => String(s.kind || '') === kind) : ready
    const row =
      filtered.find((s) => String(s.kind || '') === 'user-gui') ??
      filtered.find((s) => String(s.kind || '') === 'virtual-gui') ??
      filtered[0] ??
      null

    if (!row) {
      return {
        ok: false,
        message:
          'code: session_required\n' +
          'Blender 未附着：没有 ready 的 GUI 会话（不会自动启动 Blender 或转 headless）。\n' +
          'fix: 在 Blender 4.5 LTS 打开 GUI，在 N 面板 DSH Blender Bridge 点击 Connect，再调用 blender_session(action="attach")。',
      }
    }
    return {
      ok: true,
      session: row,
      sessionId: String(row.id || ''),
      instanceId: String(row.instanceId || ''),
    }
  }

  public async publishView(sessionId: string, view: JsonRecord): Promise<void> {
    if (!sessionId) return
    try {
      await this.sessionAction('update_view', { sessionId, view }, 5000)
    } catch {
      // Observational presence only
    }
  }
}
