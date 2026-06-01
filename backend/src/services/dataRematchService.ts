import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../database/init';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { resolveUploadsPath } from '../config/runtimePaths';
import { ImageSimilarityService } from './imageSimilarity';
import { BackgroundQueueService } from './backgroundQueue';
import { SystemMaintenanceLockService, SystemMaintenanceLockSnapshot } from './systemMaintenanceLockService';
import { ThumbnailGenerator } from '../utils/thumbnailGenerator';
import { generateFileHash } from '../utils/fileHash';
import { toWindowsLongPathIfNeeded } from '../utils/pathResolver';
import { QueryCacheService } from './QueryCacheService';

export type DataRematchPhase =
  | 'idle'
  | 'selecting-targets'
  | 'regenerating-thumbnails'
  | 'queueing-metadata'
  | 'rebuilding-hashes'
  | 'remapping-references'
  | 'completed'
  | 'failed';

export type DataRematchJobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface DataRematchOptions {
  thumbnail: boolean;
  metadata: boolean;
  hash: boolean;
}

export interface DataRematchStartRequest extends Partial<DataRematchOptions> {
  confirmHashRegeneration?: boolean;
}

export interface DataRematchJobSnapshot {
  jobId: string | null;
  status: DataRematchJobStatus;
  phase: DataRematchPhase;
  options: DataRematchOptions;
  total: number;
  processed: number;
  failed: number;
  skipped: number;
  queued: number;
  currentFile: string | null;
  message: string;
  warnings: string[];
  errors: Array<{ target: string; error: string }>;
  startedAt: string | null;
  completedAt: string | null;
  maintenanceLock: SystemMaintenanceLockSnapshot;
}

interface DataRematchJob extends DataRematchJobSnapshot {
  jobId: string;
  status: Exclude<DataRematchJobStatus, 'idle'>;
  startedAt: string;
}

interface DataRematchTarget {
  id: number;
  oldHash: string | null;
  originalFilePath: string;
  fileType: DataRematchSupportedFileType;
  thumbnailPath: string | null;
}

interface HashBuildPayload {
  compositeHash: string;
  perceptualHash: string | null;
  dHash: string | null;
  aHash: string | null;
  colorHistogram: string | null;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
}

interface HashRemapInput {
  oldHash: string | null;
  newHash: string;
  targetFileId: number;
  fileType: DataRematchSupportedFileType;
  payload: HashBuildPayload;
}

interface NormalizationOptions {
  requireHashConfirmation?: boolean;
}

type DataRematchSupportedFileType = typeof DATA_REMATCH_SUPPORTED_FILE_TYPES[number];
type SqlValue = string | number | bigint | Buffer | null;

export const DATA_REMATCH_SUPPORTED_FILE_TYPES = ['image', 'animated'] as const;
export const DATA_REMATCH_EXCLUDED_FILE_TYPES = ['video'] as const;
export const HASH_REGENERATION_BLOCKED_PIPELINES = ['auto-tag-extraction', 'artist-extraction'] as const;
export const DATA_REMATCH_HASH_REFERENCE_TABLES = [
  'media_metadata',
  'image_files',
  'image_groups',
  'auto_folder_group_images',
  'image_models',
  'civitai_temp_urls',
  'image_metadata_edit_revisions',
  'api_generation_history',
] as const;

export const HASH_REGENERATION_WARNINGS = [
  '해시 재생성은 composite_hash 기반 미디어 identity를 다시 쓰는 작업입니다.',
  '기존 그룹, 자동 폴더 그룹, 모델, 임시 URL, 생성 히스토리 연결은 가능한 경우 새 해시로 재매칭하고 중복 충돌만 해제합니다.',
  '작업 중 자동 스캔, 백그라운드 해시 생성, 자동 태그/작가 추출은 대기합니다.',
  '해시 재생성은 자동 태그 추출이나 작가 추출을 직접 실행하지 않습니다. 완료 후 시스템 스케줄러가 DB를 확인해 순차 처리합니다.',
  '비디오는 제외하고 이미지/GIF 계열만 처리합니다.',
] as const;

