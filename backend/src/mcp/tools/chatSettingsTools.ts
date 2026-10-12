import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { chatSettingsView, proposeChatSettings } from '../../services/codex-chat/chatSettingsProposals';
import type { McpRequestContext } from '../context';

export const GET_CHAT_SETTINGS_TOOL = 'get_chat_settings';
export const PROPOSE_CHAT_SETTINGS_TOOL = 'propose_chat_settings';

/**
 * How the chat's user-side features work, for a model asked "how do I…" inside a chat. The screens are named as the
 * Korean UI names them; keep this in step with docs/GUIDE/CHAT.md.
 */
export const CHAT_FEATURES_GUIDE = [
  'CHAT FEATURES the user can use (UI names in Korean, as the app shows them)',
  '- Scene narration: a line of the user\'s message that starts with `$` is narration written as the narrator (events of the scene, not the user\'s character). `$$` at the start writes a literal `$`. The model receives such lines tagged [나레이션].',
  '- Orders from a reply: a character reply\'s ⋯ menu has 이 장면 그리기, 이미지 다시 그리기 (a reply with an image), 목소리·소리 만들기, 로어로 남기기 and 다음 선택지 만들기 (1:1, last reply only). Each shows only when the profile can use that tool; the result is added to that reply, no new message. 여기서 분기 in the same menu starts a branch chat from that message.',
  '- File versions: when a reply creates or edits a file-store file, file chips appear under it; the name opens the file with its version history, ↶ undoes that reply\'s change. In the file store preview, the clock icon (버전 기록) shows diffs and 이 버전으로 되돌리기.',
  '- Record book: save_lore writes to one book per chat (pen mark in 컨텍스트 › 로어북). Default is the chat\'s own book; 📖+ → 새 로어북 만들기… makes an account book that becomes the record book; a linked book\'s ⋯ → 여기에 기록 / 이 채팅에 기록 switches. propose_chat_settings can change it too.',
  '- Linked files: 컨텍스트 › 연결 파일 (folder+ icon) links file-store folders, text files, PDFs or XLSX documents (PDF/XLSX content is read-only); new links are read-only, ⋯ → 쓰기 허용 lets the character write. Profile-wide links are in the profile editor › 기억 tab. Lorebook folders cannot be linked. propose_chat_settings can change the chat\'s links.',
  '- Minutes (회의록): with the summary on (1:1 API LLM chats and rooms), 컨텍스트 › 대화 요약 › 회의록 picks a writable linked folder; each new summary stretch is appended to <folder>/회의록/<date>.md. propose_chat_settings can set it.',
  '- Web research: an administrator turns it on in 설정 › LLM › 웹 (웹 검색 담당: Codex or Claude Code, optional daily limit per account). Accounts need the 채팅 웹 검색 permission (chat.web.use); the profile\'s tool scopes must include read. Then web_search / web_read appear.',
  '- Outside MCP tools: an administrator connects other MCP servers in 설정 › LLM › 외부 MCP; their tools appear as x_<server>_<tool> and can be picked in the profile\'s tool list (외부 MCP group).',
  '- Other: 컨텍스트 holds context turns, author\'s note, summary (지금 요약) and lorebooks per chat; ⋯ → 채팅 모양 changes how the chat looks for the reader; Ctrl+V or drop puts files into the composer.',
].join('\n');

/**
 * The chat's own settings: read them and propose changes as a card the chat's owner saves. Offered in every chat
 * (scope-free like the room tools), only behind the tool catalog (`chat`), never as direct definitions.
 */
export function registerChatSettingsTools(server: McpServer, context: McpRequestContext): void {
  if (!context.chatContext) return;
  server.registerTool(GET_CHAT_SETTINGS_TOOL, {
    description: 'Read this chat\'s own settings: linked account lorebooks and the record book (where save_lore writes), linked file-store folders and files (its own and its profiles\'), the minutes folder and the folders it could use.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(chatSettingsView(context.chatContext!.threadId)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  server.registerTool(PROPOSE_CHAT_SETTINGS_TOOL, {
    description: 'Propose changes to this chat\'s own settings as a before/after card; nothing changes until the user presses 저장. Give only what changes: lorebook_ids (the full list of the owner\'s account lorebooks linked to this chat), record_book_id (one of those, or null for this chat\'s own book), linked_files (the full list of the chat\'s own links: [{ id, write }], ids from list_files / search_files / get_chat_settings; folders, text files, PDFs or XLSX documents (PDF/XLSX content is read-only), not inside 로어북/), minutes_folder_id (a folder linked with write: true, or null to stop). get_chat_settings shows current values and choices.',
    inputSchema: z.object({
      lorebook_ids: z.array(z.number().int().positive()).max(20).optional(),
      record_book_id: z.number().int().positive().nullable().optional(),
      linked_files: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), write: z.boolean().default(false) })).max(20).optional(),
      minutes_folder_id: z.string().regex(/^[a-f0-9]{32}$/).nullable().optional(),
    }),
  }, async (args) => {
    try {
      const chatContext = context.chatContext;
      if (!chatContext?.replyId) throw new Error('Proposals need an active chat reply.');
      const proposal = proposeChatSettings(chatContext, args);
      const changed = proposal.kind === 'chat_settings' ? Object.keys(proposal.patch) : [];
      return { content: [{ type: 'text' as const, text: JSON.stringify({ proposalId: proposal.id, changed, note: 'The card is shown to the user; nothing is saved until they press 저장.' }) }], structuredContent: { proposal } };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
}
