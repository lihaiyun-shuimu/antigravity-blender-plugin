import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GatewayClient } from '../gateway-client.js'

export function registerSceneResources(server: McpServer, client: GatewayClient): void {
  server.resource(
    'gateway-doctor',
    'blender://gateway/doctor',
    {
      description: 'Read-only DSH Blender Gateway health, connected Blender 4.5 LTS instances, protocol version, and readiness diagnostics.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const ready = await client.ensureReady()
      if (!ready) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  ok: false,
                  kind: 'gateway_unreachable',
                  gateway: client.manager.baseUrl(),
                  hint: 'Gateway could not be reached or started.',
                },
                null,
                2,
              ),
            },
          ],
        }
      }
      const doctor = await client.getJson('/doctor', 30000)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(doctor, null, 2),
          },
        ],
      }
    },
  )

  server.resource(
    'scene-summary',
    'blender://scene/summary',
    {
      description: 'Read-only summary of the active Blender scene (objects, collections, cameras, materials) without mutating scene state.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const ready = await client.ensureReady()
      if (!ready) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ ok: false, error: 'gateway_unreachable' }, null, 2),
            },
          ],
        }
      }
      const [sceneRes, colRes] = await Promise.all([
        client.postJson('/cmd', { name: 'get_scene_info', params: {}, timeoutMs: 20000 }, 30000),
        client.postJson('/cmd', { name: 'get_collections', params: {}, timeoutMs: 20000 }, 30000),
      ])
      const payload = {
        ok: sceneRes.ok === true,
        scene: sceneRes.result ?? sceneRes,
        collections: colRes.ok === true ? colRes.result : null,
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      }
    },
  )
}
