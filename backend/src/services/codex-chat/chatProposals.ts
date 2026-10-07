import type Database from 'better-sqlite3'
import type { ChatExecutionContext, ChatProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/** A proposal before it is stored: the shared contract without the row id. */
export type NewChatProposal = ChatProposal extends infer P ? (P extends { id: number } ? Omit<P, 'id'> : never) : never

export type StoredChatProposal = { id: number; replyId: string; seq: number; proposal: ChatProposal }

type ProposalRow = { id: number; thread_id: number; reply_id: string; seq: number; kind: string; proposal: string; saved_id: number | null; saved: number; dismissed: number }

const ensured = new WeakSet<Database.Database>()

/**
 * Creates the table on first use of a database handle. TODO: move this DDL into userSettingsSchema.ts (the schema file
 * was off limits when this was written); the statements are idempotent so the move is a pure relocation.
 */
export function ensureProposalTable(db: Database.Database) {
  if (ensured.has(db)) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      reply_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      proposal TEXT NOT NULL,
      saved_id INTEGER,
      saved INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_proposals_reply ON chat_proposals (thread_id, reply_id, seq);
  `)
  // Tables made before a person could set a proposal aside (무시).
  const columns = db.prepare('PRAGMA table_info(chat_proposals)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'dismissed')) db.exec('ALTER TABLE chat_proposals ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0')
  ensured.add(db)
}

function table() {
  const db = getUserSettingsDb()
  ensureProposalTable(db)
  return db
}

/** The stored JSON plus the columns a person's save writes back (`savedId`, or `saved` for updates). */
function toProposal(row: ProposalRow): ChatProposal {
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(row.proposal) as Record<string, unknown> } catch { body = {} }
  const merged: Record<string, unknown> = { ...body, id: row.id }
  if (row.kind === 'profile_update' || row.kind === 'page_fields' || row.kind === 'workflow_graph' || row.kind === 'page_action') {
    if (row.saved === 1) merged.saved = true
  } else if (row.saved === 1) {
    merged.savedId = row.saved_id
  }
  if (row.dismissed === 1) merged.dismissed = true
  return merged as ChatProposal
}

export const ChatProposalStore = {
  /** Stores a proposal for the reply it was made in; `seq` is its order within that reply. */
  add(context: ChatExecutionContext, proposal: NewChatProposal): ChatProposal {
    if (!context.replyId) throw new Error('Proposals need an active chat reply.')
    const db = table()
    const id = db.transaction(() => {
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM chat_proposals WHERE thread_id = ? AND reply_id = ?').get(context.threadId, context.replyId) as { count: number }
      const result = db.prepare('INSERT INTO chat_proposals (thread_id, reply_id, seq, kind, proposal) VALUES (?, ?, ?, ?, ?)')
        .run(context.threadId, context.replyId, count, proposal.kind, JSON.stringify(proposal))
      return Number(result.lastInsertRowid)
    })()
    return ChatProposalStore.find(id) as ChatProposal
  },

  /** Every proposal of a chat, in reply then seq order. */
  listForThread(threadId: number): StoredChatProposal[] {
    const rows = table().prepare('SELECT * FROM chat_proposals WHERE thread_id = ? ORDER BY id ASC').all(threadId) as ProposalRow[]
    // Ids grow with insertion, so id order is also seq order within a reply.
    return rows.map((row) => ({ id: row.id, replyId: row.reply_id, seq: row.seq, proposal: toProposal(row) }))
  },

  find(id: number): ChatProposal | null {
    const row = table().prepare('SELECT * FROM chat_proposals WHERE id = ?').get(id) as ProposalRow | undefined
    return row ? toProposal(row) : null
  },

  /** The chat a proposal belongs to (for the visibility check before saving it), or null when unknown. */
  threadIdOf(id: number): number | null {
    const row = table().prepare('SELECT thread_id FROM chat_proposals WHERE id = ?').get(id) as { thread_id: number } | undefined
    return row ? row.thread_id : null
  },

  /** Saved, and no longer set aside. */
  markSaved(id: number, savedId: number | null): ChatProposal | null {
    const changed = table().prepare('UPDATE chat_proposals SET saved = 1, saved_id = ?, dismissed = 0 WHERE id = ?').run(savedId, id).changes
    return changed > 0 ? ChatProposalStore.find(id) : null
  },

  /** A person set the proposal aside (무시); a saved one stays saved. */
  markDismissed(id: number): ChatProposal | null {
    const changed = table().prepare('UPDATE chat_proposals SET dismissed = 1 WHERE id = ? AND saved = 0').run(id).changes
    return changed > 0 ? ChatProposalStore.find(id) : null
  },

  /** The proposals of one kind in one reply. */
  forReply(threadId: number, replyId: string, kind: string): ChatProposal[] {
    const rows = table().prepare('SELECT * FROM chat_proposals WHERE thread_id = ? AND reply_id = ? AND kind = ? ORDER BY id ASC').all(threadId, replyId, kind) as ProposalRow[]
    return rows.map(toProposal)
  },

  /** Every proposal of one kind a person set aside in a chat, newest first, at most `limit`. */
  dismissedOfKind(threadId: number, kind: string, limit: number): ChatProposal[] {
    const rows = table().prepare('SELECT * FROM chat_proposals WHERE thread_id = ? AND kind = ? AND dismissed = 1 ORDER BY id DESC LIMIT ?').all(threadId, kind, limit) as ProposalRow[]
    return rows.map(toProposal)
  },

  /** A deleted chat's proposals (see CodexChatStore.deleteThread): its id could be handed out again. */
  deleteForThread(threadId: number) {
    return table().prepare('DELETE FROM chat_proposals WHERE thread_id = ?').run(threadId).changes
  },
}
