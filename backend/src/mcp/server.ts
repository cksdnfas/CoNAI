import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPromptTools } from './tools/promptTools';
import { registerGenerationTools } from './tools/generationTools';
import { registerImageTools } from './tools/imageTools';
import { registerResourceTools } from './tools/resourceTools';
import { registerPromptOrganizationTools } from './tools/promptOrganizationTools';
import { registerGraphWorkflowTools } from './tools/graphWorkflowTools';
import { ALL_MCP_HTTP_SCOPES, isMcpToolAllowed, type McpRequestContext } from './context';
import { registerWorkflowTransferTools } from './tools/workflowTransferTools';

/**
 * MCP 서버 팩토리
 * 모든 Tool을 등록한 McpServer 인스턴스를 생성한다.
 * Stateless 방식에서는 요청마다 새 인스턴스를 생성한다.
 */
export function createMcpServer(context: McpRequestContext = { scopes: ALL_MCP_HTTP_SCOPES }): McpServer {
  const server = new McpServer({
    name: 'conai',
    version: '2.1.0',
  });

  const originalTool = server.tool.bind(server);
  (server as McpServer & { tool: typeof server.tool }).tool = ((...args: unknown[]) => {
    const toolName = typeof args[0] === 'string' ? args[0] : '';
    if (!isMcpToolAllowed(toolName, context.scopes)) {
      return undefined;
    }
    return (originalTool as (...toolArgs: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  registerPromptTools(server);
  registerGenerationTools(server, context);
  registerGraphWorkflowTools(server, context);
  registerImageTools(server, context);
  registerResourceTools(server);
  registerPromptOrganizationTools(server);
  registerWorkflowTransferTools(server);

  return server;
}
