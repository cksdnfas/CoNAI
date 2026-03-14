import { db } from '../database/init';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

const DEFAULT_UPLOAD_FOLDER_NAME = 'Upload';

type ServiceError = Error & { statusCode?: number };

function createServiceError(message: string, statusCode: number): ServiceError {
  const error = new Error(message) as ServiceError;
  error.statusCode = statusCode;
  return error;
}

export interface WatchedFolder {
  id: number;
  folder_path: string;
  folder_name: string | null;
  auto_scan: number;
  scan_interval: number;
  recursive: number;
  exclude_extensions: string | null;
  exclude_patterns: string | null;
  watcher_enabled: number;
  watcher_polling_interval: number | null;
  is_active: number;
  is_default: number;
  last_scan_date: string | null;
  last_scan_status: string | null;
  last_scan_found: number;
  last_scan_error: string | null;
  created_date: string;
  updated_date: string;
}

export interface WatchedFolderCreate {
  folder_path: string;
  folder_name?: string;
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  exclude_extensions?: string[];
  exclude_patterns?: string[];
  watcher_enabled?: boolean;
  watcher_polling_interval?: number | null;
}

export interface WatchedFolderUpdate {
  folder_name?: string;
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  exclude_extensions?: string[];
  exclude_patterns?: string[];
  is_active?: boolean;
  watcher_enabled?: number;  // 0 or 1
  watcher_polling_interval?: number | null;
}

