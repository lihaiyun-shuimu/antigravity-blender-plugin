import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type McpContentItem = McpTextContent | McpImageContent

export interface McpToolResult {
  [key: string]: unknown
  content: McpContentItem[]
  isError?: boolean
}

const lastFrameByKey = new Map<string, { hash: string; repeats: number }>()

export function frameDedupe(
  key: string,
  hash: string,
  force = false,
): { dup: boolean; repeats: number } {
  const prev = lastFrameByKey.get(key)
  if (!force && prev && prev.hash === hash) {
    prev.repeats += 1
    return { dup: true, repeats: prev.repeats }
  }
  lastFrameByKey.set(key, { hash, repeats: 0 })
  return { dup: false, repeats: 0 }
}

export function dedupeNote(repeats: number): string {
  return `\n（同画面第 ${repeats + 1} 次未重复附图；传 force=true 可强制重发）`
}

export function pngSize(buf: Uint8Array): [number, number] {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    return [view.getUint32(16, false), view.getUint32(20, false)]
  }
  return [0, 0]
}

export function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

export function bufferToImageContent(bytes: Uint8Array, mimeType = 'image/png'): McpImageContent {
  return {
    type: 'image',
    data: Buffer.from(bytes).toString('base64'),
    mimeType,
  }
}

export function fileToImageContent(filePath: string): McpImageContent | null {
  if (!filePath || !existsSync(filePath)) return null
  try {
    const bytes = readFileSync(filePath)
    if (bytes.length === 0) return null
    return {
      type: 'image',
      data: bytes.toString('base64'),
      mimeType: mimeTypeFromPath(filePath),
    }
  } catch {
    return null
  }
}

const IMG_EXT_RE = /\.(png|jpe?g|webp)$/i

export function extractPlanImagePaths(value: unknown, limit = 2): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 5 || out.length >= limit || node === null || node === undefined) return
    if (typeof node === 'string') {
      if (IMG_EXT_RE.test(node) && existsSync(node) && !seen.has(node)) {
        seen.add(node)
        out.push(node)
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) {
        walk(v, depth + 1)
      }
    }
  }
  walk(value, 0)
  return out
}

export function textResult(message: string, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    ...(isError ? { isError: true } : {}),
  }
}

export function errorResult(code: string, message: string, fix?: string): McpToolResult {
  const lines = [`[${code}] ${message}`]
  if (fix) lines.push(`fix: ${fix}`)
  return textResult(lines.join('\n'), true)
}
