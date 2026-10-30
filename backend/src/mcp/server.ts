import { McpServer } from '@modelcontextprotocol/server';
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
import { registerCharacterLibraryTools } from './tools/characterLibraryTools';
import { registerFileStoreTools } from './tools/fileStoreTools';
import { registerPluginTools } from './tools/pluginTools';
import { registerPluginAuthoringTools } from './tools/pluginAuthoringTools';
import { registerWorkspaceTools } from './tools/workspaceTools';
import { chatWorkspace } from '../services/codex-chat/chatWorkspace';
import { registerChatLinkedFileTools } from './tools/chatLinkedFileTools';
import { registerChatSettingsTools } from './tools/chatSettingsTools';
import { registerPostTools } from './tools/postTools';
import { registerEmoticonTools } from './tools/emoticonTools';
import { registerWallpaperTools } from './tools/wallpaperTools';
import { registerChatRoomTools } from './tools/chatRoomTools';
import { registerChatRoomListTools } from './tools/chatRoomListTools';
import { registerChatLoreTools } from './tools/chatLoreTools';
import { registerChatSetupTools } from './tools/chatSetupTools';
import { registerChatPageTools } from './tools/chatPageTools';
import { registerChatTaskTools } from './tools/chatTaskTools';
import { registerChatChoiceTools } from './tools/chatChoiceTools';
import { registerChatAgentTools } from './tools/chatAgentTools';
import { registerSpriteTools } from './tools/spriteTools';
import { registerImageResizeTools } from './tools/imageResizeTools';
import { registerAudioTools } from './tools/audioTools';
import { registerAudioGenerationTools } from './tools/audioGenerationTools';
import { registerAudioEditExportTools } from './tools/audioEditExportTools';
import { registerWebTools } from './tools/webTools';
import { registerExternalMcpTools } from './tools/externalMcpTools';
import { registerPluginServerTools } from './tools/pluginServerTools';
import { findPluginServerTool } from '../services/plugins/pluginServerTools';
import { isContextToolAllowed, requireMcpToolAccess } from './toolAccess';
import { ChatGenerationPresetStore } from '../services/codex-chat/chatGenerationPresets';
import { createToolCatalog, isDirectChatTool, type ToolCategoryId } from './toolCatalog';
import { registerAppGuideTools } from './tools/appGuideTools';

type ToolRegistrar = (server: McpServer, context: McpRequestContext) => void;
// Only names and registrar functions are shared; handlers and their account/workspace context are never cached.
const pluginToolRegistrars = new Map<string, ToolRegistrar>();



/**
 * MCP 서버 팩토리
 * 모든 Tool을 등록한 McpServer 인스턴스를 생성한다.
 * Stateless 방식에서는 요청마다 새 인스턴스를 생성한다.
 */
