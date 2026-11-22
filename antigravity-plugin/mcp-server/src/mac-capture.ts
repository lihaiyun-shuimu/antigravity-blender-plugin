import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { text, type GatewayClient, type JsonRecord, type ViewResult } from './gateway-client.js'

export interface SafeCaptureSpec {
  mode: 'current' | 'viewport' | 'camera'
  width?: number
  height?: number
  maxSize?: number
  camera?: string
  from?: number[]
  lookAt?: number[]
  lens?: number
  ortho?: boolean
  orthoScale?: number
  shading?: string
  overlays?: boolean
}

export function shouldUseSafeMacCapture(): boolean {
  if (process.env.AGY_BLENDER_SAFE_CAPTURE === '0') return false
  return process.platform === 'darwin' || process.env.AGY_BLENDER_SAFE_CAPTURE === '1'
}

function buildSafeCapturePython(spec: SafeCaptureSpec, outPath: string): string {
  return [
    'import bpy, json',
    'from mathutils import Vector',
    `SPEC = json.loads(${JSON.stringify(JSON.stringify(spec))})`,
    `OUT_PATH = ${JSON.stringify(outPath)}`,
    '',
    'def _find_view3d():',
    '    wm = bpy.context.window_manager',
    '    for win in wm.windows:',
    '        for area in win.screen.areas:',
    '            if area.type == "VIEW_3D":',
    '                reg = next((r for r in area.regions if r.type == "WINDOW"), None)',
    '                space = area.spaces.active',
    '                if reg is not None and space is not None:',
    '                    return win, area, reg, space',
    '    raise RuntimeError("No VIEW_3D area found in Blender GUI")',
    '',
    'win, area, reg, space = _find_view3d()',
    'scene = getattr(win, "scene", None) or bpy.context.scene',
    'r = scene.render',
    'mode = SPEC.get("mode", "current")',
    'meta = {"mode": mode, "backend": "opengl_metal_safe"}',
    '',
    '# Save all scene/render/viewport settings so we leave zero side effects',
    'old_res_x = r.resolution_x',
    'old_res_y = r.resolution_y',
    'old_res_pct = r.resolution_percentage',
    'old_filepath = r.filepath',
    'old_fmt = r.image_settings.file_format',
    'old_cam = scene.camera',
    'old_shading = space.shading.type',
    'old_overlays = space.overlay.show_overlays',
    'tmp_cam_obj = None',
    'tmp_cam_data = None',
    '',
    'try:',
    '    if SPEC.get("shading"):',
    '        space.shading.type = str(SPEC["shading"]).upper()',
    '    if SPEC.get("overlays") is not None:',
    '        space.overlay.show_overlays = bool(SPEC["overlays"])',
    '',
    '    view_context = True',
    '    if mode == "camera":',
    '        cam_name = SPEC.get("camera") or ""',
    '        cam = bpy.data.objects.get(cam_name) if cam_name else scene.camera',
    '        if cam is None or cam.type != "CAMERA":',
    '            raise RuntimeError(f"Camera not found: {cam_name or \'scene.camera\'}")',
    '        ax = (float(old_res_x) * float(getattr(r, "pixel_aspect_x", 1.0))) / max(1.0, float(old_res_y) * float(getattr(r, "pixel_aspect_y", 1.0)))',
    '        m = int(SPEC.get("maxSize") or 1024)',
    '        w = m if ax >= 1.0 else max(16, int(round(m * ax)))',
    '        h = max(16, int(round(m / ax))) if ax >= 1.0 else m',
    '        scene.camera = cam',
    '        view_context = False',
    '        meta["camera"] = cam.name',
    '        meta["frame"] = scene.frame_current',
    '    elif mode == "viewport":',
    '        w = int(SPEC.get("width") or 1024)',
    '        h = int(SPEC.get("height") or 576)',
    '        tmp_cam_data = bpy.data.cameras.new("_agy_tmp_see_cam_data")',
    '        if bool(SPEC.get("ortho", False)):',
    '            tmp_cam_data.type = "ORTHO"',
    '            tmp_cam_data.ortho_scale = float(SPEC.get("orthoScale") or 10.0)',
    '        else:',
    '            tmp_cam_data.type = "PERSP"',
    '            tmp_cam_data.lens = float(SPEC.get("lens") or 50.0)',
    '        tmp_cam_obj = bpy.data.objects.new("_agy_tmp_see_cam", tmp_cam_data)',
    '        scene.collection.objects.link(tmp_cam_obj)',
    '        eye = Vector(tuple(float(v) for v in SPEC["from"]))',
    '        tgt = Vector(tuple(float(v) for v in SPEC["lookAt"]))',
    '        fwd = tgt - eye',
    '        if fwd.length < 1e-6:',
    '            fwd = Vector((0.0, 1.0, 0.0))',
    '        tmp_cam_obj.location = eye',
    '        tmp_cam_obj.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()',
    '        scene.camera = tmp_cam_obj',
    '        view_context = False',
    '    else:',
    '        w = int(SPEC.get("width") or 1024)',
    '        h = int(SPEC.get("height") or 576)',
    '        view_context = True',
    '',
    '    r.resolution_x = w',
    '    r.resolution_y = h',
    '    r.resolution_percentage = 100',
    '    r.image_settings.file_format = "PNG"',
    '    r.filepath = OUT_PATH',
    '    with bpy.context.temp_override(window=win, area=area, region=reg, space_data=space):',
    '        bpy.ops.render.opengl(write_still=True, view_context=view_context)',
    '    meta["width"] = w',
    '    meta["height"] = h',
    '    meta["shading_used"] = space.shading.type',
    'finally:',
    '    r.resolution_x = old_res_x',
    '    r.resolution_y = old_res_y',
    '    r.resolution_percentage = old_res_pct',
    '    r.filepath = old_filepath',
    '    r.image_settings.file_format = old_fmt',
    '    scene.camera = old_cam',
    '    space.shading.type = old_shading',
    '    space.overlay.show_overlays = old_overlays',
    '    if tmp_cam_obj is not None:',
    '        bpy.data.objects.remove(tmp_cam_obj, do_unlink=True)',
    '    if tmp_cam_data is not None:',
    '        bpy.data.cameras.remove(tmp_cam_data, do_unlink=True)',
    '',
    'print(json.dumps({"ok": True, "meta": meta, "path": OUT_PATH}))',
  ].join('\n')
}

