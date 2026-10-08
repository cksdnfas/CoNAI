import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPromptTools } from './tools/promptTools';
import { registerGenerationTools } from './tools/generationTools';
import { registerImageTools } from './tools/imageTools';
import { registerImageGroupTools } from './tools/imageGroupTools';
import { registerResourceTools } from './tools/resourceTools';
import { registerPromptOrganizationTools } from './tools/promptOrganizationTools';
import { registerGraphWorkflowTools } from './tools/graphWorkflowTools';
import { ALL_MCP_HTTP_SCOPES, isChatMcpSource, type McpRequestContext } from './context';
import { registerChatGenerationTools } from './tools/chatGenerationTools';
import { registerWorkflowTransferTools } from './tools/workflowTransferTools';
import { registerPromptPresetTools } from './tools/promptPresetTools';
import { registerFileStoreTools } from './tools/fileStoreTools';
import { registerEmoticonTools } from './tools/emoticonTools';
import { registerChatRoomTools } from './tools/chatRoomTools';
import { registerChatLoreTools } from './tools/chatLoreTools';
import { registerChatSetupTools } from './tools/chatSetupTools';
import { registerChatPageTools } from './tools/chatPageTools';
import { registerAudioTools } from './tools/audioTools';
import { registerAudioGenerationTools } from './tools/audioGenerationTools';
import { isContextToolAllowed, requireMcpToolAccess } from './toolAccess';
import { ChatGenerationPresetStore } from '../services/codex-chat/chatGenerationPresets';



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
  if (isChatMcpSource(context.source) && context.generationPresetSnapshot === undefined) context.generationPresetSnapshot = JSON.stringify(ChatGenerationPresetStore.resolve(context.generationPresetIds ?? []));
  (server as McpServer & { tool: typeof server.tool }).tool = ((...args: unknown[]) => {
    const toolName = typeof args[0] === 'string' ? args[0] : '';
    if (!isContextToolAllowed(context, toolName)) return undefined;
    const handler = args[args.length - 1];
    if (typeof handler === 'function' && (isChatMcpSource(context.source) || context.requester)) {
      args[args.length - 1] = async (...input: unknown[]) => {
        try {
          requireMcpToolAccess(context, toolName, input[0] as Record<string, unknown> | undefined);
        }
        catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
        return handler(...input);
      };
    }
    return (originalTool as (...toolArgs: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  registerPromptTools(server);
  registerPromptPresetTools(server);
  registerGenerationTools(server, context);
  registerChatGenerationTools(server, context);
  registerGraphWorkflowTools(server, context);
  registerImageTools(server, context);
  registerFileStoreTools(server, context);
  registerImageGroupTools(server);
  registerEmoticonTools(server, context);
  registerAudioTools(server, context);
  registerAudioGenerationTools(server, context);
  registerResourceTools(server);
  registerPromptOrganizationTools(server);
  registerWorkflowTransferTools(server);
  registerChatRoomTools(server, context);
  registerChatLoreTools(server, context);
  registerChatSetupTools(server, context);
  registerChatPageTools(server, context);

  return server;
}
