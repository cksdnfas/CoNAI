import type Database from 'better-sqlite3';
import { db } from '../../database/init';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { FileType } from '../../types/image';
import { FileDiscoveryService } from './fileDiscoveryService';
import { ScanProgressTracker } from './scanProgressTracker';
import { ScanResult } from './types';

// 타입 재내보내기
export type { ScanResult };

/**
 * Phase 1: 빠른 등록 서비스
 */
interface FastRegistrationOptions {
  quietIfIdle?: boolean;
}

interface ExistingFileScanRecord {
  id: number;
  original_file_path: string;
  composite_hash: string | null;
  file_status: string;
  file_size: number | null;
  file_modified_date: string | null;
  mime_type: string | null;
}

interface ScanStatements {
  selectFolderFiles: Database.Statement;
  selectFileByPath: Database.Statement;
  touchDeletedFile: Database.Statement;
  reactivateFile: Database.Statement;
  insertFile: Database.Statement;
}

/** One file resolved against the filesystem, ready to be classified. */
interface StattedFile {
  filePath: string;
  stats: fs.Stats | null;
  error: unknown;
}

type PlannedWrite =
  | { kind: 'update'; statement: Database.Statement; existingId: number; stats: fs.Stats; mimeType: string }
  | { kind: 'insert'; filePath: string; stats: fs.Stats; mimeType: string; fileType: FileType };

// Prepared once per process (lazily, so module import order cannot race schema
// creation) instead of recompiling SQL for every scanned file.
let scanStatements: ScanStatements | null = null;

function getScanStatements(): ScanStatements {
  if (!scanStatements) {
    scanStatements = {
      // Paged by id so a 200k-row folder snapshot is not one multi-hundred-ms
      // statement. `idx_files_folder_id` answers this as SEARCH (folder_id=? AND rowid>?).
      selectFolderFiles: db.prepare(
        `SELECT id, original_file_path, composite_hash, file_status, file_size, file_modified_date, mime_type
         FROM image_files WHERE folder_id = ? AND id > ? ORDER BY id LIMIT ?`
      ),
      selectFileByPath: db.prepare(
        `SELECT id, original_file_path, composite_hash, file_status, file_size, file_modified_date, mime_type
         FROM image_files WHERE original_file_path = ?`
      ),
      touchDeletedFile: db.prepare(`
        UPDATE image_files
        SET last_verified_date = ?,
            file_modified_date = ?,
            file_size = ?,
            mime_type = COALESCE(?, mime_type)
        WHERE id = ?
      `),
      reactivateFile: db.prepare(`
        UPDATE image_files
        SET file_status = 'active',
            last_verified_date = ?,
            file_modified_date = ?,
            file_size = ?,
            mime_type = COALESCE(?, mime_type)
        WHERE id = ?
      `),
      insertFile: db.prepare(`
        INSERT INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, file_modified_date
        ) VALUES (NULL, ?, ?, ?, 'active', ?, ?, ?)
      `),
    };
  }

  return scanStatements;
}

/**
 * Compare a stored modification timestamp with a fresh `stat`.
 *
 * Rows are written with `Date.toISOString()`, so the common case is a string
 * match. Older rows may carry SQLite's `CURRENT_TIMESTAMP` format instead; those
 * are compared by parsed instant, and the one rewrite that normalises them is
 * self-healing (every later scan then matches on the string).
 */
function isSameModifiedTimestamp(stored: string | null, actual: Date): boolean {
  if (!stored) {
    return false;
  }

  if (stored === actual.toISOString()) {
    return true;
  }

  const storedMs = Date.parse(stored);
  return Number.isFinite(storedMs) && storedMs === actual.getTime();
}

/**
 * Decide whether a known file still needs a write.
 *
 * This is the whole point of HEAVY-3: every scan tick used to rewrite every row it
 * saw, so an unchanged 200k-file library produced 200k UPDATEs and a WAL explosion
 * on each pass. A row only needs a write when something a scan can observe actually
 * changed — size, mtime, mime type — or when its status must be brought back to
 * `active`. Full rescans reconcile missing rows only after this phase completes.
 */
function needsScanWrite(existing: ExistingFileScanRecord, stats: fs.Stats, mimeType: string): boolean {
  if (existing.file_status !== 'active' && existing.file_status !== 'deleted') {
    return true;
  }

  if (existing.file_size !== stats.size) {
    return true;
  }

  if (!isSameModifiedTimestamp(existing.file_modified_date, stats.mtime)) {
    return true;
  }

  return Boolean(mimeType) && existing.mime_type !== mimeType;
}

/** Reconcile one already-known file without reviving intentionally deleted rows. */
function planExistingFileWrite(
  statements: ScanStatements,
  existingFile: ExistingFileScanRecord,
  stats: fs.Stats,
  mimeType: string
): PlannedWrite {
  const statement = existingFile.file_status === 'deleted'
    ? statements.touchDeletedFile
    : statements.reactivateFile;

  return { kind: 'update', statement, existingId: existingFile.id, stats, mimeType };
}

