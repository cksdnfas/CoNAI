import type Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileStoreJournalPath, fileStoreThumbnailPath, storedFilePath, storedRevisionPath } from './fileStorePaths';

// Only these names are replayable. No path from a journal is used as a destination.
const NAME = /^([0-9a-f]{32})\.([0-9a-f]{32})\.([1-9]\d*)\.([0-9a-f]{32})\.(old|new|revision|retired|partial)$/;
type Kind = 'old' | 'new' | 'revision' | 'retired' | 'partial';
type Entry = { marker: string; id: string; kind: Kind };
type State = { store: string; committed: string | null };

function readState(db: Database.Database): State {
  return db.prepare('SELECT store, committed FROM stored_file_write_state WHERE id = 1').get() as State;
}

function undo(entry: Entry): void {
  if (entry.kind === 'old') {
    const target = storedFilePath('', entry.id);
    fs.renameSync(entry.marker, target);
    // POSIX rename between two links to the same inode is a no-op (death before the replacement).
  } else if (entry.kind === 'new' || entry.kind === 'revision') {
    fs.rmSync(entry.kind === 'revision' ? storedRevisionPath(entry.id) : storedFilePath('', entry.id), { force: true });
  }
  fs.rmSync(entry.marker, { force: true });
}

function finish(entry: Entry): void {
  if (entry.kind === 'retired') fs.rmSync(storedRevisionPath(entry.id), { force: true });
  fs.rmSync(entry.marker, { force: true });
}

/** Called under the same SQLite writer lock as installation, including when another process survives the writer. */
export function recoverFileStoreJournal(db: Database.Database): void {
  const dir = fileStoreJournalPath();
  let files: fs.Dirent[];
  try { files = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!files.length) return;
  const state = readState(db);
  let transaction: string | undefined;
  const entries = files.map(file => {
    const match = NAME.exec(file.name);
    if (!match || !file.isFile() || match[1] !== state.store || (transaction && transaction !== match[2])) {
      throw new Error(`Unrecognized file-store journal; preserved for recovery: ${file.name}`);
    }
    transaction = match[2];
    return { marker: path.join(dir, file.name), id: match[4], kind: match[5] as Kind, index: Number(match[3]) };
  });
  // Multiple writes to one file must unwind newest first. Each step removes its own marker last.
  for (const entry of entries.sort((a, b) => b.index - a.index)) {
    if (entry.kind === 'old' || entry.kind === 'new') fs.rmSync(fileStoreThumbnailPath(entry.id), { force: true });
    if (transaction === state.committed) finish(entry);
    else undo(entry);
  }
}

/** Before schema migrations read any lorebook bytes; the HTTP and stdio servers both open user.db here. */
export function openFileStoreJournal(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS stored_file_write_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), store TEXT NOT NULL, committed TEXT
    );
    INSERT OR IGNORE INTO stored_file_write_state (id, store) VALUES (1, lower(hex(randomblob(16))));`);
    recoverFileStoreJournal(db);
  }).immediate();
}

/** One transaction, with savepoint checkpoints in its undo stack. Only the first byte write needs a journal ID. */
export class FileStoreJournal {
  private prefix?: string;
  private token?: string;
  private sequence = 0;
  private entries: Entry[] = [];
  private failed = false;

  constructor(private db: Database.Database, private ownsTransaction: boolean) {}

  get checkpoint(): number { return this.entries.length; }

  private prepare(id: string, kind: Exclude<Kind, 'partial'>, target: string): void {
    if (!this.ownsTransaction) throw new Error('File-store bytes require withFileStoreWrites at the outer transaction');
    if (this.failed) throw new Error('File-store rollback has not finished');
    if (!this.prefix) {
      const dir = fileStoreJournalPath();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.token = crypto.randomBytes(16).toString('hex');
      this.prefix = path.join(dir, `${readState(this.db).store}.${this.token}`);
    }
    const stem = `${this.prefix}.${++this.sequence}.${id}`;
    const marker = `${stem}.${kind}`;
    if (kind === 'old') {
      try { fs.linkSync(target, marker); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
        // A partial copy must never be mistaken for an old file ready to restore.
        const partial = `${stem}.partial`;
        try { fs.copyFileSync(target, partial, fs.constants.COPYFILE_EXCL); fs.renameSync(partial, marker); }
        finally { fs.rmSync(partial, { force: true }); }
      }
    } else fs.closeSync(fs.openSync(marker, 'wx', 0o600));
    this.entries.push({ marker, id, kind });
  }

  install(staged: string, id: string, replace: boolean): string {
    const target = storedFilePath('', id);
    const exists = fs.existsSync(target);
    if (exists && !replace) throw new Error('Stored file ID collision');
    this.prepare(id, exists ? 'old' : 'new', target);
    fs.renameSync(staged, target);
    return target;
  }

  copyRevision(source: string, id: string): string {
    const target = storedRevisionPath(id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) throw new Error('Stored file revision ID collision');
    this.prepare(id, 'revision', target);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return target;
  }

  retireRevision(id: string): void {
    this.prepare(id, 'retired', storedRevisionPath(id));
  }

  rollbackTo(checkpoint: number): void {
    while (this.entries.length > checkpoint) {
      try { undo(this.entries[this.entries.length - 1]); }
      catch (error) { this.failed = true; throw error; }
      this.entries.pop();
    }
  }

  recordCommit(): void {
    if (this.failed) throw new Error('File-store rollback has not finished');
    if (this.entries.length && !this.db.prepare('UPDATE stored_file_write_state SET committed = ? WHERE id = 1').run(this.token).changes) {
      throw new Error('Missing file-store journal state');
    }
  }

  discardCommitted(): void {
    // A surviving writer can already have cleared these exact markers under the lock.
    for (const entry of this.entries) finish(entry);
  }
}
