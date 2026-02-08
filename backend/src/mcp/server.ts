import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPromptTools } from './tools/promptTools';
import { registerGenerationTools } from './tools/generationTools';
import { registerImageTools } from './tools/imageTools';

/**
 * MCP 서버 팩토리
 * 모든 Tool을 등록한 McpServer 인스턴스를 생성한다.
 * Stateless 방식에서는 요청마다 새 인스턴스를 생성한다.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'comfyui-image-manager',
    version: '2.1.0',
  });

  registerPromptTools(server);
  registerGenerationTools(server);
  registerImageTools(server);

  return server;
}
