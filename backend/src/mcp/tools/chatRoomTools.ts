import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { userPersonaForThread } from '../../services/codex-chat/chatUserProfiles';
import { CodexChatStore, parseMessageRouting } from '../../services/codex-chat/codexChatStore';
import { routeChatReply, requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry';
import { ChatGroupStore } from '../../services/codex-chat/chatGroupStore';
import { resolveMemberName } from '../../services/codex-chat/groupChatContext';
import { buildReplyContext } from '../../services/codex-chat/chatReplyContext';
import { type HistorySearchStatus, connectedThreadIds, HISTORY_SEARCH_LIMIT, searchChatHistory, sharesKnowledge } from '../../services/codex-chat/chatHistorySearch';
import type { McpRequestContext } from '../context';

const MESSAGE_TEXT_LIMIT = 2000;

type RoomMessageRow = { id: number; role: 'user' | 'assistant'; speaker_profile_id: number | null; content: string; created_date: string; routing: string | null };

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

/** The caller's own chat (a group room or a direct chat) the reply is in, or an error the model can read. */
function requireRoom(context: McpRequestContext, roomId: number) {
  if (context.chatContext?.threadId !== roomId) throw new Error('Only the current chat room is accessible.');
  requireActiveChatReply(context.chatContext);
  const thread = CodexChatStore.findThread(roomId, context.requester?.accountId ?? null);
  if (!thread) throw new Error(`Chat room not found: ${roomId}`);
  return thread;
}

function speakerName(row: RoomMessageRow, names: Map<number, string>, userName: string) {
  if (row.role === 'user') return userName;
  if (row.speaker_profile_id === null) return '어시스턴트';
  if (!names.has(row.speaker_profile_id)) names.set(row.speaker_profile_id, ChatProfileStore.find(row.speaker_profile_id)?.name ?? '(삭제된 프로필)');
  return names.get(row.speaker_profile_id) as string;
}

/**
 * A direct chat's reply already answers (and quotes) the latest user message, so chat_reply_to there only quotes an
 * older one. It is still offered from the first message on: a tool list that grows on the second message would make a
 * local server or a provider cache read the whole prompt again, and the tool says it is for older messages.
 */
export function offersChatReplyTo(_context: McpRequestContext) {
  return true;
}

/**
 * Chat tools for chat agents in a chat the caller owns: quote an earlier message, call another member (group rooms),
 * and search and read the chat's history and that of the chats connected to it (see chatHistorySearch).
 */
export function registerChatRoomTools(server: McpServer, context: McpRequestContext): void {
  if (offersChatReplyTo(context)) registerChatReplyTo(server, context);
  registerRoomTools(server, context);
}

function registerChatReplyTo(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'chat_reply_to',
    { description: 'Set the quote and recipients of the reply you are writing. message_id: the message to quote (omit to keep the current quote). to: exact member profile IDs, "user" (address the human) or "room" (announce without waking anyone); replaces earlier recipients. The app shows the quote; do not repeat it. Sender and room are server-controlled.', inputSchema: z.object({
      message_id: z.number().int().positive().optional(),
      to: z.array(z.union([z.number().int().positive(), z.literal('user'), z.literal('room')])).min(1).max(6).optional(),
    }) },
    async ({ message_id, to }) => {
      try {
        if (message_id === undefined && to === undefined) throw new Error('Choose a message_id or to recipient.');
        requireRoom(context, context.chatContext?.threadId ?? 0);
        const routing = routeChatReply(context.chatContext, { messageId: message_id, recipients: to });
        return textResult({ reply_to: routing.replyTo?.messageId ?? null, to: routing.recipients, context: message_id ? buildReplyContext(CodexChatStore.listMessages(context.chatContext!.threadId), routing, { group: context.chatContext?.kind === 'group' }) : undefined, note: 'Recipients are accepted. Finish your own reply; delivery happens after it is saved.' });
      } catch (error) { return errorResult(error); }
    },
  );
}

function registerRoomTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'room_call_member',
    { description: 'Ask other members of the group chat room you are in to answer right after you. Use their exact names from the room header (not translated). They write their own answers; do not write them yourself.', inputSchema: z.object({
      room_id: z.number().int().positive().describe('Group room id from the room header'),
      names: z.array(z.string().trim().min(1).max(60)).min(1).max(6).describe('Member names exactly as listed in the room header'),
    }) },
    async ({ room_id, names }) => {
      try {
        const thread = requireRoom(context, room_id);
        if (thread.kind !== 'group') throw new Error('Calling members is only available in group rooms.');
        const members = ChatGroupStore.members(room_id).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? []);
        const ids = names.map((name) => resolveMemberName(name, members));
        if (ids.some((id) => id === null)) throw new Error(`Unknown member. Use: ${members.map((member) => member.name).join(', ')}`);
        routeChatReply(context.chatContext, { recipients: ids as number[] });
        return textResult({
          called: names,
          note: 'They will answer right after your reply is posted, in their own message. Do not guess or describe their answer, and do not say they did not answer; just finish your own lines.',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // A room always reads its history; a direct chat only when it works with shared knowledge (see sharesKnowledge).
  const chat = context.chatContext;
  if (chat && chat.kind !== 'group') {
    const thread = CodexChatStore.findThread(chat.threadId, context.requester?.accountId ?? null);
    if (!thread || !sharesKnowledge(thread)) return;
  }

  server.registerTool(
    'room_history_search',
    { description: 'Search earlier messages of this chat (the room you are in), or with chats:"connected" the other chats that share a lorebook or linked folder with it (the same project). Returns chat and message ids, speakers and excerpts, best matches first. Use it only when what you need is not in your context.', inputSchema: z.object({
      room_id: z.number().int().positive().optional().describe('This chat or room id (default: the current one)'),
      query: z.string().trim().min(1).max(200).describe('What to find: messages with all these words (case-insensitive; a "quoted phrase" as written) come first, and related wording also matches when semantic search is on'),
      chats: z.enum(['this', 'connected']).optional().describe('this (default): only this chat; connected: the chats sharing a lorebook or linked folder with it'),
      limit: z.number().int().min(1).max(HISTORY_SEARCH_LIMIT).optional().describe('Max results (default 10)'),
    }) },
    async ({ room_id, query, chats, limit }) => {
      try {
        const thread = requireRoom(context, room_id ?? context.chatContext?.threadId ?? 0);
        const accountId = context.requester?.accountId ?? null;
        const connected = chats === 'connected' ? connectedThreadIds(thread.id, accountId) : [];
        if (chats === 'connected' && connected.length === 0) return textResult({ results: [], note: 'No other chat shares a lorebook or linked folder with this one.' });
        let searchStatus: HistorySearchStatus | undefined;
        const hits = await searchChatHistory(chats === 'connected' ? connected : [thread.id], query, limit ?? 10, status => { searchStatus = status; });
        const names = new Map<number, string>();
        const titles = new Map<number, { title: string; user: string }>();
        const chatOf = (id: number) => {
          if (!titles.has(id)) {
            const other = CodexChatStore.findThread(id, accountId);
            titles.set(id, { title: other?.title || `#${id}`, user: other ? userPersonaForThread(other).name : '사용자' });
          }
          return titles.get(id)!;
        };
        const response = textResult(hits.map((hit) => ({
          ...(chats === 'connected' ? { chat_id: hit.chat_id, chat: chatOf(hit.chat_id).title } : {}),
          id: hit.message_id,
          speaker: speakerName({ ...hit, id: hit.message_id, content: hit.excerpt, created_date: hit.at }, names, chatOf(hit.chat_id).user),
          at: hit.at,
          excerpt: hit.excerpt,
          to: parseMessageRouting(hit.routing)?.recipients,
          reply_to: parseMessageRouting(hit.routing)?.replyTo?.messageId,
        })));
        response.content.push({ type: 'text', text: JSON.stringify({ search: searchStatus }) });
        return response;
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'room_history_read',
    { description: 'Read the conversation around one message id (from room_history_search, or the oldest one you were given), oldest first. room_id: this chat (default), or a chat_id room_history_search returned from a connected chat.', inputSchema: z.object({
      room_id: z.number().int().positive().optional().describe('Chat or room id (default: the current one)'),
      message_id: z.number().int().positive().describe('Message id to read around'),
      before: z.number().int().min(0).max(30).optional().describe('Messages before it (default 10)'),
      after: z.number().int().min(0).max(30).optional().describe('Messages after it (default 0)'),
    }) },
    async ({ room_id, message_id, before, after }) => {
      try {
        const current = requireRoom(context, context.chatContext?.threadId ?? 0);
        const accountId = context.requester?.accountId ?? null;
        const chatId = room_id ?? current.id;
        if (chatId !== current.id && !connectedThreadIds(current.id, accountId).includes(chatId)) throw new Error('Only this chat and the chats connected to it (shared lorebook or linked folder) can be read.');
        const thread = chatId === current.id ? current : CodexChatStore.findThread(chatId, accountId);
        if (!thread) throw new Error(`Chat not found: ${chatId}`);
        const userName = userPersonaForThread(thread).name;
        const db = getUserSettingsDb();
        const older = db.prepare('SELECT id, role, speaker_profile_id, content, created_date, routing FROM codex_chat_messages WHERE thread_id = ? AND id <= ? ORDER BY id DESC LIMIT ?')
          .all(chatId, message_id, (before ?? 10) + 1) as RoomMessageRow[];
        const newer = db.prepare('SELECT id, role, speaker_profile_id, content, created_date, routing FROM codex_chat_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
          .all(chatId, message_id, after ?? 0) as RoomMessageRow[];
        const names = new Map<number, string>();
        return textResult([...older.reverse(), ...newer].map((row) => ({
          id: row.id,
          speaker: speakerName(row, names, userName),
          at: row.created_date,
          to: parseMessageRouting(row.routing)?.recipients,
          reply_to: parseMessageRouting(row.routing)?.replyTo?.messageId,
          text: row.content.length > MESSAGE_TEXT_LIMIT ? `${row.content.slice(0, MESSAGE_TEXT_LIMIT)}…` : row.content,
        })));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
