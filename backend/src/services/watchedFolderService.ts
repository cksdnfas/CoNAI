import { db } from '../database/init';
import path from 'path';
import fs from 'fs';

export interface WatchedFolder {
  id: number;
  folder_path: string;
  folder_name: string | null;
  folder_type: 'upload' | 'scan' | 'archive';
  auto_scan: number;
  scan_interval: number;
  recursive: number;
  file_extensions: string | null;
  exclude_patterns: string | null;
  is_active: number;
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
  folder_type?: 'upload' | 'scan' | 'archive';
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  file_extensions?: string[];
  exclude_patterns?: string[];
  watcher_enabled?: boolean;
}

export interface WatchedFolderUpdate {
  folder_name?: string;
  auto_scan?: boolean;
  scan_interval?: number;
  recursive?: boolean;
  file_extensions?: string[];
  exclude_patterns?: string[];
  is_active?: boolean;
  watcher_enabled?: number;  // 0 or 1
}

export class WatchedFolderService {
  /**
   * 폴더 등록
   */
  static async addFolder(folderData: WatchedFolderCreate): Promise<number> {
    // 경로 정규화 (절대 경로로 변환)
    const absolutePath = path.resolve(folderData.folder_path);

    // 폴더 존재 확인
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`폴더가 존재하지 않습니다: ${absolutePath}`);
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
        folder_path, folder_name, folder_type, auto_scan, scan_interval,
        recursive, file_extensions, exclude_patterns, watcher_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      absolutePath,
      folderData.folder_name || path.basename(absolutePath),
      folderData.folder_type || 'scan',
      folderData.auto_scan ? 1 : 0,
      folderData.scan_interval || 60,
      folderData.recursive !== false ? 1 : 0,
      folderData.file_extensions ? JSON.stringify(folderData.file_extensions) : null,
      folderData.exclude_patterns ? JSON.stringify(folderData.exclude_patterns) : null,
      folderData.watcher_enabled ? 1 : 0
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 폴더 목록 조회
   */
  static async listFolders(options?: {
    type?: 'upload' | 'scan' | 'archive';
    active_only?: boolean;
  }): Promise<WatchedFolder[]> {
    let query = 'SELECT * FROM watched_folders WHERE 1=1';
    const params: any[] = [];

    if (options?.type) {
      query += ' AND folder_type = ?';
      params.push(options.type);
    }

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

    if (updates.file_extensions !== undefined) {
      fields.push('file_extensions = ?');
      values.push(JSON.stringify(updates.file_extensions));
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
    if (deleteFiles) {
      // image_files에서도 삭제 (CASCADE로 자동 처리됨)
      // 하지만 image_metadata는 유지 (다른 폴더에서 참조 가능)
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
    error?: string;
  }> {
    try {
      const absolutePath = path.resolve(folderPath);

      if (!fs.existsSync(absolutePath)) {
        return { exists: false, isDirectory: false, error: '경로가 존재하지 않습니다' };
      }

      const stats = fs.statSync(absolutePath);
      if (!stats.isDirectory()) {
        return { exists: true, isDirectory: false, error: '경로가 폴더가 아닙니다' };
      }

      return { exists: true, isDirectory: true };
    } catch (error) {
      return {
        exists: false,
        isDirectory: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
