import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(realpathSync(fileURLToPath(import.meta.url)))

export const DEFAULT_GATEWAY_PORT = 39877

export function resolveGatewayPort(): number {
  const raw = process.env.DSH_BLENDER_GATEWAY_PORT || process.env.DSH_BLENDER_PORT
  const parsed = raw ? Number(raw) : DEFAULT_GATEWAY_PORT
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_GATEWAY_PORT
}

export function resolveGatewayEntry(): string {
  const override = process.env.DSH_BLENDER_GATEWAY_ENTRY || process.env.DSH_BLENDER_SERVER
  if (override) return override

  // dist/gateway-manager.js -> antigravity-plugin/mcp-server/dist -> repo root lib/runtime/gateway.js
  const candidates = [
    path.resolve(HERE, '..', '..', '..', 'lib', 'runtime', 'gateway.js'),
    path.resolve(HERE, '..', '..', 'lib', 'runtime', 'gateway.js'),
    path.resolve(process.cwd(), 'lib', 'runtime', 'gateway.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

function openGatewayLogFile(): { fd: number | null; logPath: string } {
  const dir = process.env.DSH_BLENDER_WORKDIR
    ? path.join(process.env.DSH_BLENDER_WORKDIR, 'logs')
    : path.join(os.tmpdir(), 'dsh-blender-gateway')
  const logPath = path.join(dir, 'antigravity-gateway.log')
  try {
    mkdirSync(dir, { recursive: true })
    return { fd: openSync(logPath, 'a'), logPath }
  } catch {
    return { fd: null, logPath }
  }
}

export class GatewayManager {
  public readonly port: number
  private child: ChildProcess | null = null
  private owned = false
  private starting: Promise<boolean> | null = null

  constructor(port: number = resolveGatewayPort()) {
    this.port = port
  }

  public baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  public async isHealthy(timeoutMs = 1500): Promise<boolean> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { signal: ac.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  public async ensureRunning(): Promise<boolean> {
    if (await this.isHealthy(1200)) return true
    if (this.starting) return this.starting
    this.starting = this.spawnAndWait().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async spawnAndWait(): Promise<boolean> {
    if (await this.isHealthy(1200)) return true

    const entry = resolveGatewayEntry()
    if (!existsSync(entry)) {
      console.error(
        `[dsh-blender-mcp] Gateway entry not found at ${entry}. Run "npm run build" in repository root first.`,
      )
      return false
    }

    const { fd, logPath } = openGatewayLogFile()
    console.error(`[dsh-blender-mcp] Starting DSH Gateway: ${entry} --port ${this.port} (log: ${logPath})`)

    const spawned = spawn(process.execPath, [entry, '--port', String(this.port)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // Never pipe Gateway output to MCP stdout; write to log file or stderr only.
      stdio: fd !== null ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    })

    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Child keeps inherited fd
      }
    } else {
      spawned.stdout?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[dsh-gateway] ${chunk.toString('utf8')}`)
      })
      spawned.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[dsh-gateway] ${chunk.toString('utf8')}`)
      })
    }

    this.child = spawned
    this.owned = true

    spawned.on('error', (err) => {
      console.error(`[dsh-blender-mcp] Gateway spawn error: ${err.message}`)
      if (this.child === spawned) {
        this.child = null
        this.owned = false
      }
    })
    spawned.on('exit', (code, signal) => {
      console.error(`[dsh-blender-mcp] Gateway exited (code=${String(code)}, signal=${String(signal)})`)
      if (this.child === spawned) {
        this.child = null
        this.owned = false
      }
    })

    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (await this.isHealthy(800)) return true
      if (!this.child || this.child.exitCode !== null) return false
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return await this.isHealthy(1000)
  }

  public stop(): void {
    if (!this.owned || !this.child) return
    const pid = this.child.pid
    try {
      this.child.kill('SIGTERM')
      console.error(`[dsh-blender-mcp] Sent SIGTERM to owned Gateway pid=${String(pid)}`)
    } catch {
      // Already exited
    }
    this.child = null
    this.owned = false
  }
}
