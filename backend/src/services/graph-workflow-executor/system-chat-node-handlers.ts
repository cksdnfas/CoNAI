import {
  executeGenerateWithChatPresetNode,
  executeLoadChatProfileNode,
  executePostToBoardNode,
  executePostToChatRoomNode,
  executeSearchLorebookNode,
  executeWakeChatRoomNode,
} from './system-chat-operations'
import type { SystemOperationHandler } from './system-operation-handler'

/** Handlers of the chat-data nodes in BUILTIN_CHAT_NODE_DEFINITIONS, keyed by operation key. */
export const CHAT_NODE_HANDLERS: Record<string, SystemOperationHandler> = {
  'system.load_chat_profile': executeLoadChatProfileNode,
  'system.generate_with_chat_preset': executeGenerateWithChatPresetNode,
  'system.search_lorebook': executeSearchLorebookNode,
  'system.post_to_chat_room': executePostToChatRoomNode,
  'system.wake_chat_room': executeWakeChatRoomNode,
  'system.post_to_board': executePostToBoardNode,
}
