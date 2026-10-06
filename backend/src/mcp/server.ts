import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPromptTools } from './tools/promptTools';
import { registerGenerationTools } from './tools/generationTools';
import { registerImageTools } from './tools/imageTools';
import { registerImageGroupTools } from './tools/imageGroupTools';
import { registerResourceTools } from './tools/resourceTools';
import { registerPromptOrganizationTools } from './tools/promptOrganizationTools';
import { registerGraphWorkflowTools } from './tools/graphWorkflowTools';
import { ALL_MCP_HTTP_SCOPES, CHAT_BLOCKED_TOOLS, CHAT_ROOM_TOOLS, GENERATION_PRESET_BLOCKED_TOOLS, isChatGenerationTool, isChatMcpSource, isMcpToolAllowed, type McpRequestContext } from './context';
import { registerChatGenerationTools } from './tools/chatGenerationTools';
import { registerWorkflowTransferTools } from './tools/workflowTransferTools';
import { registerPromptPresetTools } from './tools/promptPresetTools';
import { registerFileStoreTools } from './tools/fileStoreTools';
import { registerEmoticonTools } from './tools/emoticonTools';
import { registerChatRoomTools } from './tools/chatRoomTools';
import { registerChatLoreTools } from './tools/chatLoreTools';
import { registerChatSetupTools } from './tools/chatSetupTools';
import { requireActiveChatReply } from '../services/codex-chat/chatReplyRegistry';

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
  const presetMode = (context.generationPresetIds?.length ?? 0) > 0;
  (server as McpServer & { tool: typeof server.tool }).tool = ((...args: unknown[]) => {
    const toolName = typeof args[0] === 'string' ? args[0] : '';
    const allowed = CHAT_ROOM_TOOLS.has(toolName)
      ? Boolean(context.chatContext) && (context.chatRoomTools === 'all' || (context.chatRoomTools === 'call' && ['room_call_member', 'chat_reply_to'].includes(toolName))) && (toolName !== 'room_call_member' || context.chatContext?.kind === 'group')
      : isChatGenerationTool(toolName)
        ? presetMode && context.scopes.includes('generate')
        : isMcpToolAllowed(toolName, context.scopes)
          && (!context.toolAllowlist || context.toolAllowlist.includes(toolName))
          && !(presetMode && GENERATION_PRESET_BLOCKED_TOOLS.has(toolName))
          && !(isChatMcpSource(context.source) && CHAT_BLOCKED_TOOLS.has(toolName));
    if (!allowed) {
      return undefined;
    }
    const handler = args[args.length - 1];
    if (context.chatContext && typeof handler === 'function') {
      args[args.length - 1] = async (...input: unknown[]) => {
        try { requireActiveChatReply(context.chatContext); }
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
  registerResourceTools(server);
  registerPromptOrganizationTools(server);
  registerWorkflowTransferTools(server);
  registerChatRoomTools(server, context);
  registerChatLoreTools(server, context);
  registerChatSetupTools(server, context);

  return server;
}
