import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { resolveDefaultBackupSources, type DatabaseBackupSource } from './databaseBackupService';

/**
 * Size of each SQLite database for the maintenance screen: what is on disk (main file + WAL), how much of it the
 * pages use, and how much a VACUUM could hand back (free-list pages). Only cheap pragmas — never a scan.
 */

export interface DatabaseFileStats {
  fileName: string;
  /** Main file + `-wal` on disk. */
  fileBytes: number;
  walBytes: number;
  pageSize: number;
  pageCount: number;
  /** page_size * page_count. */
  databaseBytes: number;
  freelistPages: number;
  /** page_size * freelist_count: what a VACUUM can reclaim at most. */
  reclaimableBytes: number;
}

export interface DatabaseStats {
  databases: DatabaseFileStats[];
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function readDatabaseFileStats(fileName: string, db: Database.Database): DatabaseFileStats {
  const pageSize = Number(db.pragma('page_size', { simple: true })) || 0;
  const pageCount = Number(db.pragma('page_count', { simple: true })) || 0;
  const freelistPages = Number(db.pragma('freelist_count', { simple: true })) || 0;
  const mainPath = path.resolve(db.name);
  const walBytes = fileSize(`${mainPath}-wal`);
  return {
    fileName,
    fileBytes: fileSize(mainPath) + walBytes,
    walBytes,
    pageSize,
    pageCount,
    databaseBytes: pageSize * pageCount,
    freelistPages,
    reclaimableBytes: pageSize * freelistPages,
  };
}

export async function readDatabaseStats(sources?: DatabaseBackupSource[]): Promise<DatabaseStats> {
  const list = sources ?? await resolveDefaultBackupSources();
  return { databases: list.map((source) => readDatabaseFileStats(source.fileName, source.db)) };
}