export async function macSafeCapture(
  client: GatewayClient,
  sessionId: string,
  spec: SafeCaptureSpec,
): Promise<ViewResult> {
  const t0 = Date.now()
  const outPath = path.join(
    os.tmpdir(),
    `agy-blender-see-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  )
  const code = buildSafeCapturePython(spec, outPath)
  try {
    const r = await client.postJson(
      '/act',
      { code, file: null, py: true, sessionId, waitMs: 2000 },
      120000,
    )
    if (r.ok !== true) {
      throw new Error(text(r.error || r.raw || 'safe capture /act failed'))
    }
    const stdout = text(r.stdout).trim()
    let meta: JsonRecord | null = null
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      if (parsed.meta && typeof parsed.meta === 'object') {
        meta = parsed.meta as JsonRecord
      }
    } catch {
      meta = null
    }
    if (!existsSync(outPath)) {
      throw new Error(`PNG output not written: ${outPath}`)
    }
    const buf = new Uint8Array(readFileSync(outPath))
    return {
      png: buf,
      ms: Date.now() - t0,
      meta,
      hash: createHash('md5').update(buf).digest('hex').slice(0, 8),
    }
  } finally {
    try {
      if (existsSync(outPath)) unlinkSync(outPath)
    } catch {
      // Ignore temp cleanup error
    }
  }
}
