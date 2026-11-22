import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { GatewayClient } from './gateway-client.js'
import { GatewayManager } from './gateway-manager.js'
import { registerSceneResources } from './resources/scene-resources.js'
import { registerApiLookupTool } from './tools/api-lookup.js'
import { registerCoreTools } from './tools/core-tools.js'
import { registerLookdevPresetTool } from './tools/lookdev-preset.js'

async function main(): Promise<void> {
  const gatewayManager = new GatewayManager()
  const gatewayClient = new GatewayClient(gatewayManager)

  const server = new McpServer({
    name: 'antigravity-blender',
    version: '1.0.0',
  })

  registerCoreTools(server, gatewayClient)
  registerApiLookupTool(server, gatewayClient)
  registerLookdevPresetTool(server, gatewayClient)
  registerSceneResources(server, gatewayClient)

  const cleanup = (signal: string) => {
    console.error(`[dsh-blender-mcp] Received ${signal}, cleaning up...`)
    gatewayManager.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => cleanup('SIGINT'))
  process.on('SIGTERM', () => cleanup('SIGTERM'))
  process.on('exit', () => {
    gatewayManager.stop()
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[dsh-blender-mcp] Stdio MCP server ready (gateway target: ${gatewayManager.baseUrl()})`)
}

main().catch((err) => {
  console.error('[dsh-blender-mcp] Fatal startup error:', err)
  process.exit(1)
})
