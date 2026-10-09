import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { userPersonaForThread } from '../../services/codex-chat/chatUserProfiles';
import { CodexChatStore, parseMessageRouting } from '../../services/codex-chat/codexChatStore';
import { routeChatReply, requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry';
import { ChatGroupStore } from '../../services/codex-chat/chatGroupStore';
import { resolveMemberName } from '../../services/codex-chat/groupChatContext';
import { buildReplyContext } from '../../services/codex-chat/chatReplyContext';
import type { McpRequestContext } from '../context';

const MESSAGE_TEXT_LIMIT = 2000;
const EXCERPT_LENGTH = 240;

type RoomMessageRow = { id: number; role: 'user' | 'assistant'; speaker_profile_id: number | null; content: string; created_date: string; routing: string | null };

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

/** The caller's own group room, or an error the model can read. */
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

/** Group room tools for chat agents in a room the caller owns: call another member, and read the room's history. */
export function registerChatRoomTools(server: McpServer, context: McpRequestContext): void {
  if (offersChatReplyTo(context)) registerChatReplyTo(server, context);
  registerRoomTools(server, context);
}

function registerChatReplyTo(server: McpServer, context: McpRequestContext): void {
  server.tool(
    'chat_reply_to',
    'Set the quote and recipients of the reply you are writing. Omit message_id to keep its current quote. to contains exact member profile IDs, "user" to finish by addressing the human, or "room" for an announcement without waking anyone. Replaces an earlier recipient selection. The app displays the quote; do not repeat it in your text. Your sender and room are server-controlled.',
    {
      message_id: z.number().int().positive().optional(),
      to: z.array(z.union([z.number().int().positive(), z.literal('user'), z.literal('room')])).min(1).max(6).optional(),
    },
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
  server.tool(
    'room_call_member',
    'Ask other members of the group chat room you are in to answer right after you. Use their exact names from the room header (not translated). They write their own answers; do not write them yourself.',
    {
      room_id: z.number().int().positive().describe('Group room id from the room header'),
      names: z.array(z.string().trim().min(1).max(60)).min(1).max(6).describe('Member names exactly as listed in the room header'),
    },
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

  server.tool(
    'room_history_search',
    'Search earlier messages of the group chat room you are in (the room id is given in the room header). Returns message ids, speakers and excerpts, newest first.',
    {
      room_id: z.number().int().positive().describe('Group room id from the room header'),
      query: z.string().trim().min(1).max(200).describe('Text to find (plain substring, case-insensitive)'),
      limit: z.number().int().min(1).max(20).optional().describe('Max results (default 10)'),
    },
    async ({ room_id, query, limit }) => {
      try {
        const userName = userPersonaForThread(requireRoom(context, room_id)).name;
        const rows = getUserSettingsDb().prepare(`
          SELECT id, role, speaker_profile_id, created_date, routing,
          substr(content, MAX(1, instr(lower(content), lower(?)) - 80), ${EXCERPT_LENGTH}) AS content
          FROM codex_chat_messages WHERE thread_id = ? AND instr(lower(content), lower(?)) > 0 ORDER BY id DESC LIMIT ?
        `).all(query, room_id, query, limit ?? 10) as RoomMessageRow[];
        const names = new Map<number, string>();
        return textResult(rows.map((row) => ({ id: row.id, speaker: speakerName(row, names, userName), at: row.created_date, excerpt: row.content, to: parseMessageRouting(row.routing)?.recipients, reply_to: parseMessageRouting(row.routing)?.replyTo?.messageId })));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'room_history_read',
    'Read the group chat room conversation around one message id (from room_history_search, or the oldest one you were given), oldest first.',
    {
      room_id: z.number().int().positive().describe('Group room id from the room header'),
      message_id: z.number().int().positive().describe('Message id to read around'),
      before: z.number().int().min(0).max(30).optional().describe('Messages before it (default 10)'),
      after: z.number().int().min(0).max(30).optional().describe('Messages after it (default 0)'),
    },
    async ({ room_id, message_id, before, after }) => {
      try {
        const userName = userPersonaForThread(requireRoom(context, room_id)).name;
        const db = getUserSettingsDb();
        const older = db.prepare('SELECT id, role, speaker_profile_id, content, created_date, routing FROM codex_chat_messages WHERE thread_id = ? AND id <= ? ORDER BY id DESC LIMIT ?')
          .all(room_id, message_id, (before ?? 10) + 1) as RoomMessageRow[];
        const newer = db.prepare('SELECT id, role, speaker_profile_id, content, created_date, routing FROM codex_chat_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
          .all(room_id, message_id, after ?? 0) as RoomMessageRow[];
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
