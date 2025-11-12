import { db } from '../database/init';
import {
  AutoFolderGroup,
  CreateAutoFolderGroupData,
  AutoFolderGroupWithStats
} from '@comfyui-image-manager/shared';
import { ImageMetadataRecord } from '../types/image';

/**
 * 자동 폴더 그룹 모델
 * 파일 시스템 폴더 구조를 반영한 읽기 전용 그룹 관리
 */
export class AutoFolderGroupModel {
  /**
   * 새 자동 폴더 그룹 생성
   */
  static async create(data: CreateAutoFolderGroupData): Promise<AutoFolderGroup> {
    const info = db.prepare(`
      INSERT INTO auto_folder_groups (
        folder_path, absolute_path, display_name, parent_id,
        depth, has_images, image_count, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.folder_path,
      data.absolute_path,
      data.display_name,
      data.parent_id ?? null,
      data.depth,
      data.has_images ? 1 : 0,
      data.image_count ?? 0,
      data.color ?? null
    );

    const id = info.lastInsertRowid as number;
    const group = await this.findById(id);
    if (!group) {
      throw new Error('Failed to create auto folder group');
    }
    return group;
  }

  /**
   * 그룹 조회 (ID)
   */
  static async findById(id: number): Promise<AutoFolderGroup | null> {
    const row = db.prepare('SELECT * FROM auto_folder_groups WHERE id = ?')
      .get(id) as AutoFolderGroup | undefined;
    return row || null;
  }

  /**
   * 그룹 조회 (folder_path)
   */
  static async findByFolderPath(folderPath: string): Promise<AutoFolderGroup | null> {
    const row = db.prepare('SELECT * FROM auto_folder_groups WHERE folder_path = ?')
      .get(folderPath) as AutoFolderGroup | undefined;
    return row || null;
  }

  /**
   * 루트 그룹들 조회 (parent_id가 NULL)
   */
  static async findRoots(): Promise<AutoFolderGroupWithStats[]> {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      WHERE afg.parent_id IS NULL
      ORDER BY afg.display_name ASC
    `;

    const rows = db.prepare(query).all() as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 특정 부모의 자식 그룹들 조회
   */
  static async findChildren(parentId: number): Promise<AutoFolderGroupWithStats[]> {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      WHERE afg.parent_id = ?
      ORDER BY afg.display_name ASC
    `;

    const rows = db.prepare(query).all(parentId) as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static async findAllWithStats(): Promise<AutoFolderGroupWithStats[]> {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      ORDER BY afg.depth ASC, afg.display_name ASC
    `;

    const rows = db.prepare(query).all() as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 모든 그룹 삭제 (rebuild 전용)
   */
  static async deleteAll(): Promise<void> {
    // CASCADE로 인해 auto_folder_group_images도 자동 삭제됨
    db.prepare('DELETE FROM auto_folder_groups').run();
  }

  /**
   * 그룹 삭제
   */
  static async delete(id: number): Promise<boolean> {
    const info = db.prepare('DELETE FROM auto_folder_groups WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 그룹의 이미지 개수 업데이트
   */
  static async updateImageCount(id: number, count: number): Promise<boolean> {
    const info = db.prepare(`
      UPDATE auto_folder_groups
      SET image_count = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(count, id);
    return info.changes > 0;
  }

  /**
   * 브레드크럼 경로 조회 (현재 그룹에서 루트까지)
   */
  static async getBreadcrumbPath(groupId: number): Promise<Array<{ id: number; name: string; folder_path: string }>> {
    const path: Array<{ id: number; name: string; folder_path: string }> = [];
    let currentId: number | null = groupId;

    while (currentId !== null) {
      const group = await this.findById(currentId);
      if (!group) break;

      path.unshift({
        id: group.id,
        name: group.display_name,
        folder_path: group.folder_path
      });

      currentId = group.parent_id;
    }

    return path;
  }
}

/**
 * 자동 폴더 그룹 이미지 연결 모델
 */
export class AutoFolderGroupImageModel {
  /**
   * 이미지를 폴더 그룹에 추가 (composite_hash 기반)
   */
  static async addImageToGroup(groupId: number, compositeHash: string): Promise<boolean> {
    try {
      db.prepare(`
        INSERT INTO auto_folder_group_images (group_id, composite_hash)
        VALUES (?, ?)
      `).run(groupId, compositeHash);
      return true;
    } catch (error) {
      // UNIQUE 제약 위반 시 (이미 추가됨)
      return false;
    }
  }

  /**
   * 그룹의 모든 이미지 제거
   */
  static async removeAllImagesFromGroup(groupId: number): Promise<void> {
    db.prepare('DELETE FROM auto_folder_group_images WHERE group_id = ?').run(groupId);
  }

  /**
   * 그룹의 이미지 조회 (페이징 지원, 메타데이터 포함)
   */
  static async findImagesByGroup(
    groupId: number,
    page: number = 1,
    pageSize: number = 50
  ): Promise<ImageMetadataRecord[]> {
    const offset = (page - 1) * pageSize;

    const query = `
      SELECT m.*
      FROM auto_folder_group_images afgi
      INNER JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
      WHERE afgi.group_id = ?
      ORDER BY m.first_seen_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(groupId, pageSize, offset) as ImageMetadataRecord[];
    return rows || [];
  }

  /**
   * 그룹의 총 이미지 개수
   */
  static async getImageCount(groupId: number): Promise<number> {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM auto_folder_group_images
      WHERE group_id = ?
    `).get(groupId) as { count: number };

    return result?.count || 0;
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static async findRandomImageForGroup(groupId: number): Promise<ImageMetadataRecord | null> {
    const query = `
      SELECT m.*
      FROM auto_folder_group_images afgi
      INNER JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
      WHERE afgi.group_id = ?
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = db.prepare(query).get(groupId) as ImageMetadataRecord | undefined;
    return row || null;
  }

  /**
   * 그룹의 모든 composite_hash 조회
   */
  static async getCompositeHashesForGroup(groupId: number): Promise<string[]> {
    const rows = db.prepare(`
      SELECT composite_hash
      FROM auto_folder_group_images
      WHERE group_id = ?
    `).all(groupId) as Array<{ composite_hash: string }>;

    return rows.map(r => r.composite_hash);
  }

  /**
   * 특정 이미지가 속한 모든 폴더 그룹 조회
   */
  static async findGroupsByImage(compositeHash: string): Promise<AutoFolderGroup[]> {
    const query = `
      SELECT afg.*
      FROM auto_folder_groups afg
      INNER JOIN auto_folder_group_images afgi ON afg.id = afgi.group_id
      WHERE afgi.composite_hash = ?
      ORDER BY afg.folder_path ASC
    `;

    const rows = db.prepare(query).all(compositeHash) as AutoFolderGroup[];
    return rows || [];
  }
}
