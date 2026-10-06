import { getUserSettingsDb } from '../../database/userSettingsDb'
import { parseBlockEdits } from './chatBlockState'
import { renderSummary, type ChatSummarySegment } from './chatMemory'
import { parseMessageRouting, type CodexChatThreadRecord } from './codexChatStore'

const BRANCH_TITLE_SUFFIX = ' (분기)'
const TITLE_MAX_LENGTH = 60

/** Thread settings a branch keeps: who talks, how, and what is pinned. Codex state and usage start empty. */
const COPIED_THREAD_COLUMNS = ['account_id', 'engine', 'profile_id', 'kind', 'context_turns', 'summary_enabled', 'author_note', 'author_note_depth',
  'max_tokens', 'flag_ids', 'user_profile_id', 'memories', 'group_chain_limit', 'group_window_limit'] as const

const COPIED_MESSAGE_COLUMNS = ['role', 'content', 'display_content', 'tool_calls', 'status', 'error', 'speaker_profile_id', 'flags', 'finish_reason',
  'media_attachments', 'alternatives', 'active_alternative', 'context_meta', 'created_date'] as const

/**
 * A new chat holding `thread` up to and including `untilMessageId`: the messages (with their variants, files and
 * quotes), the hand edits of the display blocks made by then, and the summary segments that end by then — all
 * pointing at the copies' ids. The original chat is not touched. Null when the message is not in the chat.
 */
export function branchChatThread(thread: CodexChatThreadRecord, untilMessageId: number): number | null {
  const db = getUserSettingsDb()
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM codex_chat_messages WHERE thread_id = ? AND id = ?').get(thread.id, untilMessageId)) return null
    const title = `${(thread.title || '새 채팅').slice(0, TITLE_MAX_LENGTH - BRANCH_TITLE_SUFFIX.length)}${BRANCH_TITLE_SUFFIX}`
    const branchId = Number(db.prepare(`INSERT INTO codex_chat_threads (title, ${COPIED_THREAD_COLUMNS.join(', ')})
      SELECT ?, ${COPIED_THREAD_COLUMNS.join(', ')} FROM codex_chat_threads WHERE id = ?`).run(title, thread.id).lastInsertRowid)

    // Messages in order, so the copies keep it; ids map old → new for everything that points at a message.
    const ids = new Map<number, number>()
    const rows = db.prepare(`SELECT id, routing, ${COPIED_MESSAGE_COLUMNS.join(', ')} FROM codex_chat_messages WHERE thread_id = ? AND id <= ? ORDER BY id`)
      .all(thread.id, untilMessageId) as Array<Record<string, unknown> & { id: number; routing: string | null }>
    const insert = db.prepare(`INSERT INTO codex_chat_messages (thread_id, ${COPIED_MESSAGE_COLUMNS.join(', ')}) VALUES (?, ${COPIED_MESSAGE_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of rows) {
      ids.set(row.id, Number(insert.run(branchId, ...COPIED_MESSAGE_COLUMNS.map((column) => row[column])).lastInsertRowid))
    }
    const setRouting = db.prepare('UPDATE codex_chat_messages SET routing = ? WHERE id = ?')
    const copyFiles = db.prepare('INSERT INTO chat_file_attachments (message_id, file_id) SELECT ?, file_id FROM chat_file_attachments WHERE message_id = ?')
    for (const row of rows) {
      const copyId = ids.get(row.id) as number
      const routing = parseMessageRouting(row.routing)
      if (routing) {
        const quoted = routing.replyTo ? ids.get(routing.replyTo.messageId) : undefined
        if (routing.replyTo) routing.replyTo = quoted ? { ...routing.replyTo, messageId: quoted } : { ...routing.replyTo, excerpt: '', media: undefined, unavailable: true }
        setRouting.run(JSON.stringify(routing), copyId)
      }
      copyFiles.run(copyId, row.id)
    }

    // A room's members come along with their order and reply caps. Their place in the conversation (and Codex
    // memory) does not: a Codex member then gets the room's recent past on its first turn, like a newcomer.
    if (thread.kind === 'group') {
      db.prepare(`INSERT INTO chat_group_members (thread_id, profile_id, member_order, max_tokens)
        SELECT ?, profile_id, member_order, max_tokens FROM chat_group_members WHERE thread_id = ?`).run(branchId, thread.id)
    }

    const edits = parseBlockEdits(thread.block_edits).filter((edit) => edit.afterMessageId <= untilMessageId)
      .map((edit) => ({ ...edit, afterMessageId: ids.get(edit.afterMessageId) ?? edit.afterMessageId }))
    if (edits.length > 0) db.prepare('UPDATE codex_chat_threads SET block_edits = ? WHERE id = ?').run(JSON.stringify(edits), branchId)

    // Summary segments that end by the branch point; a bound that is no message (0: ahead of all) stays as it is.
    const segments = db.prepare('SELECT * FROM chat_summary_segments WHERE thread_id = ? AND until_message_id <= ? ORDER BY id').all(thread.id, untilMessageId) as ChatSummarySegment[]
    const insertSegment = db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content, backed) VALUES (?, ?, ?, ?, ?, ?)')
    for (const segment of segments) {
      insertSegment.run(branchId, segment.level, ids.get(segment.from_message_id) ?? segment.from_message_id, ids.get(segment.until_message_id) ?? segment.until_message_id, segment.content, segment.backed ?? 1)
    }
    const copied = db.prepare('SELECT * FROM chat_summary_segments WHERE thread_id = ?').all(branchId) as ChatSummarySegment[]
    const until = copied.reduce<number | null>((max, segment) => (max === null || segment.until_message_id > max ? segment.until_message_id : max), null)
    db.prepare(`UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ?, summary_updated_date = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id = ?`)
      .run(renderSummary(copied) || null, until, until, branchId)
    return branchId
  }).immediate()
}