function resolveScanStatConcurrency(): number {
  const configured = Number.parseInt(process.env.CONAI_SCAN_STAT_CONCURRENCY ?? '', 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, 64);
  }

  return 16;
}

export class FastRegistrationService {
  private static readonly PROGRESS_LOG_INTERVAL = 50;
  private static readonly REGISTRATION_CHUNK_SIZE = 1000;
  // 폴더 전체 행을 한 번에 로드하는 비용이 경로 단건 조회보다 싸지는 최소 파일 수.
  // 워처 증분 배치(보통 1~5개)에서는 스냅샷을 만들지 않는다.
  private static readonly SNAPSHOT_MIN_FILE_COUNT = 500;
  // 스냅샷 1회 읽기 크기. 20만행 폴더를 한 번에 읽으면 ~180ms 동안 이벤트 루프가 멈춘다.
  private static readonly SNAPSHOT_PAGE_SIZE = 5000;
  // 한 트랜잭션이 이벤트 루프를 잡고 있어도 되는 예산. 초과하면 커밋하고 양보한다.
  private static readonly WRITE_TIME_BUDGET_MS = 10;
  // 예산을 넘겨도 이 시간 안에는 끝나도록 배치를 줄인다(요청 최대 대기 시간).
  private static readonly MAX_WRITE_PAUSE_MS = 50;
  private static readonly MIN_WRITE_BATCH = 25;
  private static readonly MAX_WRITE_BATCH = 1000;
  private static readonly INITIAL_WRITE_BATCH = 200;
  private static readonly STAT_CONCURRENCY = resolveScanStatConcurrency();

  /**
   * 파일 타입 결정
   */
  static determineFileType(mimeType: string, filePath: string): FileType {
    if (mimeType.startsWith('video/')) {
      return 'video';
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gif' || ext === '.apng') {
      return 'animated';
    }

    return 'image';
  }

