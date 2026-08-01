import type Database from 'better-sqlite3';
import { db } from '../../database/init';
import fs from 'fs';
import path from 'path';
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
}

interface ScanStatements {
  selectFolderFiles: Database.Statement;
  selectFileByPath: Database.Statement;
  touchDeletedFile: Database.Statement;
  reactivateFile: Database.Statement;
  insertFile: Database.Statement;
}

// Prepared once per process (lazily, so module import order cannot race schema
// creation) instead of recompiling SQL for every scanned file.
let scanStatements: ScanStatements | null = null;

function getScanStatements(): ScanStatements {
  if (!scanStatements) {
    scanStatements = {
      selectFolderFiles: db.prepare(
        'SELECT id, original_file_path, composite_hash, file_status FROM image_files WHERE folder_id = ?'
      ),
      selectFileByPath: db.prepare(
        'SELECT id, original_file_path, composite_hash, file_status FROM image_files WHERE original_file_path = ?'
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

/** Reconcile one already-known file without reviving intentionally deleted rows. */
function reconcileExistingFileDuringScan(
  statements: ScanStatements,
  existingFile: ExistingFileScanRecord,
  stats: fs.Stats,
  mimeType: string
) {
  const statement = existingFile.file_status === 'deleted'
    ? statements.touchDeletedFile
    : statements.reactivateFile;

  statement.run(
    new Date().toISOString(),
    stats.mtime.toISOString(),
    stats.size,
    mimeType,
    existingFile.id
  );
}

export class FastRegistrationService {
  private static readonly PROGRESS_LOG_INTERVAL = 50;
  private static readonly REGISTRATION_CHUNK_SIZE = 1000;
  // 폴더 전체 행을 한 번에 로드하는 비용이 경로 단건 조회보다 싸지는 최소 파일 수.
  // 워처 증분 배치(보통 1~5개)에서는 스냅샷을 만들지 않는다.
  private static readonly SNAPSHOT_MIN_FILE_COUNT = 500;

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

  /** 폴더의 기존 파일을 경로 → 행 맵으로 스냅샷 (대량 스캔 전용) */
  private static loadFolderFileSnapshot(
    statements: ScanStatements,
    folderId: number
  ): Map<string, ExistingFileScanRecord> {
    const knownByPath = new Map<string, ExistingFileScanRecord>();
    for (const row of statements.selectFolderFiles.all(folderId) as ExistingFileScanRecord[]) {
      knownByPath.set(row.original_file_path, row);
    }

    return knownByPath;
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
      ? this.loadFolderFileSnapshot(statements, folderId)
      : null;

    let processedCount = 0;

    const registerChunk = db.transaction((chunk: string[]) => {
      for (const filePath of chunk) {
        try {
          const stats = fs.statSync(filePath);
          const mimeType = FileDiscoveryService.getMimeType(filePath);

          // original_file_path는 UNIQUE라서 같은 경로가 다른 folder_id로 존재할
          // 수 있음 → 폴더 맵에 없으면 경로 단건 조회로 확인 후 신규 판단
          const existingFile = knownByPath?.get(filePath)
            ?? (statements.selectFileByPath.get(filePath) as ExistingFileScanRecord | undefined);

          if (existingFile) {
            reconcileExistingFileDuringScan(statements, existingFile, stats, mimeType);
            result.existingImages++;
          } else {
            const fileType = this.determineFileType(mimeType, filePath);
            statements.insertFile.run(
              fileType,
              filePath,
              folderId,
              stats.size,
              mimeType,
              stats.mtime.toISOString()
            );
            result.newImages++;
          }

          result.totalScanned++;
        } catch (error) {
          result.totalScanned++;
          result.errors.push({
            file: filePath,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          console.error(`  등록 실패: ${path.basename(filePath)}`, error);
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
    });

    for (let i = 0; i < files.length; i += this.REGISTRATION_CHUNK_SIZE) {
      registerChunk(files.slice(i, i + this.REGISTRATION_CHUNK_SIZE));

      // 청크 사이에서 이벤트 루프에 양보 (HTTP 요청 지연 방지)
      if (i + this.REGISTRATION_CHUNK_SIZE < files.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    const duration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    if (!shouldStayQuiet) {
      console.log(`  Phase 1 완료: ${result.newImages}개 신규, ${result.existingImages}개 기존 (${duration}초)`);
    }
  }
}
