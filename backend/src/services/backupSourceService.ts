import fs from 'fs';
import path from 'path';
import { db } from '../database/init';
import { runtimePaths } from '../config/runtimePaths';

type BackupImportMode = 'copy_original' | 'convert_webp';

type ServiceError = Error & { statusCode?: number };

function createServiceError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

function normalizeComparePath(inputPath: string): string {
  return path.resolve(inputPath).replace(/[\\/]+$/, '').toLowerCase();
}

/** Validate and normalize a source path for backup ingestion. */
function normalizeSourcePath(sourcePath: string): string {
  const isNetworkPath = sourcePath.startsWith('\\\\') || sourcePath.startsWith('//');
  return isNetworkPath ? sourcePath.replace(/\//g, '\\') : path.resolve(sourcePath);
}

/** Validate and normalize a relative target path under uploads. */
function normalizeTargetFolderName(targetFolderName: string): string {
  const trimmed = targetFolderName.trim();

  if (!trimmed) {
    throw createServiceError('target_folder_name이 필요합니다', 400);
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[\\/]{2,}/.test(trimmed)) {
    throw createServiceError('대상 경로는 Upload 내부 상대 경로만 사용할 수 있습니다', 400);
  }

  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads?(?:\/+|$)/i, '');

  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw createServiceError('target_folder_name이 필요합니다', 400);
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('..')) {
      throw createServiceError('대상 경로에 상위 경로 이동은 사용할 수 없습니다', 400);
    }

    if (!/^[a-zA-Z0-9 _.-]+$/.test(segment)) {
      throw createServiceError('대상 경로의 각 폴더명은 영문, 숫자, 공백, _, -, . 만 사용할 수 있습니다', 400);
    }
  }

  return segments.join('/');
}

/** Check whether two paths overlap and could create a watcher loop. */
function assertSafeSourcePath(sourcePath: string): void {
  const normalizedSource = normalizeComparePath(sourcePath);
  const normalizedUploads = normalizeComparePath(runtimePaths.uploadsDir);

  const sourceToUploads = path.relative(normalizedSource, normalizedUploads);
  const uploadsToSource = path.relative(normalizedUploads, normalizedSource);

  const sourceContainsUploads = sourceToUploads === '' || (!sourceToUploads.startsWith('..') && !path.isAbsolute(sourceToUploads));
  const uploadsContainsSource = uploadsToSource === '' || (!uploadsToSource.startsWith('..') && !path.isAbsolute(uploadsToSource));

  if (sourceContainsUploads || uploadsContainsSource) {
    throw createServiceError('source_path는 uploads 경로와 겹칠 수 없습니다', 400);
  }
}

/** Ensure a source folder exists and is readable. */
function assertExistingDirectory(sourcePath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw createServiceError(`폴더가 존재하지 않습니다: ${sourcePath}`, 400);
  }

  const stats = fs.statSync(sourcePath);
  if (!stats.isDirectory()) {
    throw createServiceError(`경로가 폴더가 아닙니다: ${sourcePath}`, 400);
  }

  fs.accessSync(sourcePath, fs.constants.R_OK);
}

/** Resolve the target directory under uploads for a backup source. */
export function resolveBackupTargetDirectory(targetFolderName: string): string {
  return path.join(runtimePaths.uploadsDir, normalizeTargetFolderName(targetFolderName));
}