  /**
   * 폴더의 기존 파일을 경로 → 행 맵으로 스냅샷 (대량 스캔 전용)
   *
   * Loaded in id-ordered pages with a yield between them. Reading a 200k-row
   * folder in one statement measured ~180ms of uninterrupted event loop, which a
   * concurrent HTTP request feels directly.
   */
  private static async loadFolderFileSnapshot(
    statements: ScanStatements,
    folderId: number
  ): Promise<Map<string, ExistingFileScanRecord>> {
    const knownByPath = new Map<string, ExistingFileScanRecord>();
    let lastId = 0;

    for (;;) {
      const rows = statements.selectFolderFiles.all(
        folderId,
        lastId,
        this.SNAPSHOT_PAGE_SIZE
      ) as ExistingFileScanRecord[];

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        knownByPath.set(row.original_file_path, row);
        lastId = row.id;
      }

      if (rows.length < this.SNAPSHOT_PAGE_SIZE) {
        break;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return knownByPath;
  }

  /**
   * Stat a chunk **outside** any transaction, with bounded concurrency.
   *
   * `fs.statSync` used to run inside the write transaction, so every file's
   * filesystem round trip — tens of milliseconds each on an SMB share — held the
   * SQLite write lock and the event loop. Resolving the chunk first keeps the
   * transaction to pure DB work.
   */
  private static async statChunk(filePaths: string[]): Promise<StattedFile[]> {
    const limit = pLimit(this.STAT_CONCURRENCY);

    return Promise.all(filePaths.map((filePath) => limit(async (): Promise<StattedFile> => {
      try {
        return { filePath, stats: await fs.promises.stat(filePath), error: null };
      } catch (error) {
        return { filePath, stats: null, error };
      }
    })));
  }

  /**
   * Apply planned writes in short transactions, yielding between them.
   *
   * The batch size adapts to the measured commit time so one pass cannot stall a
   * concurrent HTTP request, no matter how slow the underlying disk is.
   */
  private static async applyPlannedWrites(
    planned: PlannedWrite[],
    folderId: number,
    state: { writeBatchSize: number; maxPauseMs: number; writtenRows: number }
  ): Promise<void> {
    const now = new Date().toISOString();

    const runBatch = db.transaction((batch: PlannedWrite[]) => {
      for (const item of batch) {
        if (item.kind === 'update') {
          item.statement.run(now, item.stats.mtime.toISOString(), item.stats.size, item.mimeType, item.existingId);
        } else {
          getScanStatements().insertFile.run(
            item.fileType,
            item.filePath,
            folderId,
            item.stats.size,
            item.mimeType,
            item.stats.mtime.toISOString()
          );
        }
      }
    });

    for (let index = 0; index < planned.length; index += state.writeBatchSize) {
      const batch = planned.slice(index, index + state.writeBatchSize);
      const startedAt = Date.now();
      runBatch(batch);
      const elapsed = Date.now() - startedAt;
      state.writtenRows += batch.length;
      state.maxPauseMs = Math.max(state.maxPauseMs, elapsed);

      if (elapsed > this.MAX_WRITE_PAUSE_MS) {
        state.writeBatchSize = Math.max(this.MIN_WRITE_BATCH, Math.floor(state.writeBatchSize / 2));
      } else if (elapsed < this.WRITE_TIME_BUDGET_MS) {
        state.writeBatchSize = Math.min(this.MAX_WRITE_BATCH, Math.ceil(state.writeBatchSize * 1.5));
      }

      if (index + state.writeBatchSize < planned.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  /**
   * Phase 1: 빠른 등록 처리
   */
  static async processFastRegistration(
    files: string[],
    folderId: number,
    result: ScanResult,
    options: FastRegistrationOptions = {}
  ): Promise<void> {
    const batchStartTime = Date.now();
    const shouldStayQuiet = options.quietIfIdle === true;
    const statements = getScanStatements();

    if (!shouldStayQuiet) {
      console.log(`  Phase 1: 빠른 등록 모드 (일괄 처리, 청크 ${this.REGISTRATION_CHUNK_SIZE}개)`);
    }

    // 대량 스캔에서만 폴더의 기존 파일을 한 번에 로드해 메모리에서 분류.
    // 워처 증분 배치는 파일 수가 적어 폴더 전체 SELECT가 오히려 손해이므로
    // 스냅샷 없이 아래 selectFileByPath 단건 조회 경로만 사용한다.
    const knownByPath = files.length >= this.SNAPSHOT_MIN_FILE_COUNT
      ? await this.loadFolderFileSnapshot(statements, folderId)
      : null;

    let processedCount = 0;
    let unchangedCount = 0;
    const writeState = { writeBatchSize: this.INITIAL_WRITE_BATCH, maxPauseMs: 0, writtenRows: 0 };

    for (let i = 0; i < files.length; i += this.REGISTRATION_CHUNK_SIZE) {
      const chunk = files.slice(i, i + this.REGISTRATION_CHUNK_SIZE);
      const statted = await this.statChunk(chunk);
      const planned: PlannedWrite[] = [];

      for (const entry of statted) {
        try {
          if (!entry.stats) {
            throw entry.error ?? new Error('Unknown error');
          }

          const mimeType = FileDiscoveryService.getMimeType(entry.filePath);

          // original_file_path는 UNIQUE라서 같은 경로가 다른 folder_id로 존재할
          // 수 있음 → 폴더 맵에 없으면 경로 단건 조회로 확인 후 신규 판단
          const existingFile = knownByPath?.get(entry.filePath)
            ?? (statements.selectFileByPath.get(entry.filePath) as ExistingFileScanRecord | undefined);

          if (existingFile) {
            if (needsScanWrite(existingFile, entry.stats, mimeType)) {
              planned.push(planExistingFileWrite(statements, existingFile, entry.stats, mimeType));
            } else {
              unchangedCount++;
            }
            result.existingImages++;
          } else {
            planned.push({
              kind: 'insert',
              filePath: entry.filePath,
              stats: entry.stats,
              mimeType,
              fileType: this.determineFileType(mimeType, entry.filePath),
            });
            result.newImages++;
          }

          result.totalScanned++;
        } catch (error) {
          result.totalScanned++;
          result.errors.push({
            file: entry.filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.error(`  등록 실패: ${path.basename(entry.filePath)}`, error);
        }

        processedCount++;

        // 진행 상황 로그 (기존 파일 재확인 포함 - 재스캔에서도 진행률 보고)
        if (!shouldStayQuiet && (processedCount % this.PROGRESS_LOG_INTERVAL === 0 || processedCount === files.length)) {
          const progress = ScanProgressTracker.calculateProgress(processedCount, files.length, batchStartTime);
          console.log(
            `  Phase 1 진행: ${processedCount}/${files.length} ` +
            `(${progress.speed.toFixed(1)} 이미지/초, 예상 완료: ${progress.etaFormatted})`
          );
        }
      }

      await this.applyPlannedWrites(planned, folderId, writeState);

      // 청크 사이에서 이벤트 루프에 양보 (HTTP 요청 지연 방지)
      if (i + this.REGISTRATION_CHUNK_SIZE < files.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const duration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    if (!shouldStayQuiet) {
      console.log(
        `  Phase 1 완료: ${result.newImages}개 신규, ${result.existingImages}개 기존 ` +
        `(변경 없음 ${unchangedCount}개는 재기록하지 않음, DB 기록 ${writeState.writtenRows}행, ` +
        `최대 트랜잭션 ${writeState.maxPauseMs}ms, ${duration}초)`
      );
    }
  }
}
