import type Database from 'better-sqlite3'
import type { ChatFileChange } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { FileStoreRevisions } from '../fileStoreRevisions'
import { FileStoreError, FileStoreService, fileOwnerKey } from '../fileStoreService'
import type { CodexChatMessageRecord } from './codexChatStore'

/**
 * The text files a chat reply's tools wrote: linked files, lore files, file store documents. Recorded from the file
 * store's text writes (whatever the engine, since the write runs in our tool with the reply's id), shown as chips under
 * the reply, and undone from there: a file the reply replaced goes back to the version just before that reply (the text
 * it has now is kept as a version too); a file the reply made is removed, but only while nobody changed it since.
 */

const ensured = new WeakSet<Database.Database>()
function db() {
  const database = getUserSettingsDb()
  if (!ensured.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS chat_file_changes (
        thread_id INTEGER NOT NULL,
        reply_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        name TEXT NOT NULL,
        created INTEGER NOT NULL DEFAULT 0,
        undone_at TEXT,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (thread_id, reply_id, file_id)
      );
    `)
    ensured.add(database)
  }
  return database
}

type ChangeRow = { thread_id: number; reply_id: string; file_id: string; owner_key: string; name: string; created: number; undone_at: string | null }

export class ChatFileChangeError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

// The first write of a reply decides whether it made the file; later writes in the same reply keep that.
FileStoreService.onTextWrite(({ owner, entry, source, created }) => {
  if (source.via !== 'chat' || source.threadId === undefined || !source.replyId) return
  db().prepare(`INSERT INTO chat_file_changes (thread_id, reply_id, file_id, owner_key, name, created) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, reply_id, file_id) DO UPDATE SET name = excluded.name, undone_at = NULL, changed_at = datetime('now')`)
    .run(source.threadId, source.replyId, entry.id, owner, entry.name, created ? 1 : 0)
})

function folderOf(owner: string, fileId: string) {
  try {
    const entry = FileStoreService.get(owner, fileId)
    return `/${FileStoreService.list(owner, entry.parentId, 0, 1).breadcrumbs.map((item) => item.name).join('/')}`
  } catch { return null }
}

function view(row: ChangeRow): ChatFileChange {
  return { fileId: row.file_id, name: row.name, folder: folderOf(row.owner_key, row.file_id), created: row.created === 1, undone: row.undone_at !== null }
}

/** Hang each reply's file changes on it (read-only, not stored on the message). */
export function attachFileChanges(messages: CodexChatMessageRecord[]): CodexChatMessageRecord[] {
  const byReply = new Map<string, ChatFileChange[]>()
  for (const threadId of new Set(messages.map((message) => message.thread_id))) {
    const rows = db().prepare('SELECT * FROM chat_file_changes WHERE thread_id = ? ORDER BY changed_at, rowid').all(threadId) as ChangeRow[]
    for (const row of rows) {
      const key = `${threadId}:${row.reply_id}`
      byReply.set(key, [...(byReply.get(key) ?? []), view(row)])
    }
  }
  if (byReply.size === 0) return messages
  return messages.map((message) => {
    const replyId = message.role === 'assistant' ? message.routing?.replyId : undefined
    const changes = replyId ? byReply.get(`${message.thread_id}:${replyId}`) : undefined
    return changes?.length ? { ...message, fileChanges: changes } : message
  })
}

/** Undo what one reply did to one file (see the module note). `accountId` is the chat owner acting from the chip. */
export function undoFileChange(params: { threadId: number; accountId: number | null; replyId: string; fileId: string; canDelete?: () => void }): ChatFileChange {
  const owner = fileOwnerKey(params.accountId)
  const row = db().prepare('SELECT * FROM chat_file_changes WHERE thread_id = ? AND reply_id = ? AND file_id = ? AND owner_key = ?')
    .get(params.threadId, params.replyId, params.fileId, owner) as ChangeRow | undefined
  if (!row) throw new ChatFileChangeError('이 답변이 고친 파일이 아니야.', 404)
  if (row.undone_at) throw new ChatFileChangeError('이미 되돌렸어.', 409)
  let live = true
  try { FileStoreService.get(owner, row.file_id) } catch { live = false }
  if (!live) throw new ChatFileChangeError('파일이 지워져서 되돌릴 수 없어.', 404)
  if (row.created === 1) {
    const writer = FileStoreRevisions.writer(row.file_id)
    if (writer?.threadId !== params.threadId || writer?.replyId !== params.replyId) {
      throw new ChatFileChangeError('이 답변 뒤에 파일이 다시 고쳐져서 지우지 않았어. 보관함의 버전 기록에서 골라줘.', 409)
    }
    params.canDelete?.()
    try { FileStoreService.delete(owner, [row.file_id]) }
    catch (error) {
      if (error instanceof FileStoreError) throw new ChatFileChangeError(error.message, error.status)
      throw error
    }
  } else {
    const before = FileStoreRevisions.beforeReply(owner, row.file_id, params.threadId, params.replyId)
    if (!before) throw new ChatFileChangeError('이 답변 전의 버전이 남아 있지 않아.', 404)
    try {
      FileStoreService.restoreRevision(owner, row.file_id, before.id, { via: 'restore', accountId: params.accountId, threadId: params.threadId })
    } catch (error) {
      if (error instanceof FileStoreError) throw new ChatFileChangeError(error.message, error.status)
      throw error
    }
  }
  db().prepare("UPDATE chat_file_changes SET undone_at = datetime('now') WHERE thread_id = ? AND reply_id = ? AND file_id = ?").run(params.threadId, params.replyId, params.fileId)
  return view({ ...row, undone_at: 'now' })
}

/** Transfer a temporary room's file chips and undo lineage to its durable result reply. */
export function moveThreadFileChanges(fromThreadId: number, threadId: number, replyId: string) {
  const database = db()
  database.transaction(() => {
    const files = database.prepare('SELECT DISTINCT file_id FROM chat_file_changes WHERE thread_id = ?').all(fromThreadId) as Array<{ file_id: string }>
    // Several replies can touch the same file. Keep the first creation/undo boundary, as ordinary reply writes do.
    database.prepare(`INSERT INTO chat_file_changes (thread_id, reply_id, file_id, owner_key, name, created, undone_at, changed_at)
      SELECT ?, ?, file_id, owner_key, name, created, undone_at, changed_at FROM chat_file_changes
      WHERE thread_id = ? ORDER BY changed_at, rowid
      ON CONFLICT(thread_id, reply_id, file_id) DO UPDATE SET name = excluded.name, undone_at = excluded.undone_at, changed_at = excluded.changed_at`)
      .run(threadId, replyId, fromThreadId)
    FileStoreRevisions.moveChatReply(files.map(file => file.file_id), fromThreadId, threadId, replyId)
    database.prepare('DELETE FROM chat_file_changes WHERE thread_id = ?').run(fromThreadId)
  })()
}

/** A deleted chat lets go of its rows. */
export function forgetThreadFileChanges(threadId: number) {
  db().prepare('DELETE FROM chat_file_changes WHERE thread_id = ?').run(threadId)
}

/** Forget a deleted reply's chips, not the files or their revision history. */
export function forgetReplyFileChanges(threadId: number, replyId: string) {
  db().prepare('DELETE FROM chat_file_changes WHERE thread_id = ? AND reply_id = ?').run(threadId, replyId)
}
