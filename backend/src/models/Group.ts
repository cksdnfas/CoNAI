import { db } from '../database/init';
import { GroupRecord, ImageGroupRecord, GroupCreateData, GroupUpdateData, GroupWithStats, AutoCollectCondition } from '@conai/shared';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';
import { getGroupHierarchyService } from '../services/groupHierarchyService';
import { GroupPathService } from '../services/groupPathService';
import type { IdPage, IdPageResponse } from '../utils/idPage';
import { AggregateCache } from '../services/aggregateCache';
import {
  findImagesByGroupQuery,
  findImagesByGroupWithFilesQuery,
  findRandomImageForGroupQuery,
  findPreviewImagesQuery,
  getCompositeHashesForGroupQuery,
  getImageFileIdsForGroupQuery,
  countVisibleImagesByGroupQuery,
} from './GroupImageQueries';
import { LIBRARY_BATCH_SIZE, chunkArray, pageBoundary, placeholders, type LibraryBatchHooks } from '../services/maintenance/libraryBatch';

let autoCollectStageCounter = 0;

export interface GroupBulkAddCounts {
  addedCount: number;
  convertedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface GroupBulkRemoveCounts {
  removedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * Group lists with membership counts are read on every group tree / page load and only change when a group row or
 * a membership changes, which the `groups` aggregate version tracks through triggers (migration 043). Rows are
 * copied out so callers can decorate them freely.
 */
function resolveGroupList(key: string, compute: () => GroupWithStats[]): GroupWithStats[] {
  return AggregateCache.resolve(key, compute, { scopes: ['groups'] }).map((row) => ({ ...row }));
}

export class GroupModel {
  /**
   * 새 그룹 생성
   */
  static create(groupData: GroupCreateData): number {
    const conditionsJson = groupData.auto_collect_conditions ?
      JSON.stringify(groupData.auto_collect_conditions) : null;

    const info = db.prepare(`
      INSERT INTO groups (
        name, description, color, parent_id,
        auto_collect_enabled, auto_collect_conditions, emoticon_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupData.name.trim(),
      groupData.description || null,
      groupData.color || null,
      groupData.parent_id || null,
      groupData.auto_collect_enabled ? 1 : 0,
      conditionsJson,
      groupData.emoticon_enabled ? 1 : 0
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 그룹 조회 (ID)
   */
  static findById(id: number): GroupRecord | null {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRecord | undefined;
    return row || null;
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static findAllWithStats(): GroupWithStats[] {
    return resolveGroupList('groups:all-with-stats', () => this.queryAllWithStats());
  }

  private static queryAllWithStats(): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all() as GroupWithStats[];
    return rows || [];
  }

  /**
   * 자동수집이 활성화된 그룹들 조회
   */
  static findAutoCollectEnabled(): GroupRecord[] {
    const rows = db.prepare(
      'SELECT * FROM groups WHERE auto_collect_enabled = 1 ORDER BY id'
    ).all() as GroupRecord[];
    return rows || [];
  }

  /**
   * 그룹 업데이트
   */
  static update(id: number, groupData: GroupUpdateData): boolean {
    // undefined 값 제거 및 데이터 변환
    const updates = filterDefined({
      name: groupData.name,
      description: groupData.description,
      color: groupData.color,
      parent_id: groupData.parent_id,
      auto_collect_enabled: groupData.auto_collect_enabled !== undefined
        ? (groupData.auto_collect_enabled ? 1 : 0)
        : undefined,
      auto_collect_conditions: groupData.auto_collect_conditions !== undefined
        ? (groupData.auto_collect_conditions ? JSON.stringify(groupData.auto_collect_conditions) : null)
        : undefined,
      emoticon_enabled: groupData.emoticon_enabled !== undefined
        ? (groupData.emoticon_enabled ? 1 : 0)
        : undefined,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'), // SQL 함수 사용
    });

    if (Object.keys(updates).filter(k => k !== 'updated_date').length === 0) {
      return false; // updated_date만 있으면 업데이트 필요 없음
    }

    const { sql, values } = buildUpdateQuery('groups', updates, { id });
    const info = db.prepare(sql).run(...values);
    return info.changes > 0;
  }

  /**
   * 그룹 삭제
   * @param id 삭제할 그룹 ID
   * @param cascade true면 하위 그룹도 재귀적으로 삭제, false면 부모만 삭제 (하위 그룹은 루트로 이동)
   */
  static delete(id: number, cascade: boolean = false): boolean {
    return db.transaction(() => this.deleteInTransaction(id, cascade))();
  }

  private static deleteInTransaction(id: number, cascade: boolean): boolean {
    if (!cascade) {
      // 하위 그룹은 루트로 올라간다. 루트 이름도 고유(대소문자 무시)하므로 충돌하면 접미사로 비켜 준다.
      const children = db.prepare('SELECT id, name FROM groups WHERE parent_id = ?').all(id) as Array<{ id: number; name: string }>;
      for (const child of children) {
        const availableName = GroupPathService.findAvailableSiblingName(null, child.name, child.id);
        db.prepare('UPDATE groups SET parent_id = NULL, name = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
          .run(availableName, child.id);
      }
    }

    if (cascade) {
      // 캐스케이드 삭제: 모든 하위 그룹도 재귀적으로 삭제
      const hierarchyService = getGroupHierarchyService();
      const descendants = hierarchyService.getDescendants(id);

      // 하위 그룹을 먼저 삭제 (깊이 역순)
      const sortedDescendants = [...descendants].sort((a, b) => b.depth - a.depth);
      for (const node of sortedDescendants) {
        db.prepare('DELETE FROM image_groups WHERE group_id = ?').run(node.id);
        db.prepare('DELETE FROM groups WHERE id = ?').run(node.id);
      }
    }

    // 먼저 관련된 image_groups 레코드 삭제
    db.prepare('DELETE FROM image_groups WHERE group_id = ?').run(id);

    // 그룹 삭제 (cascade=false면 자식들은 위에서 이미 루트로 옮겼다)
    const info = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 자동수집 마지막 실행 시간 업데이트
   */
  static updateAutoCollectLastRun(id: number): boolean {
    const info = db.prepare(
      'UPDATE groups SET auto_collect_last_run = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id);
    return info.changes > 0;
  }

  // ===== 계층 구조 관련 메서드 =====

  /**
   * 루트 그룹들 조회 (parent_id가 NULL인 그룹들)
   */
  static findRoots(): GroupWithStats[] {
    return resolveGroupList('groups:roots', () => this.queryRoots());
  }

  private static queryRoots(): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      WHERE g.parent_id IS NULL
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all() as GroupWithStats[];
    return rows || [];
  }

  /**
   * 특정 부모의 자식 그룹들 조회
   */
  static findChildren(parentId: number): GroupWithStats[] {
    return resolveGroupList(`groups:children:${parentId}`, () => this.queryChildren(parentId));
  }

  private static queryChildren(parentId: number): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      WHERE g.parent_id = ?
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all(parentId) as GroupWithStats[];
    return rows || [];
  }

  /**
   * 브레드크럼 경로 조회 (현재 그룹에서 루트까지)
   */
  static getBreadcrumbPath(groupId: number): Array<{ id: number; name: string; color: string | null }> {
    const hierarchyService = getGroupHierarchyService();
    const ancestors = hierarchyService.getAncestorPath(groupId);

    // depth 역순으로 정렬 (루트부터 현재까지)
    return ancestors.map(node => ({
      id: node.id,
      name: node.name,
      color: null // 필요하면 추가 쿼리로 조회
    }));
  }

  /**
   * 모든 그룹 조회 (자식 개수 포함)
   */
  static findAllWithHierarchy(): Array<GroupWithStats & {
    child_count: number;
    has_children: boolean;
    visible_image_count: number;
    total_visible_image_count: number;
  }> {
    const groups = this.findAllWithStats();
    const hierarchyService = getGroupHierarchyService();

    const groupIds = groups.map(g => g.id);
    const childCountMap = hierarchyService.getChildCountBatch(groupIds);
    // image_count stays the raw membership count for existing consumers; the visible
    // counts use the in-group list filters so tree/card numbers match the group page.
    const visibleCountMap = countVisibleImagesByGroupQuery();

    return groups.map(group => ({
      ...group,
      child_count: childCountMap.get(group.id) || 0,
      has_children: (childCountMap.get(group.id) || 0) > 0,
      visible_image_count: visibleCountMap.get(group.id)?.own ?? 0,
      total_visible_image_count: visibleCountMap.get(group.id)?.total ?? 0,
    }));
  }

  /**
   * 특정 부모의 자식 그룹들 조회 (자식 개수 포함)
   */
  static findChildrenWithHierarchy(parentId: number | null): Array<GroupWithStats & { child_count: number; has_children: boolean }> {
    const groups = parentId === null
      ? this.findRoots()
      : this.findChildren(parentId);

    const hierarchyService = getGroupHierarchyService();
    const groupIds = groups.map(g => g.id);
    const childCountMap = hierarchyService.getChildCountBatch(groupIds);

    return groups.map(group => ({
      ...group,
      child_count: childCountMap.get(group.id) || 0,
      has_children: (childCountMap.get(group.id) || 0) > 0
    }));
  }
}

export class ImageGroupModel {
  /** Add manual memberships atomically; surface database errors instead of treating them as duplicates. */
  static addImagesToGroupManually(groupId: number, compositeHashes: string[]) {
    return db.transaction(() => {
      if (!GroupModel.findById(groupId)) {
        throw new Error(`Group ${groupId} not found`);
      }
      const imageExists = db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash = ?');
      const insert = db.prepare(`
        INSERT INTO image_groups (group_id, composite_hash, order_index, collection_type)
        VALUES (?, ?, 0, 'manual')
      `);
      let added = 0;
      let converted = 0;
      let skipped = 0;
      const missing_hashes: string[] = [];
      for (const compositeHash of new Set(compositeHashes)) {
        if (!imageExists.get(compositeHash)) {
          missing_hashes.push(compositeHash);
          skipped += 1;
          continue;
        }
        const collectionType = this.getCollectionType(groupId, compositeHash);
        if (collectionType === 'manual') {
          skipped += 1;
        } else if (collectionType === 'auto') {
          this.convertToManual(groupId, compositeHash);
          converted += 1;
        } else {
          insert.run(groupId, compositeHash);
          added += 1;
        }
      }
      return { added, converted, skipped, missing_hashes };
    }).immediate();
  }

  /**
   * Bulk add from the group routes: each hash is skipped if already manual, converted if auto, inserted otherwise.
   * One prepared statement set and one transaction per page of hashes (it used to be 2–3 autocommits per hash).
   * Duplicates in the request count as skipped, as before. A hash that is not in the library is reported in
   * `errors` instead of being counted as added.
   */
  static async addImagesManuallyInPages(groupId: number, compositeHashes: string[]): Promise<GroupBulkAddCounts> {
    const selectType = db.prepare('SELECT collection_type FROM image_groups WHERE group_id = ? AND composite_hash = ?');
    const convert = db.prepare(`
      UPDATE image_groups SET collection_type = 'manual'
      WHERE group_id = ? AND composite_hash = ? AND collection_type = 'auto'
    `);
    const insert = db.prepare(`
      INSERT INTO image_groups (group_id, composite_hash, order_index, collection_type)
      VALUES (?, ?, 0, 'manual')
    `);
    const counts: GroupBulkAddCounts = { addedCount: 0, convertedCount: 0, skippedCount: 0, errors: [] };
    const applyPage = db.transaction((hashes: string[]) => {
      for (const compositeHash of hashes) {
        try {
          const row = selectType.get(groupId, compositeHash) as { collection_type: string } | undefined;
          if (row?.collection_type === 'manual') {
            counts.skippedCount++;
          } else if (row?.collection_type === 'auto') {
            if (convert.run(groupId, compositeHash).changes > 0) {
              counts.convertedCount++;
            }
          } else {
            insert.run(groupId, compositeHash);
            counts.addedCount++;
          }
        } catch (error) {
          counts.errors.push(`Image ${compositeHash}: ${(error as Error).message}`);
        }
      }
    });

    for (const page of chunkArray(compositeHashes)) {
      // IMMEDIATE: each page reads before it writes, and a deferred read transaction cannot be upgraded once another
      // connection has written (SQLITE_BUSY at once, busy_timeout ignored).
      applyPage.immediate(page);
      await pageBoundary({});
    }
    return counts;
  }

  /** Bulk remove from the group routes, one transaction per page of hashes. */
  static async removeImagesInPages(groupId: number, compositeHashes: string[]): Promise<GroupBulkRemoveCounts> {
    const remove = db.prepare('DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?');
    const counts: GroupBulkRemoveCounts = { removedCount: 0, skippedCount: 0, errors: [] };
    const applyPage = db.transaction((hashes: string[]) => {
      for (const compositeHash of hashes) {
        try {
          if (remove.run(groupId, compositeHash).changes > 0) {
            counts.removedCount++;
          } else {
            counts.skippedCount++;
          }
        } catch (error) {
          counts.errors.push(`Image ${compositeHash}: ${(error as Error).message}`);
        }
      }
    });

    for (const page of chunkArray(compositeHashes)) {
      applyPage(page);
      await pageBoundary({});
    }
    return counts;
  }

  /**
   * 이미지를 그룹에 추가 (composite_hash 기반)
   */
  static addImageToGroup(
    groupId: number,
    compositeHash: string,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): boolean {
    try {
      db.prepare(`
        INSERT INTO image_groups (
          group_id, composite_hash, order_index, collection_type
        ) VALUES (?, ?, ?, ?)
      `).run(groupId, compositeHash, orderIndex, collectionType);
      return true;
    } catch (error) {
      // UNIQUE 제약 위반 시 (이미 추가됨)
      return false;
    }
  }


  /**
   * 그룹에서 이미지 제거 (composite_hash 기반)
   */
  static removeImageFromGroup(groupId: number, compositeHash: string): boolean {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).run(groupId, compositeHash);
    return info.changes > 0;
  }


  /**
   * 특정 그룹의 모든 자동수집 이미지 제거
   */
  static removeAutoCollectedImages(groupId: number): number {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND collection_type = ?'
    ).run(groupId, 'auto');
    return info.changes;
  }

  /**
   * Diff one group's auto-collected memberships against a desired hash set.
   *
   * `stage` fills a per-call TEMP table with the desired hashes (TEMP writes never take the images.db write lock, so
   * a slow search or a JS evaluation pass can run there freely). The diff is then applied one page at a time: stale
   * auto rows are removed, then missing ones added, each page its own short transaction. Manual memberships are
   * never touched, and every write re-checks its row, so writes from elsewhere in between are safe.
   */
  static async replaceAutoCollectedImagesStaged(
    groupId: number,
    stage: (tempTable: string) => void | Promise<void>,
    hooks: LibraryBatchHooks = {},
  ): Promise<{ removedCount: number; addedCount: number }> {
    const tempTable = `temp_auto_collect_${process.pid}_${++autoCollectStageCounter}`;
    db.exec(`CREATE TEMP TABLE ${tempTable} (composite_hash TEXT PRIMARY KEY) WITHOUT ROWID`);
    try {
      await stage(tempTable);

      const staleHashes = db.prepare(`
        SELECT ig.composite_hash
        FROM image_groups ig
        WHERE ig.group_id = ?
          AND ig.collection_type = 'auto'
          AND ig.composite_hash > ?
          AND NOT EXISTS (SELECT 1 FROM ${tempTable} t WHERE t.composite_hash = ig.composite_hash)
        ORDER BY ig.composite_hash
        LIMIT ${LIBRARY_BATCH_SIZE}
      `);
      // One statement per page (a single statement is its own transaction).
      const removePage = (hashes: string[]) => db.prepare(`
        DELETE FROM image_groups
        WHERE group_id = ? AND collection_type = 'auto' AND composite_hash IN (${placeholders(hashes.length)})
      `).run(groupId, ...hashes).changes;

      const missingHashes = db.prepare(`
        SELECT t.composite_hash
        FROM ${tempTable} t
        WHERE t.composite_hash > ?
          AND NOT EXISTS (SELECT 1 FROM image_groups ig WHERE ig.group_id = ? AND ig.composite_hash = t.composite_hash)
        ORDER BY t.composite_hash
        LIMIT ${LIBRARY_BATCH_SIZE}
      `);
      // One statement per page; the join drops hashes whose media row went away after they were staged.
      const addPage = (hashes: string[]) => db.prepare(`
        INSERT OR IGNORE INTO image_groups (group_id, composite_hash, order_index, collection_type)
        SELECT ?, m.composite_hash, 0, 'auto'
        FROM media_metadata m
        WHERE m.composite_hash IN (${placeholders(hashes.length)})
      `).run(groupId, ...hashes).changes;

      let removedCount = 0;
      let cursor = '';
      for (;;) {
        hooks.throwIfCancelled?.();
        const hashes = (staleHashes.all(groupId, cursor) as Array<{ composite_hash: string }>).map((row) => row.composite_hash);
        if (hashes.length === 0) {
          break;
        }
        cursor = hashes[hashes.length - 1];
        removedCount += removePage(hashes);
        await pageBoundary(hooks);
      }

      let addedCount = 0;
      cursor = '';
      for (;;) {
        hooks.throwIfCancelled?.();
        const hashes = (missingHashes.all(cursor, groupId) as Array<{ composite_hash: string }>).map((row) => row.composite_hash);
        if (hashes.length === 0) {
          break;
        }
        cursor = hashes[hashes.length - 1];
        addedCount += addPage(hashes);
        await pageBoundary(hooks);
      }

      return { removedCount, addedCount };
    } finally {
      db.exec(`DROP TABLE IF EXISTS ${tempTable}`);
    }
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (메타데이터만)
   */
  static findImagesByGroup(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto',
    cursor?: { orderIndex: number; addedDate: string; compositeHash: string; includeTotal?: boolean },
    includeChildren: boolean = false,
  ) {
    return findImagesByGroupQuery(groupId, page, limit, collectionType, cursor, includeChildren);
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (파일 경로 포함)
   * 다운로드 기능 등에서 사용
   */
  static findImagesByGroupWithFiles(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): { images: ImageWithFileView[], total: number } {
    return findImagesByGroupWithFilesQuery(groupId, page, limit, collectionType);
  }

  /**
   * 특정 이미지가 속한 그룹들 조회 (composite_hash 기반)
   */
  static findGroupsByImage(compositeHash: string): ImageGroupRecord[] {
    const query = `
      SELECT ig.*, g.name as group_name
      FROM image_groups ig
      INNER JOIN groups g ON ig.group_id = g.id
      WHERE ig.composite_hash = ?
      ORDER BY ig.added_date DESC
    `;

    const rows = db.prepare(query).all(compositeHash) as any[];
    return rows || [];
  }

  /**
   * 이미지가 특정 그룹에 속해있는지 확인 (composite_hash 기반)
   */
  static isImageInGroup(groupId: number, compositeHash: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash);
    return !!row;
  }

  /**
   * 이미지의 collection_type 조회 (composite_hash 기반)
   */
  static getCollectionType(groupId: number, compositeHash: string): 'manual' | 'auto' | null {
    const row = db.prepare(
      'SELECT collection_type FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash) as any;
    return row ? row.collection_type : null;
  }

  /**
   * 자동수집 이미지를 수동 수집으로 변환 (composite_hash 기반)
   */
  static convertToManual(groupId: number, compositeHash: string): boolean {
    const info = db.prepare(`
      UPDATE image_groups
      SET collection_type = 'manual'
      WHERE group_id = ? AND composite_hash = ? AND collection_type = 'auto'
    `).run(groupId, compositeHash);
    return info.changes > 0;
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static findRandomImageForGroup(groupId: number): ImageMetadataRecord | null {
    return findRandomImageForGroupQuery(groupId);
  }

  /**
   * 그룹의 미리보기 이미지들 조회 (회전 표시용, 최대 N개)
   * 현재 그룹에 이미지가 없으면 자식 그룹에서 검색 (재귀)
   */
  static findPreviewImages(
    groupId: number,
    count: number = 8,
    includeChildren: boolean = true
  ): ImageWithFileView[] {
    return findPreviewImagesQuery(groupId, count, includeChildren, childGroupId => GroupModel.findChildren(childGroupId));
  }

  /**
   * 그룹에 속한 모든 composite_hash 조회
   */
  static getCompositeHashesForGroup(groupId: number, includeChildren: boolean = false): string[] {
    return getCompositeHashesForGroupQuery(groupId, includeChildren);
  }

  /**
   * 그룹에 속한 모든 image_files.id 조회 (선택 기능용)
   * composite_hash가 같아도 서로 다른 파일로 구분됨
   */
  static getImageFileIdsForGroup(groupId: number, page?: IdPage): IdPageResponse<number> {
    return getImageFileIdsForGroupQuery(groupId, page);
  }
}
