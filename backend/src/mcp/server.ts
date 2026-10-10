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
import { registerPostTools } from './tools/postTools';
import { registerEmoticonTools } from './tools/emoticonTools';
import { registerChatRoomTools } from './tools/chatRoomTools';
import { registerChatLoreTools } from './tools/chatLoreTools';
import { registerChatSetupTools } from './tools/chatSetupTools';
import { registerChatPageTools } from './tools/chatPageTools';
import { registerChatTaskTools } from './tools/chatTaskTools';
import { registerChatChoiceTools } from './tools/chatChoiceTools';
import { registerSpriteTools } from './tools/spriteTools';
import { registerImageResizeTools } from './tools/imageResizeTools';
import { registerAudioTools } from './tools/audioTools';
import { registerAudioGenerationTools } from './tools/audioGenerationTools';
import { registerAudioEditExportTools } from './tools/audioEditExportTools';
import { isContextToolAllowed, requireMcpToolAccess } from './toolAccess';
import { ChatGenerationPresetStore } from '../services/codex-chat/chatGenerationPresets';
import { createToolCatalog, isDirectChatTool, type ToolCategoryId } from './toolCatalog';



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
  const registerDirect = (args: unknown[]) => { (originalTool as (...toolArgs: unknown[]) => unknown)(...args); };
  // Chat agents get the app tools as a table of contents (toolCatalog.ts); other clients list every tool.
  const catalog = isChatMcpSource(context.source) ? createToolCatalog(server, registerDirect) : null;
  let category: ToolCategoryId = 'chat';
  const inCategory = (id: ToolCategoryId, register: () => void) => { category = id; register(); category = 'chat'; };
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
    if (catalog && !isDirectChatTool(context, toolName)) {
      catalog.add(toolName, category, args);
      return undefined;
    }
    return (originalTool as (...toolArgs: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  inCategory('prompts', () => {
    registerPromptTools(server);
    registerPromptPresetTools(server);
    registerPromptOrganizationTools(server);
    registerResourceTools(server);
  });
  inCategory('generation', () => {
    registerGenerationTools(server, context);
    registerChatGenerationTools(server, context);
  });
  inCategory('workflows', () => {
    registerGraphWorkflowTools(server, context);
    registerWorkflowTransferTools(server);
  });
  inCategory('images', () => {
    registerImageTools(server, context);
    registerImageResizeTools(server, context);
  });
  inCategory('files', () => registerFileStoreTools(server, context));
  inCategory('posts', () => registerPostTools(server, context));
  inCategory('image_groups', () => registerImageGroupTools(server, context));
  inCategory('emoticons', () => registerEmoticonTools(server, context));
  inCategory('audio', () => {
    registerAudioTools(server, context);
    registerAudioGenerationTools(server, context);
    registerAudioEditExportTools(server, context);
  });
  registerChatRoomTools(server, context);
  registerChatTaskTools(server, context);
  registerChatChoiceTools(server, context);
  registerChatLoreTools(server, context);
  inCategory('chat_setup', () => registerChatSetupTools(server, context));
  registerChatPageTools(server, context);
  inCategory('sprite', () => registerSpriteTools(server, context));
  catalog?.install();

  return server;
}
