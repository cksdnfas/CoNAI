import { getUserSettingsDb } from '../database/userSettingsDb';
import { FileStoreJournal, recoverFileStoreJournal } from './fileStoreJournal';

type Effects = { journal: FileStoreJournal; committed: Array<() => void> };
let current: Effects | undefined;

/** File-store writes are synchronous. A nested SQLite savepoint passes its effects to the enclosing write. */
export function withFileStoreWrites<T>(write: () => T): T {
  const db = getUserSettingsDb();
  const parent = current;
  const ownsTransaction = !db.inTransaction;
  const journal = parent?.journal ?? new FileStoreJournal(db, ownsTransaction);
  const checkpoint = journal.checkpoint;
  const effects: Effects = { journal, committed: [] };
  current = effects;
  let value: T;
  try {
    value = db.transaction(() => {
      if (ownsTransaction) recoverFileStoreJournal(db);
      try {
        const result = write();
        if (ownsTransaction) journal.recordCommit();
        return result;
      } catch (error) {
        journal.rollbackTo(checkpoint);
        throw error;
      }
    }).immediate();
  } catch (error) {
    // A failed COMMIT may have released the lock. Never restore over a subsequent writer.
    if (journal.checkpoint > checkpoint) {
      if (ownsTransaction) db.transaction(() => recoverFileStoreJournal(db)).immediate();
      else journal.rollbackTo(checkpoint);
    }
    throw error;
  } finally { current = parent; }
  if (parent) {
    parent.committed.push(...effects.committed);
  } else {
    for (const effect of effects.committed) {
      try { effect(); } catch (error) { console.warn('[file-store] Post-commit action failed:', error); }
    }
    try { journal.discardCommitted(); } catch (error) { console.warn('[file-store] Journal cleanup will retry:', error); }
  }
  return value;
}

export function afterFileStoreCommit(effect: () => void): void {
  if (current) current.committed.push(effect);
  else effect();
}

function activeJournal(): FileStoreJournal {
  if (!current) throw new Error('Stored file write outside its transaction');
  return current.journal;
}

export function installStoredBlob(staged: string, id: string, replace: boolean): string {
  return activeJournal().install(staged, id, replace);
}

export function copyStoredRevision(source: string, id: string): string {
  return activeJournal().copyRevision(source, id);
}

export function retireStoredRevision(id: string): void {
  activeJournal().retireRevision(id);
}