export class WatchedFolderService {
  static async reconcileDefaultUploadFolder(): Promise<WatchedFolder> {
    const runtimeUploadsPath = path.resolve(runtimePaths.uploadsDir);
    const timestamp = new Date().toISOString();

    const existingRuntimeFolder = db.prepare(`
      SELECT * FROM watched_folders WHERE folder_path = ?
    `).get(runtimeUploadsPath) as WatchedFolder | undefined;

    const existingDefaultUploadFolder = db.prepare(`
      SELECT * FROM watched_folders
      WHERE folder_name = ?
      ORDER BY
        CASE
          WHEN folder_path = ? THEN 0
          WHEN is_default = 1 THEN 1
          ELSE 2
        END,
        id ASC
      LIMIT 1
    `).get(DEFAULT_UPLOAD_FOLDER_NAME, runtimeUploadsPath) as WatchedFolder | undefined;

    const targetFolder = existingRuntimeFolder ?? existingDefaultUploadFolder;

    if (!targetFolder) {
      const info = db.prepare(`
        INSERT INTO watched_folders (
          folder_path, folder_name, auto_scan, scan_interval,
          recursive, is_active, watcher_enabled, is_default, created_date, updated_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runtimeUploadsPath,
        DEFAULT_UPLOAD_FOLDER_NAME,
        1,
        60,
        1,
        1,
        1,
        1,
        timestamp,
        timestamp
      );

      const insertedFolder = await this.getFolder(info.lastInsertRowid as number);
      if (!insertedFolder) {
        throw new Error('기본 Upload 폴더를 조회할 수 없습니다');
      }

      return insertedFolder;
    }

    const reconcileDefaultUploadFolder = db.transaction(() => {
      db.prepare(`
        UPDATE watched_folders
        SET is_default = 0, updated_date = ?
        WHERE id != ? AND folder_name = ? AND is_default = 1
      `).run(timestamp, targetFolder.id, DEFAULT_UPLOAD_FOLDER_NAME);

      db.prepare(`
        UPDATE watched_folders
        SET folder_path = ?, folder_name = ?, auto_scan = 1, recursive = 1,
            watcher_enabled = 1, is_active = 1, is_default = 1, updated_date = ?
        WHERE id = ?
      `).run(runtimeUploadsPath, DEFAULT_UPLOAD_FOLDER_NAME, timestamp, targetFolder.id);
    });

    reconcileDefaultUploadFolder();

    const reconciledFolder = await this.getFolder(targetFolder.id);
    if (!reconciledFolder) {
      throw new Error('기본 Upload 폴더를 조회할 수 없습니다');
    }

    return reconciledFolder;
  }

  /**
   * 폴더 등록
   */
  static async addFolder(folderData: WatchedFolderCreate): Promise<number> {
    // 네트워크 경로 감지 (UNC 경로: \\server\share 또는 //server/share)
    const isNetworkPath = folderData.folder_path.startsWith('\\\\') || folderData.folder_path.startsWith('//');

    // 경로 정규화
    // - 네트워크 경로(UNC): path.resolve() 사용하지 않음 (원본 유지, forward slash만 통일)
    // - 로컬 경로: 절대 경로로 변환
    const absolutePath = isNetworkPath
      ? folderData.folder_path.replace(/\//g, '\\')  // UNC 경로는 백슬래시로 통일
      : path.resolve(folderData.folder_path);

    // 폴더 존재 확인
    if (!fs.existsSync(absolutePath)) {
      const errorMsg = isNetworkPath
        ? `네트워크 경로에 접근할 수 없습니다: ${absolutePath}\n경로, 권한 및 네트워크 연결을 확인해주세요.`
        : `폴더가 존재하지 않습니다: ${absolutePath}`;
      throw new Error(errorMsg);
    }

    // 폴더인지 확인
    const stats = fs.statSync(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(`경로가 폴더가 아닙니다: ${absolutePath}`);
    }

    // 중복 확인
    const existing = db.prepare(
      'SELECT id FROM watched_folders WHERE folder_path = ?'
    ).get(absolutePath) as { id: number } | undefined;

    if (existing) {
      throw new Error('이미 등록된 폴더입니다');
    }

    // 삽입
    const info = db.prepare(`
      INSERT INTO watched_folders (
        folder_path, folder_name, auto_scan, scan_interval,
        recursive, exclude_extensions, exclude_patterns, watcher_enabled, watcher_polling_interval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      absolutePath,
      folderData.folder_name || path.basename(absolutePath),
      folderData.auto_scan ? 1 : 0,
      folderData.scan_interval || 60,
      folderData.recursive !== false ? 1 : 0,
      folderData.exclude_extensions ? JSON.stringify(folderData.exclude_extensions) : null,
      folderData.exclude_patterns ? JSON.stringify(folderData.exclude_patterns) : null,
      folderData.watcher_enabled ? 1 : 0,
      folderData.watcher_polling_interval ?? null
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 폴더 목록 조회
   */
  static async listFolders(options?: {
    active_only?: boolean;
  }): Promise<WatchedFolder[]> {
    let query = 'SELECT * FROM watched_folders WHERE 1=1';
    const params: any[] = [];

    if (options?.active_only) {
      query += ' AND is_active = 1';
    }

    query += ' ORDER BY created_date DESC';

    return db.prepare(query).all(...params) as WatchedFolder[];
  }

  /**
   * 폴더 정보 조회
   */
  static async getFolder(id: number): Promise<WatchedFolder | null> {
    const row = db.prepare('SELECT * FROM watched_folders WHERE id = ?').get(id);
    return row as WatchedFolder | null;
  }

  /**
   * 폴더 업데이트
   */
  static async updateFolder(id: number, updates: WatchedFolderUpdate): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.folder_name !== undefined) {
      fields.push('folder_name = ?');
      values.push(updates.folder_name);
    }

    if (updates.auto_scan !== undefined) {
      fields.push('auto_scan = ?');
      values.push(updates.auto_scan ? 1 : 0);
    }

    if (updates.scan_interval !== undefined) {
      fields.push('scan_interval = ?');
      values.push(updates.scan_interval);
    }

    if (updates.recursive !== undefined) {
      fields.push('recursive = ?');
      values.push(updates.recursive ? 1 : 0);
    }

    if (updates.exclude_extensions !== undefined) {
      fields.push('exclude_extensions = ?');
      values.push(JSON.stringify(updates.exclude_extensions));
    }

    if (updates.exclude_patterns !== undefined) {
      fields.push('exclude_patterns = ?');
      values.push(JSON.stringify(updates.exclude_patterns));
    }

    if (updates.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    if (updates.watcher_enabled !== undefined) {
      fields.push('watcher_enabled = ?');
      values.push(updates.watcher_enabled ? 1 : 0);
    }

    if (updates.watcher_polling_interval !== undefined) {
      fields.push('watcher_polling_interval = ?');
      values.push(updates.watcher_polling_interval);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const info = db.prepare(`
      UPDATE watched_folders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return info.changes > 0;
  }

  /**
   * 폴더 삭제
   */
  static async deleteFolder(id: number, deleteFiles: boolean = false): Promise<boolean> {
    const folder = db.prepare(`
      SELECT id, folder_name, is_default FROM watched_folders WHERE id = ?
    `).get(id) as Pick<WatchedFolder, 'id' | 'folder_name' | 'is_default'> | undefined;

    if (!folder) {
      return false;
    }

    if (folder.is_default === 1 && folder.folder_name === DEFAULT_UPLOAD_FOLDER_NAME) {
      throw createServiceError('기본 Upload 폴더는 삭제할 수 없습니다', 400);
    }

    if (deleteFiles) {
      // image_files에서도 삭제 (CASCADE로 자동 처리됨)
      // 하지만 media_metadata는 유지 (다른 폴더에서 참조 가능)
    }

    const info = db.prepare('DELETE FROM watched_folders WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 스캔 상태 업데이트
   */
  static async updateScanStatus(
    id: number,
    status: 'success' | 'error' | 'in_progress',
    found?: number,
    error?: string
  ): Promise<void> {
    const updates: any = {
      last_scan_status: status,
      last_scan_date: new Date().toISOString()
    };

    if (found !== undefined) {
      updates.last_scan_found = found;
    }

    if (error) {
      updates.last_scan_error = error;
    }

    const fields = Object.keys(updates).map(key => `${key} = ?`);
    const values = Object.values(updates);
    values.push(id);

    db.prepare(`
      UPDATE watched_folders SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);
  }

  /**
   * 폴더 경로 존재 확인
   */
  static async validateFolderPath(folderPath: string): Promise<{
    exists: boolean;
    isDirectory: boolean;
    isNetworkPath?: boolean;
    error?: string;
  }> {
    // 네트워크 경로 감지 (UNC 경로: \\server\share 또는 //server/share)
    const isNetworkPath = folderPath.startsWith('\\\\') || folderPath.startsWith('//');

    try {
      // 경로 정규화
      // - 네트워크 경로(UNC): path.resolve() 사용하지 않음 (원본 유지, forward slash만 통일)
      // - 로컬 경로: 절대 경로로 변환
      const absolutePath = isNetworkPath
        ? folderPath.replace(/\//g, '\\')  // UNC 경로는 백슬래시로 통일
        : path.resolve(folderPath);

      if (!fs.existsSync(absolutePath)) {
        const errorMsg = isNetworkPath
          ? '네트워크 경로에 접근할 수 없습니다. 경로, 권한 및 네트워크 연결을 확인해주세요.'
          : '경로가 존재하지 않습니다';
        return {
          exists: false,
          isDirectory: false,
          isNetworkPath,
          error: errorMsg
        };
      }

      const stats = fs.statSync(absolutePath);
      if (!stats.isDirectory()) {
        return {
          exists: true,
          isDirectory: false,
          isNetworkPath,
          error: '경로가 폴더가 아닙니다'
        };
      }

      return { exists: true, isDirectory: true, isNetworkPath };
    } catch (error) {
      const errorMsg = isNetworkPath
        ? `네트워크 경로 접근 오류: ${error instanceof Error ? error.message : 'Unknown error'}`
        : error instanceof Error ? error.message : 'Unknown error';

      return {
        exists: false,
        isDirectory: false,
        isNetworkPath,
        error: errorMsg
      };
    }
  }

  /**
   * 자동 스캔이 필요한 폴더 목록 조회
   */
  static async getFoldersNeedingScan(): Promise<WatchedFolder[]> {
    const now = new Date();

    const folders = db.prepare(`
      SELECT * FROM watched_folders
      WHERE is_active = 1
        AND auto_scan = 1
        AND (
          last_scan_date IS NULL
          OR datetime(last_scan_date, '+' || scan_interval || ' minutes') <= datetime(?)
        )
      ORDER BY last_scan_date ASC NULLS FIRST
    `).all(now.toISOString()) as WatchedFolder[];

    return folders;
  }
}