export function createMcpServer(context: McpRequestContext = { scopes: ALL_MCP_HTTP_SCOPES }): McpServer {
  context = { ...context, workspace: context.source === 'plugin' ? context.workspace : isChatMcpSource(context.source) ? context.workspace !== undefined ? context.workspace : chatWorkspace(context.requester, context.chatContext?.threadId, context.chatContext?.profileId) : undefined };
  const server = new McpServer({
    name: 'conai',
    version: '2.1.0',
  });

  const originalRegister = server.registerTool.bind(server) as (...toolArgs: unknown[]) => unknown;
  const registerDirect = (args: unknown[]) => { originalRegister(...args); };
  const singlePluginTool = context.source === 'plugin' && context.omitPluginTools && context.toolAllowlist?.length === 1
    ? context.toolAllowlist[0] : undefined;
  const selectedRegistrar = singlePluginTool
    ? findPluginServerTool(singlePluginTool) ? registerPluginServerTools
      : singlePluginTool.startsWith('workspace_') ? registerWorkspaceTools : pluginToolRegistrars.get(singlePluginTool)
    : undefined;
  let currentRegistrar: ToolRegistrar | undefined;
  const registerSelected = (registrar: ToolRegistrar) => {
    if (selectedRegistrar && selectedRegistrar !== registrar) return;
    currentRegistrar = registrar;
    try { registrar(server, context); } finally { currentRegistrar = undefined; }
  };
  // Chat agents get the app tools as a table of contents (toolCatalog.ts); other clients list every tool.
  const catalog = !context.research && isChatMcpSource(context.source) && context.toolCatalog !== false ? createToolCatalog(server, registerDirect, context.toolCatalogBudget, context.chatContext, context.source === 'codex-chat' && !!context.chatContext?.page) : null;
  let category: ToolCategoryId = 'chat';
  const inCategory = (id: ToolCategoryId, register: () => void) => { category = id; register(); category = 'chat'; };
  if (isChatMcpSource(context.source) && context.generationPresetSnapshot === undefined) context.generationPresetSnapshot = JSON.stringify(ChatGenerationPresetStore.resolve(context.generationPresetIds ?? []));
  server.registerTool = ((...args: unknown[]) => {
    const toolName = typeof args[0] === 'string' ? args[0] : '';
    if (context.source === 'plugin' && currentRegistrar && currentRegistrar !== registerPluginServerTools && currentRegistrar !== registerExternalMcpTools) {
      pluginToolRegistrars.set(toolName, currentRegistrar);
    }
    if (!isContextToolAllowed(context, toolName)) return undefined;
    const handler = args[args.length - 1];
    if (typeof handler === 'function' && (isChatMcpSource(context.source) || context.requester || context.keyGroup !== undefined)) {
      args[args.length - 1] = async (...input: unknown[]) => {
        try {
          if (context.research && context.source === 'codex-chat') {
            context.research.validateSources(context.requester!, context.chatContext!.profileId);
            if (!context.research.takeTool()) throw new Error('A summary has no tools. Answer only from the text already supplied.');
          }
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
    catalog?.add(toolName, category, args, true);
    return originalRegister(...args);
  }) as typeof server.registerTool;

  inCategory('prompts', () => {
    registerSelected(registerPromptTools);
    registerSelected(registerPromptPresetTools);
    registerSelected(registerPromptOrganizationTools);
    registerSelected(registerResourceTools);
  });
  inCategory('characters', () => registerSelected(registerCharacterLibraryTools));
  inCategory('generation', () => {
    registerSelected(registerGenerationTools);
    registerSelected(registerChatGenerationTools);
  });
  inCategory('workflows', () => {
    registerSelected(registerGraphWorkflowTools);
    registerSelected(registerWorkflowTransferTools);
  });
  inCategory('images', () => {
    registerSelected(registerImageTools);
    registerSelected(registerImageResizeTools);
  });
  inCategory('files', () => registerSelected(registerFileStoreTools));
  inCategory('files', () => registerSelected(registerWorkspaceTools));
  if (!context.omitPluginTools) inCategory('files', () => registerSelected(registerPluginTools));
  if (!context.omitPluginTools) inCategory('plugins', () => registerSelected(registerPluginAuthoringTools));
  inCategory('posts', () => registerSelected(registerPostTools));
  inCategory('image_groups', () => registerSelected(registerImageGroupTools));
  inCategory('emoticons', () => registerSelected(registerEmoticonTools));
  inCategory('wallpaper', () => registerSelected(registerWallpaperTools));
  inCategory('audio', () => {
    registerSelected(registerAudioTools);
    registerSelected(registerAudioGenerationTools);
    registerSelected(registerAudioEditExportTools);
  });
  registerSelected(registerChatRoomTools);
  registerSelected(registerChatRoomListTools);
  registerSelected(registerChatTaskTools);
  registerSelected(registerChatChoiceTools);
  registerSelected(registerChatAgentTools);
  registerSelected(registerChatLoreTools);
  registerSelected(registerChatLinkedFileTools);
  registerSelected(registerChatSettingsTools);
  inCategory('chat_setup', () => registerSelected(registerChatSetupTools));
  registerSelected(registerChatPageTools);
  inCategory('sprite', () => registerSelected(registerSpriteTools));
  inCategory('web', () => registerSelected(registerWebTools));
  inCategory('external', () => registerSelected(registerExternalMcpTools));
  inCategory('plugins', () => registerSelected(registerPluginServerTools));
  inCategory('guide', () => registerSelected(registerAppGuideTools));
  catalog?.install();

  return server;
}