const IDLE_OPTIONS: DataRematchOptions = {
  thumbnail: false,
  metadata: false,
  hash: false,
};

const SUPPORTED_FILE_TYPE_SQL = DATA_REMATCH_SUPPORTED_FILE_TYPES.map(() => '?').join(', ');

function createIdleSnapshot(): DataRematchJobSnapshot {
  return {
    jobId: null,
    status: 'idle',
    phase: 'idle',
    options: { ...IDLE_OPTIONS },
    total: 0,
    processed: 0,
    failed: 0,
    skipped: 0,
    queued: 0,
    currentFile: null,
    message: '대기 중',
    warnings: [],
    errors: [],
    startedAt: null,
    completedAt: null,
    maintenanceLock: SystemMaintenanceLockService.getStatus(),
  };
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableExists(tableName: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName);
  return Boolean(row);
}

function userTableExists(tableName: string): boolean {
  try {
    const userDb = getUserSettingsDb();
    const row = userDb.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `).get(tableName);
    return Boolean(row);
  } catch {
    return false;
  }
}

function getTableColumns(tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedDataRematchFileTypeValue(fileType: string): fileType is DataRematchSupportedFileType {
  return DATA_REMATCH_SUPPORTED_FILE_TYPES.includes(fileType as DataRematchSupportedFileType);
}

export function isDataRematchSupportedFileType(fileType: string): boolean {
  return isSupportedDataRematchFileTypeValue(fileType);
}

export function normalizeDataRematchOptions(
  input: DataRematchStartRequest,
  options: NormalizationOptions = {},
): DataRematchOptions {
  if (!isRecord(input)) {
    throw new Error('재매칭 옵션이 필요합니다.');
  }

  const normalized: DataRematchOptions = {
    thumbnail: normalizeBoolean(input.thumbnail),
    metadata: normalizeBoolean(input.metadata),
    hash: normalizeBoolean(input.hash),
  };

  if (!normalized.thumbnail && !normalized.metadata && !normalized.hash) {
    throw new Error('재생성 범위를 하나 이상 선택해야 합니다.');
  }

  if (normalized.hash && (normalized.thumbnail || normalized.metadata)) {
    throw new Error('해시 재생성은 단독으로만 실행할 수 있습니다.');
  }

  if (normalized.hash && options.requireHashConfirmation && input.confirmHashRegeneration !== true) {
    throw new Error('해시 재생성 확인이 필요합니다.');
  }

  if (normalized.hash) {
    return { thumbnail: false, metadata: false, hash: true };
  }

  return normalized;
}

export class DataRematchService {
  private static currentJob: DataRematchJobSnapshot = createIdleSnapshot();

  static getStatus(): DataRematchJobSnapshot {
    return {
      ...this.currentJob,
      options: { ...this.currentJob.options },
      warnings: [...this.currentJob.warnings],
      errors: [...this.currentJob.errors],
      maintenanceLock: SystemMaintenanceLockService.getStatus(),
    };
  }

  static startJob(input: DataRematchStartRequest): DataRematchJobSnapshot {
    if (this.currentJob.status === 'running') {
      throw new Error('데이터 재매칭 작업이 이미 실행 중입니다.');
    }

    const options = normalizeDataRematchOptions(input, { requireHashConfirmation: true });
    const jobId = `data-rematch-${Date.now()}`;
    const warnings = options.hash ? [...HASH_REGENERATION_WARNINGS] : [];

    this.currentJob = {
      jobId,
      status: 'running',
      phase: 'selecting-targets',
      options,
      total: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      queued: 0,
      currentFile: null,
      message: '대상 선별 중',
      warnings,
      errors: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      maintenanceLock: SystemMaintenanceLockService.getStatus(),
    };

    void this.runCurrentJob(jobId);
    return this.getStatus();
  }

  private static async runCurrentJob(jobId: string): Promise<void> {
    const job = this.requireRunningJob(jobId);
    const lock = job.options.hash
      ? SystemMaintenanceLockService.acquireExclusive({
          owner: jobId,
          reason: 'data-rematch.hash-regeneration',
          message: '해시 재생성 중입니다. 자동 스캔, 해시 생성, 자동 태그/작가 추출은 대기합니다.',
        })
      : null;

    try {
      if (job.options.hash) {
        await this.rebuildHashes(jobId);
      } else {
        if (job.options.thumbnail) {
          await this.regenerateThumbnails(jobId);
        }
        if (job.options.metadata) {
          await this.queueMetadataReextraction(jobId);
        }
      }

      this.patchJob(jobId, {
        status: 'completed',
        phase: 'completed',
        currentFile: null,
        completedAt: new Date().toISOString(),
        message: '완료',
      });
      QueryCacheService.invalidateGalleryCache();
    } catch (error) {
      this.patchJob(jobId, {
        status: 'failed',
        phase: 'failed',
        currentFile: null,
        completedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : '데이터 재매칭 작업 실패',
      });
    } finally {
      if (lock && SystemMaintenanceLockService.isOwnedBy(jobId)) {
        lock.release();
      }
      this.patchJobIfCurrent(jobId, { maintenanceLock: SystemMaintenanceLockService.getStatus() });
    }
  }

  private static requireRunningJob(jobId: string): DataRematchJob {
    if (this.currentJob.jobId !== jobId || this.currentJob.status !== 'running' || !this.currentJob.startedAt) {
      throw new Error('실행 중인 재매칭 작업을 찾을 수 없습니다.');
    }
    return this.currentJob as DataRematchJob;
  }

  private static patchJob(jobId: string, patch: Partial<DataRematchJobSnapshot>): void {
    if (this.currentJob.jobId !== jobId) {
      throw new Error('작업 상태가 변경되었습니다.');
    }
    this.currentJob = {
      ...this.currentJob,
      ...patch,
      maintenanceLock: patch.maintenanceLock ?? SystemMaintenanceLockService.getStatus(),
    };
  }

  private static patchJobIfCurrent(jobId: string, patch: Partial<DataRematchJobSnapshot>): void {
    if (this.currentJob.jobId !== jobId) {
      return;
    }
    this.currentJob = {
      ...this.currentJob,
      ...patch,
      maintenanceLock: patch.maintenanceLock ?? SystemMaintenanceLockService.getStatus(),
    };
  }

  private static pushError(jobId: string, target: string, error: unknown): void {
    if (this.currentJob.jobId !== jobId) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.currentJob = {
      ...this.currentJob,
      failed: this.currentJob.failed + 1,
      errors: [...this.currentJob.errors, { target, error: message }].slice(-50),
      maintenanceLock: SystemMaintenanceLockService.getStatus(),
    };
  }

  private static loadRepresentativeTargets(requireExistingHash: boolean): DataRematchTarget[] {
    const nullHashClause = requireExistingHash ? '' : 'OR f.composite_hash IS NULL';
    const rows = db.prepare(`
      SELECT
        f.id,
        f.composite_hash as oldHash,
        f.original_file_path as originalFilePath,
        f.file_type as fileType,
        m.thumbnail_path as thumbnailPath
      FROM image_files f
      LEFT JOIN media_metadata m ON m.composite_hash = f.composite_hash
      WHERE f.file_status = 'active'
        AND f.file_type IN (${SUPPORTED_FILE_TYPE_SQL})
        AND f.original_file_path IS NOT NULL
        AND (
          (
            f.composite_hash IS NOT NULL
            AND f.id = (
              SELECT f2.id
              FROM image_files f2
              WHERE f2.composite_hash = f.composite_hash
                AND f2.file_status = 'active'
                AND f2.file_type IN (${SUPPORTED_FILE_TYPE_SQL})
                AND f2.original_file_path IS NOT NULL
              ORDER BY f2.last_verified_date DESC, f2.id DESC
              LIMIT 1
            )
          )
          ${nullHashClause}
        )
      ORDER BY f.scan_date DESC, f.id DESC
    `).all(
      ...DATA_REMATCH_SUPPORTED_FILE_TYPES,
      ...DATA_REMATCH_SUPPORTED_FILE_TYPES,
    ) as Array<{
      id: number;
      oldHash: string | null;
      originalFilePath: string;
      fileType: string;
      thumbnailPath: string | null;
    }>;

    return rows
      .filter((row) => isSupportedDataRematchFileTypeValue(row.fileType))
      .map((row) => ({
        id: row.id,
        oldHash: row.oldHash,
        originalFilePath: row.originalFilePath,
        fileType: row.fileType as DataRematchSupportedFileType,
        thumbnailPath: row.thumbnailPath,
      }));
  }

  private static async regenerateThumbnails(jobId: string): Promise<void> {
    const targets = this.loadRepresentativeTargets(true);
    this.patchJob(jobId, {
      phase: 'regenerating-thumbnails',
      total: targets.length,
      processed: 0,
      skipped: 0,
      message: '썸네일 재생성 중',
    });

    for (const target of targets) {
      const fullPath = resolveUploadsPath(target.originalFilePath);
      this.patchJob(jobId, { currentFile: target.originalFilePath });

      if (!fs.existsSync(fullPath) || !target.oldHash) {
        this.patchJob(jobId, {
          skipped: this.currentJob.skipped + 1,
          processed: this.currentJob.processed + 1,
        });
        continue;
      }

      try {
        if (target.thumbnailPath) {
          await ThumbnailGenerator.deleteThumbnail(target.thumbnailPath);
        }
        const thumbnailPath = await ThumbnailGenerator.generateThumbnail(fullPath, target.oldHash);
        db.prepare(`
          UPDATE media_metadata
          SET thumbnail_path = ?, metadata_updated_date = CURRENT_TIMESTAMP
          WHERE composite_hash = ?
        `).run(thumbnailPath, target.oldHash);
      } catch (error) {
        this.pushError(jobId, target.originalFilePath, error);
      }

      this.patchJob(jobId, { processed: this.currentJob.processed + 1 });
      await this.yieldToLoop();
    }
  }

  private static async queueMetadataReextraction(jobId: string): Promise<void> {
    const targets = this.loadRepresentativeTargets(true);
    this.patchJob(jobId, {
      phase: 'queueing-metadata',
      total: targets.length,
      processed: 0,
      skipped: 0,
      queued: 0,
      message: '메타데이터 재추출 큐 등록 중',
    });

    for (const target of targets) {
      const fullPath = resolveUploadsPath(target.originalFilePath);
      this.patchJob(jobId, { currentFile: target.originalFilePath });

      if (!fs.existsSync(fullPath) || !target.oldHash) {
        this.patchJob(jobId, {
          skipped: this.currentJob.skipped + 1,
          processed: this.currentJob.processed + 1,
        });
        continue;
      }

      try {
        BackgroundQueueService.addMetadataExtractionTask(fullPath, target.oldHash);
        this.patchJob(jobId, { queued: this.currentJob.queued + 1 });
      } catch (error) {
        this.pushError(jobId, target.originalFilePath, error);
      }

      this.patchJob(jobId, { processed: this.currentJob.processed + 1 });
      await this.yieldToLoop();
    }
  }

  private static async rebuildHashes(jobId: string): Promise<void> {
    const targets = this.loadRepresentativeTargets(false);
    this.patchJob(jobId, {
      phase: 'rebuilding-hashes',
      total: targets.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      queued: 0,
      message: '해시 재생성 및 참조 리매칭 중',
    });

    for (const target of targets) {
      const fullPath = resolveUploadsPath(target.originalFilePath);
      this.patchJob(jobId, {
        phase: 'rebuilding-hashes',
        currentFile: target.originalFilePath,
      });

      if (!fs.existsSync(fullPath)) {
        this.patchJob(jobId, {
          skipped: this.currentJob.skipped + 1,
          processed: this.currentJob.processed + 1,
        });
        continue;
      }

      try {
        const payload = await this.buildHashPayload(target.fileType, fullPath);
        this.patchJob(jobId, { phase: 'remapping-references' });
        this.applyHashRemap({
          oldHash: target.oldHash,
          newHash: payload.compositeHash,
          targetFileId: target.id,
          fileType: target.fileType,
          payload,
        });
      } catch (error) {
        this.pushError(jobId, target.originalFilePath, error);
      }

      this.patchJob(jobId, { processed: this.currentJob.processed + 1 });
      await this.yieldToLoop();
    }
  }

  private static async buildHashPayload(fileType: DataRematchSupportedFileType, fullPath: string): Promise<HashBuildPayload> {
    const sharpMetadata = await sharp(toWindowsLongPathIfNeeded(fullPath)).metadata();
    const width = sharpMetadata.width ?? null;
    const height = sharpMetadata.height ?? null;

    if (fileType === 'animated') {
      const compositeHash = await generateFileHash(fullPath);
      const thumbnailPath = await ThumbnailGenerator.generateThumbnail(fullPath, compositeHash);
      return {
        compositeHash,
        perceptualHash: null,
        dHash: null,
        aHash: null,
        colorHistogram: null,
        width,
        height,
        thumbnailPath,
      };
    }

    const { hashes, colorHistogram } = await ImageSimilarityService.generateHashAndHistogram(fullPath);
    const thumbnailPath = await ThumbnailGenerator.generateThumbnail(fullPath, hashes.compositeHash);
    return {
      compositeHash: hashes.compositeHash,
      perceptualHash: hashes.perceptualHash,
      dHash: hashes.dHash,
      aHash: hashes.aHash,
      colorHistogram: JSON.stringify(colorHistogram),
      width,
      height,
      thumbnailPath,
    };
  }

  private static applyHashRemap(input: HashRemapInput): void {
    const transaction = db.transaction(() => {
      this.ensureMediaMetadataForHash(input);

      if (!input.oldHash) {
        db.prepare(`
          UPDATE image_files
          SET composite_hash = ?, last_verified_date = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(input.newHash, input.targetFileId);
        return;
      }

      this.remapHashReferenceTables(input.oldHash, input.newHash);

      if (input.oldHash === input.newHash) {
        this.updateMediaMetadataTechnicalFields(input.newHash, input.payload);
        db.prepare(`
          UPDATE image_files
          SET last_verified_date = CURRENT_TIMESTAMP
          WHERE composite_hash = ?
            AND file_type IN (${SUPPORTED_FILE_TYPE_SQL})
        `).run(input.oldHash, ...DATA_REMATCH_SUPPORTED_FILE_TYPES);
        return;
      }

      db.prepare(`
        UPDATE image_files
        SET composite_hash = ?, last_verified_date = CURRENT_TIMESTAMP
        WHERE composite_hash = ?
          AND file_type IN (${SUPPORTED_FILE_TYPE_SQL})
      `).run(input.newHash, input.oldHash, ...DATA_REMATCH_SUPPORTED_FILE_TYPES);

      db.prepare(`
        DELETE FROM media_metadata
        WHERE composite_hash = ?
          AND NOT EXISTS (
            SELECT 1
            FROM image_files
            WHERE composite_hash = ?
            LIMIT 1
          )
      `).run(input.oldHash, input.oldHash);
    });

    transaction();
    this.remapApiGenerationHistory(input.oldHash, input.newHash);
  }

  private static ensureMediaMetadataForHash(input: HashRemapInput): void {
    const columns = getTableColumns('media_metadata');
    if (columns.length === 0) {
      throw new Error('media_metadata 테이블을 찾을 수 없습니다.');
    }

    const existing = db.prepare('SELECT composite_hash FROM media_metadata WHERE composite_hash = ?').get(input.newHash);
    if (existing) {
      this.updateMediaMetadataTechnicalFields(input.newHash, input.payload);
      return;
    }

    const oldRow = input.oldHash
      ? db.prepare('SELECT * FROM media_metadata WHERE composite_hash = ?').get(input.oldHash) as Record<string, unknown> | undefined
      : undefined;

    const now = new Date().toISOString();
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      row[column] = oldRow?.[column] ?? null;
    }

    row.composite_hash = input.newHash;
    row.perceptual_hash = input.payload.perceptualHash;
    row.dhash = input.payload.dHash;
    row.ahash = input.payload.aHash;
    row.color_histogram = input.payload.colorHistogram;
    row.width = input.payload.width;
    row.height = input.payload.height;
    row.thumbnail_path = input.payload.thumbnailPath;
    if ('metadata_updated_date' in row) {
      row.metadata_updated_date = now;
    }
    if ('first_seen_date' in row && !row.first_seen_date) {
      row.first_seen_date = now;
    }

    const columnSql = columns.map(quoteIdentifier).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO media_metadata (${columnSql}) VALUES (${placeholders})`)
      .run(...columns.map((column) => toSqlValue(row[column])));
  }

  private static updateMediaMetadataTechnicalFields(compositeHash: string, payload: HashBuildPayload): void {
    db.prepare(`
      UPDATE media_metadata
      SET perceptual_hash = ?,
          dhash = ?,
          ahash = ?,
          color_histogram = ?,
          width = COALESCE(?, width),
          height = COALESCE(?, height),
          thumbnail_path = COALESCE(?, thumbnail_path),
          metadata_updated_date = CURRENT_TIMESTAMP
      WHERE composite_hash = ?
    `).run(
      payload.perceptualHash,
      payload.dHash,
      payload.aHash,
      payload.colorHistogram,
      payload.width,
      payload.height,
      payload.thumbnailPath,
      compositeHash,
    );
  }

  private static remapHashReferenceTables(oldHash: string, newHash: string): void {
    if (oldHash === newHash) return;

    this.remapHashRefTableRows('image_groups', oldHash, newHash);
    this.remapHashRefTableRows('auto_folder_group_images', oldHash, newHash);
    this.remapHashRefTableRows('image_models', oldHash, newHash);
    this.remapHashRefTableRows('civitai_temp_urls', oldHash, newHash);
    this.remapHashRefTableRows('image_metadata_edit_revisions', oldHash, newHash);
  }

  private static remapHashRefTableRows(tableName: string, oldHash: string, newHash: string): void {
    if (!tableExists(tableName)) return;

    db.prepare(`
      UPDATE OR IGNORE ${quoteIdentifier(tableName)}
      SET composite_hash = ?
      WHERE composite_hash = ?
    `).run(newHash, oldHash);

    db.prepare(`
      DELETE FROM ${quoteIdentifier(tableName)}
      WHERE composite_hash = ?
    `).run(oldHash);
  }

  private static remapApiGenerationHistory(oldHash: string | null, newHash: string): void {
    if (!oldHash || !userTableExists('api_generation_history')) {
      return;
    }

    try {
      const userDb = getUserSettingsDb();
      if (oldHash !== newHash) {
        userDb.prepare(`
          UPDATE OR IGNORE api_generation_history
          SET composite_hash = ?
          WHERE composite_hash = ?
        `).run(newHash, oldHash);
      }

      userDb.prepare(`
        DELETE FROM api_generation_history
        WHERE composite_hash = ?
      `).run(oldHash);
    } catch (error) {
      console.warn('[DataRematch] api_generation_history detach skipped:', error instanceof Error ? error.message : error);
    }
  }

  private static yieldToLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}