/** Ensure the target directory exists before importing files. */
export function ensureBackupTargetDirectory(targetFolderName: string): string {
  const targetDir = resolveBackupTargetDirectory(targetFolderName);
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

export interface BackupSource {
  id: number;
  source_path: string;
  display_name: string | null;
  target_folder_name: string;
  recursive: number;
  watcher_enabled: number;
  watcher_polling_interval: number | null;
  import_mode: BackupImportMode;
  webp_quality: number;
  is_active: number;
  watcher_status: string | null;
  watcher_error: string | null;
  watcher_last_event: string | null;
  created_date: string;
  updated_date: string;
}

export interface BackupSourceCreate {
  source_path: string;
  display_name?: string;
  target_folder_name: string;
  recursive?: boolean;
  watcher_enabled?: boolean;
  watcher_polling_interval?: number | null;
  import_mode?: BackupImportMode;
  webp_quality?: number;
}

export interface BackupSourceUpdate {
  source_path?: string;
  display_name?: string;
  target_folder_name?: string;
  recursive?: boolean;
  watcher_enabled?: boolean;
  watcher_polling_interval?: number | null;
  import_mode?: BackupImportMode;
  webp_quality?: number;
  is_active?: boolean;
}

export class BackupSourceService {
  /** List all registered backup sources. */
  static async listSources(options?: { active_only?: boolean }): Promise<BackupSource[]> {
    let query = 'SELECT * FROM backup_sources WHERE 1=1';
    const params: any[] = [];

    if (options?.active_only) {
      query += ' AND is_active = 1';
    }

    query += ' ORDER BY created_date DESC';

    return db.prepare(query).all(...params) as BackupSource[];
  }

  /** Load one backup source by id. */
  static async getSource(id: number): Promise<BackupSource | null> {
    const row = db.prepare('SELECT * FROM backup_sources WHERE id = ?').get(id);
    return (row as BackupSource | undefined) ?? null;
  }

  /** Create a new backup source entry. */
  static async addSource(input: BackupSourceCreate): Promise<number> {
    const sourcePath = normalizeSourcePath(input.source_path);
    const targetFolderName = normalizeTargetFolderName(input.target_folder_name);

    assertExistingDirectory(sourcePath);
    assertSafeSourcePath(sourcePath);
    ensureBackupTargetDirectory(targetFolderName);

    const existing = db.prepare('SELECT id FROM backup_sources WHERE source_path = ?').get(sourcePath) as { id: number } | undefined;
    if (existing) {
      throw createServiceError('이미 등록된 source_path입니다', 400);
    }

    const importMode: BackupImportMode = input.import_mode === 'convert_webp' ? 'convert_webp' : 'copy_original';
    const webpQuality = Math.min(100, Math.max(1, input.webp_quality ?? 90));

    const info = db.prepare(`
      INSERT INTO backup_sources (
        source_path, display_name, target_folder_name, recursive,
        watcher_enabled, watcher_polling_interval, import_mode, webp_quality,
        is_active, created_date, updated_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      sourcePath,
      input.display_name?.trim() || path.basename(sourcePath),
      targetFolderName,
      input.recursive === false ? 0 : 1,
      input.watcher_enabled === false ? 0 : 1,
      input.watcher_polling_interval ?? null,
      importMode,
      webpQuality,
      new Date().toISOString(),
      new Date().toISOString()
    );

    return info.lastInsertRowid as number;
  }

  /** Update an existing backup source entry. */
  static async updateSource(id: number, updates: BackupSourceUpdate): Promise<boolean> {
    const current = await this.getSource(id);
    if (!current) {
      return false;
    }

    const nextSourcePath = updates.source_path !== undefined ? normalizeSourcePath(updates.source_path) : current.source_path;
    const nextTargetFolderName = updates.target_folder_name !== undefined ? normalizeTargetFolderName(updates.target_folder_name) : current.target_folder_name;

    assertExistingDirectory(nextSourcePath);
    assertSafeSourcePath(nextSourcePath);
    ensureBackupTargetDirectory(nextTargetFolderName);

    const duplicate = db.prepare('SELECT id FROM backup_sources WHERE source_path = ? AND id != ?').get(nextSourcePath, id) as { id: number } | undefined;
    if (duplicate) {
      throw createServiceError('이미 등록된 source_path입니다', 400);
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.source_path !== undefined) {
      fields.push('source_path = ?');
      values.push(nextSourcePath);
    }

    if (updates.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(updates.display_name.trim() || path.basename(nextSourcePath));
    }

    if (updates.target_folder_name !== undefined) {
      fields.push('target_folder_name = ?');
      values.push(nextTargetFolderName);
    }

    if (updates.recursive !== undefined) {
      fields.push('recursive = ?');
      values.push(updates.recursive ? 1 : 0);
    }

    if (updates.watcher_enabled !== undefined) {
      fields.push('watcher_enabled = ?');
      values.push(updates.watcher_enabled ? 1 : 0);
    }

    if (updates.watcher_polling_interval !== undefined) {
      fields.push('watcher_polling_interval = ?');
      values.push(updates.watcher_polling_interval);
    }

    if (updates.import_mode !== undefined) {
      fields.push('import_mode = ?');
      values.push(updates.import_mode === 'convert_webp' ? 'convert_webp' : 'copy_original');
    }

    if (updates.webp_quality !== undefined) {
      fields.push('webp_quality = ?');
      values.push(Math.min(100, Math.max(1, updates.webp_quality)));
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const info = db.prepare(`UPDATE backup_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return info.changes > 0;
  }

  /** Delete a backup source entry. */
  static async deleteSource(id: number): Promise<boolean> {
    const info = db.prepare('DELETE FROM backup_sources WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /** Update runtime watcher status fields for a backup source. */
  static updateWatcherState(id: number, status: string, error?: string | null): void {
    db.prepare(`
      UPDATE backup_sources
      SET watcher_status = ?, watcher_error = ?, updated_date = ?
      WHERE id = ?
    `).run(status, error ?? null, new Date().toISOString(), id);
  }

  /** Update the last event timestamp for a backup source watcher. */
  static updateWatcherLastEvent(id: number): void {
    db.prepare(`
      UPDATE backup_sources
      SET watcher_last_event = ?, watcher_error = NULL, updated_date = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), id);
  }

  /** Validate a source path before creating or updating a backup source. */
  static async validateSourcePath(sourcePath: string): Promise<{ exists: boolean; isDirectory: boolean; error?: string }> {
    try {
      const normalized = normalizeSourcePath(sourcePath);
      assertExistingDirectory(normalized);
      assertSafeSourcePath(normalized);
      return { exists: true, isDirectory: true };
    } catch (error) {
      return {
        exists: false,
        isDirectory: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
