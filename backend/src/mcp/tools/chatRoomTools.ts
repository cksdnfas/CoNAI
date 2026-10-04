import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles';
import { CodexChatStore } from '../../services/codex-chat/codexChatStore';
import { requestGroupWake } from '../../services/codex-chat/groupWakeRegistry';
import type { McpRequestContext } from '../context';

const MESSAGE_TEXT_LIMIT = 2000;
const EXCERPT_LENGTH = 240;

type RoomMessageRow = { id: number; role: 'user' | 'assistant'; speaker_profile_id: number | null; content: string; created_date: string };

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

/** The caller's own group room, or an error the model can read. */
function requireRoom(context: McpRequestContext, roomId: number) {
  const thread = CodexChatStore.findThread(roomId, context.requester?.accountId ?? null);
  if (!thread || thread.kind !== 'group') throw new Error(`Group room not found: ${roomId}`);
  return thread;
}

function speakerName(row: RoomMessageRow, names: Map<number, string>) {
  if (row.role === 'user') return '사용자';
  if (row.speaker_profile_id === null) return '어시스턴트';
  if (!names.has(row.speaker_profile_id)) names.set(row.speaker_profile_id, ChatProfileStore.find(row.speaker_profile_id)?.name ?? '(삭제된 프로필)');
  return names.get(row.speaker_profile_id) as string;
}

/** Group room tools for chat agents in a room the caller owns: call another member, and read the room's history. */
export function registerChatRoomTools(server: McpServer, context: McpRequestContext): void {
  server.tool(
    'room_call_member',
    'Ask other members of the group chat room you are in to answer right after you. Use their exact names from the room header (not translated). They write their own answers; do not write them yourself.',
    {
      room_id: z.number().int().positive().describe('Group room id from the room header'),
      names: z.array(z.string().trim().min(1).max(60)).min(1).max(6).describe('Member names exactly as listed in the room header'),
    },
    async ({ room_id, names }) => {
      try {
        requireRoom(context, room_id);
        const result = requestGroupWake(room_id, names);
        if ('error' in result) return errorResult(result.error);
        if (result.woken.length === 0) return errorResult(`No such member: ${result.unknown.join(', ')}. Members you can call: ${result.members.join(', ')}`);
        return textResult({
          called: result.woken,
          ...(result.unknown.length > 0 ? { not_found: result.unknown, members: result.members } : {}),
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
        requireRoom(context, room_id);
        const rows = getUserSettingsDb().prepare(`
          SELECT id, role, speaker_profile_id, created_date,
          substr(content, MAX(1, instr(lower(content), lower(?)) - 80), ${EXCERPT_LENGTH}) AS content
          FROM codex_chat_messages WHERE thread_id = ? AND instr(lower(content), lower(?)) > 0 ORDER BY id DESC LIMIT ?
        `).all(query, room_id, query, limit ?? 10) as RoomMessageRow[];
        const names = new Map<number, string>();
        return textResult(rows.map((row) => ({ id: row.id, speaker: speakerName(row, names), at: row.created_date, excerpt: row.content })));
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
        requireRoom(context, room_id);
        const db = getUserSettingsDb();
        const older = db.prepare('SELECT id, role, speaker_profile_id, content, created_date FROM codex_chat_messages WHERE thread_id = ? AND id <= ? ORDER BY id DESC LIMIT ?')
          .all(room_id, message_id, (before ?? 10) + 1) as RoomMessageRow[];
        const newer = db.prepare('SELECT id, role, speaker_profile_id, content, created_date FROM codex_chat_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
          .all(room_id, message_id, after ?? 0) as RoomMessageRow[];
        const names = new Map<number, string>();
        return textResult([...older.reverse(), ...newer].map((row) => ({
          id: row.id,
          speaker: speakerName(row, names),
          at: row.created_date,
          text: row.content.length > MESSAGE_TEXT_LIMIT ? `${row.content.slice(0, MESSAGE_TEXT_LIMIT)}…` : row.content,
        })));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
