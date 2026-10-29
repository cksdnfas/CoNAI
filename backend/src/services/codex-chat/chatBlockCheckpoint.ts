import { getUserSettingsDb } from '../../database/userSettingsDb'
import { foldBlockState, parseBlockEdits, usableBlocks, type BlockData } from './chatBlockState'
import { CodexChatStore, type ChatHistorySource, type CodexChatMessageRecord } from './codexChatStore'
import type { ChatProfile } from './chatProfiles'

type FoldMessage = Pick<CodexChatMessageRecord, 'id' | 'role' | 'content' | 'speaker_profile_id'>
type Checkpoint = { fingerprint: string; through: number; state: Record<string, BlockData> }

// The database connection owns its cache; closed/reopened databases cannot reuse another database's thread IDs.
const checkpoints = new WeakMap<ReturnType<typeof getUserSettingsDb>, Map<string, Checkpoint>>()
const initialized = new WeakSet<ReturnType<typeof getUserSettingsDb>>()
const CHECKPOINT_LIMIT = 200

/** Separate from context_revision: a judge fence must not invalidate a paid summary or the transcript window. */
function ensureBlockHistoryRevision(db: ReturnType<typeof getUserSettingsDb>) {
  if (initialized.has(db)) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_block_history_revisions (
      thread_id INTEGER PRIMARY KEY REFERENCES codex_chat_threads(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS chat_block_history_update
    AFTER UPDATE OF content, role, speaker_profile_id ON codex_chat_messages
    WHEN (OLD.role = 'assistant' OR NEW.role = 'assistant')
      AND (OLD.content IS NOT NEW.content OR OLD.role IS NOT NEW.role OR OLD.speaker_profile_id IS NOT NEW.speaker_profile_id)
    BEGIN
      INSERT INTO chat_block_history_revisions(thread_id, revision) VALUES (NEW.thread_id, 1)
      ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
    END;
    CREATE TRIGGER IF NOT EXISTS chat_block_history_delete
    AFTER DELETE ON codex_chat_messages
    WHEN OLD.role = 'assistant' AND EXISTS (SELECT 1 FROM codex_chat_threads WHERE id = OLD.thread_id)
    BEGIN
      INSERT INTO chat_block_history_revisions(thread_id, revision) VALUES (OLD.thread_id, 1)
      ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
    END;
  `)
  initialized.add(db)
}

/**
 * Fold a historical snapshot, advancing only over new messages while the revision, edits and block definition match.
 * A checkpoint applies edits through its boundary; later edits are applied to a copy for the visible result, because
 * a subsequent message must still be folded before edits whose anchors follow it.
 */
export function threadBlockState(profile: ChatProfile, blockEdits: string | null | undefined, messages: ReadonlyArray<FoldMessage>, speakerId?: number, source?: ChatHistorySource): Record<string, BlockData> | null {
  if (usableBlocks(profile.style.blocks).length === 0) return null
  const edits = parseBlockEdits(blockEdits)
  if (!source) return foldBlockState(profile, messages, edits, speakerId)?.state ?? null
  const full = () => foldBlockState(profile, CodexChatStore.listBlockMessages(source.threadId, source.untilMessageId)
    .filter((message) => message.id !== source.excludeMessageId), edits, speakerId)?.state ?? null
  const db = getUserSettingsDb()
  // Never publish an uncommitted state as a checkpoint: a rollback can reuse message IDs and revisions.
  if (db.inTransaction) return full()

  ensureBlockHistoryRevision(db)
  return db.transaction(() => {
    const version = CodexChatStore.blockHistoryVersion(source.threadId, source.untilMessageId)
    if (!version) return full()
    let cache = checkpoints.get(db)
    if (!cache) { cache = new Map(); checkpoints.set(db, cache) }
    const key = JSON.stringify([source.threadId, profile.id, speakerId ?? null, source.excludeMessageId ?? null])
    const fingerprint = JSON.stringify([version.context_revision, version.block_revision, blockEdits ?? null, profile.name, profile.style.blocks])
    const saved = cache.get(key)
    const previous = saved && saved.fingerprint === fingerprint && saved.through <= version.through ? saved : undefined
    const after = previous?.through ?? 0
    const newer = version.through > after
      ? CodexChatStore.listBlockMessages(source.threadId, version.through, after).filter((message) => message.id !== source.excludeMessageId)
      : []
    const currentEdits = edits.filter((edit) => (!previous || edit.afterMessageId > after) && edit.afterMessageId <= version.through)
    const state = foldBlockState(profile, newer, currentEdits, speakerId, previous?.state)!.state
    cache.delete(key)
    cache.set(key, { fingerprint, through: version.through, state })
    if (cache.size > CHECKPOINT_LIMIT) cache.delete(cache.keys().next().value!)
    const laterEdits = edits.filter((edit) => edit.afterMessageId > version.through)
    return laterEdits.length ? foldBlockState(profile, [], laterEdits, speakerId, state)!.state : state
  })()
}
