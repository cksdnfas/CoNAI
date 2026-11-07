import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { chatSettingsView, proposeChatSettings } from '../../services/codex-chat/chatSettingsProposals';
import type { McpRequestContext } from '../context';
import { errorResult, textResult } from '../toolResults';

export const GET_CHAT_SETTINGS_TOOL = 'get_chat_settings';
export const PROPOSE_CHAT_SETTINGS_TOOL = 'propose_chat_settings';
const chatModelFields = {
  chatModelSlotId: z.union([z.number(), z.literal('')]).nullable().optional(),
  chatModel: z.string().nullable().optional(),
};

/**
 * How the chat's user-side features work, for a model asked "how do I…" inside a chat. The screens are named as the
 * Korean UI names them; keep this in step with docs/GUIDE/CHAT.md.
 */
export const CHAT_FEATURES_GUIDE = [
  'CHAT FEATURES the user can use (UI names in Korean, as the app shows them)',
  '- Chat model: 컨텍스트 changes only this chat\'s model (in a group, each member separately), never the shared profile or engine. get_chat_settings shows the effective label, the profile\'s own label and selectable API LLM slots. propose_chat_settings uses chatModelSlotId for API LLM or chatModel for a Claude Code/Codex model name; null (or an empty name) follows the profile again. In rooms use memberChatModels keyed by profile id, with those same fields. The user must save the card; member changes apply to that member\'s next reply.',
  '- Scene narration: a line of the user\'s message that starts with `$` is narration written as the narrator (events of the scene, not the user\'s character). `$$` at the start writes a literal `$`. The model receives such lines tagged [Narration].',
  '- Orders from a reply: a character reply\'s ⋯ menu has 이 장면 그리기, 이미지 다시 그리기 (a reply with an image), 목소리·소리 만들기, 로어로 남기기 and 다음 선택지 만들기 (1:1, last reply only). Each shows only when the profile can use that tool; the result is added to that reply, no new message. 여기서 분기 in the same menu starts a branch chat from that message.',
  '- File versions: when a reply creates or edits a file-store file, file chips appear under it; the name opens the file with its version history, ↶ undoes that reply\'s change. In the file store preview, the clock icon (버전 기록) shows diffs and 이 버전으로 되돌리기.',
  '- Record book: save_lore writes to one book per chat (pen mark in 컨텍스트 › 로어북). Default is the chat\'s own book; 📖+ → 새 로어북 만들기… makes an account book that becomes the record book; a linked book\'s ⋯ → 여기에 기록 / 이 채팅에 기록 switches. propose_chat_settings can change it too.',
  '- Linked files: 컨텍스트 › 연결 파일 (folder+ icon) links file-store folders, text files, images, PDFs or XLSX documents (PDF/XLSX content is read-only; images are looked at with linked_view by a model that sees images); new links are read-only, ⋯ → 쓰기 허용 lets the character write. Profile-wide links and the profile\'s default project workspace are in the profile editor › 참고 자료 tab; a 1:1 or group chat can add more workspaces, change the access to one or turn off one the profile brings under 컨텍스트 › 작업 공간. Lorebook folders cannot be linked. propose_chat_settings can change the chat\'s links.',
  '- Skills (스킬): task instructions an administrator writes under 자원 › 프리셋 › 스킬 (or saves from a propose_skill card) and links in the profile editor › 도구 tab. The character sees each linked skill\'s name and description and loads its instructions with use_skill when a request fits.',
  '- Minutes (회의록): with the summary on (1:1 API LLM chats and rooms), 컨텍스트 › 대화 요약 › 회의록 picks a writable linked folder; each new summary stretch is appended to <folder>/회의록/<date>.md. propose_chat_settings can set it.',
  '- Web research: an administrator turns it on in 설정 › LLM › 웹 (웹 검색 담당: Codex or Claude Code, optional daily limit per account). Accounts need the 채팅 웹 검색 permission (chat.web.use); the profile\'s tool scopes must include read. Then web_search / web_read appear.',
  '- Outside MCP tools: an administrator connects other MCP servers in 설정 › LLM › 외부 MCP; their tools appear as x_<server>_<tool> and can be picked in the profile\'s tool list (외부 MCP group).',
  '- Other: 컨텍스트 holds context turns, author\'s note, summary (지금 요약) and lorebooks per chat; ⋯ → 채팅 모양 changes how the chat looks for the reader; Ctrl+V or drop puts files into the composer.',
].join('\n');

/**
 * The chat's own settings: read them and propose changes as a card the chat's owner saves. Offered in every chat
 * (scope-free like the room tools), behind the tool catalog (`chat`) when the chat has one and as direct definitions
 * when it has too few app tools for a catalog.
 */
export function registerChatSettingsTools(server: McpServer, context: McpRequestContext): void {
  if (!context.chatContext) return;
  server.registerTool(GET_CHAT_SETTINGS_TOOL, {
    description: 'Read this chat\'s own settings: its chat model (or each member\'s model in a room), effective and profile labels, selectable API LLM slots; linked account lorebooks and the record book (where save_lore writes), linked file-store folders and files (its own and its profiles\'), the minutes folder and the folders it could use. Claude Code/Codex use a model name, not a slot; CLI model catalogs are not listed.',
    inputSchema: z.object({}),
  }, async () => {
    try {
      return textResult(chatSettingsView(context.chatContext!.threadId));
    } catch (error) {
      return errorResult(error);
    }
  });
  server.registerTool(PROPOSE_CHAT_SETTINGS_TOOL, {
    description: 'Propose changes to this chat\'s own settings as a before/after card; nothing changes until the user presses 저장. Give only what changes: chatModelSlotId (direct API LLM chat, a selectable slot id), chatModel (direct Claude Code/Codex chat, model name), or memberChatModels (group only, object keyed by profile id containing chatModelSlotId or chatModel). Null or an empty name restores the profile model; never edits the shared profile or switches engines. Other keys: lorebook_ids (the full list of the owner\'s account lorebooks linked to this chat), record_book_id (one of those, or null for this chat\'s own book), linked_files (the full list of the chat\'s own links: [{ id, write }], ids from list_files / search_files / get_chat_settings; folders, text files, PDFs or XLSX documents (PDF/XLSX content is read-only), not inside 로어북/), minutes_folder_id (a folder linked with write: true, or null to stop). get_chat_settings shows current values and choices.',
    inputSchema: z.object({
      ...chatModelFields,
      memberChatModels: z.record(z.string(), z.object(chatModelFields)).optional(),
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
      return textResult({ proposalId: proposal.id, changed, note: 'The card is shown to the user; nothing is saved until they press 저장.' }, { structuredContent: { proposal } });
    } catch (error) {
      return errorResult(error);
    }
  });
}
