import { db } from '../../database/init';
import { AutoTagStats } from '../../types/autoTag';

/**
 * 통계 관련 작업을 담당하는 이미지 모델 (새 구조 기반)
 *
 * ✅ 새 구조 전환 완료: media_metadata 기반
 *
 * 변경사항:
 * - images 테이블 → media_metadata 테이블
 * - 모든 기존 통계 기능 유지
 */
export class ImageStatsModel {
  private static readonly AUTO_TAG_STATS_CACHE_TTL_MS = 30_000;
  private static autoTagStatsCache: { value: AutoTagStats; expiresAt: number } | null = null;

  private static cloneAutoTagStats(stats: AutoTagStats): AutoTagStats {
    return {
      ...stats,
      rating_distribution: { ...stats.rating_distribution },
      top_general_tags: stats.top_general_tags.map((tag) => ({ ...tag })),
      model_distribution: { ...stats.model_distribution },
    };
  }

  static invalidateAutoTagStatsCache(): void {
    this.autoTagStatsCache = null;
  }

  /**
   * 자동태그 통계 정보 조회
   */
  static async getAutoTagStats(): Promise<AutoTagStats> {
    const now = Date.now();
    if (this.autoTagStatsCache && this.autoTagStatsCache.expiresAt > now) {
      return this.cloneAutoTagStats(this.autoTagStatsCache.value);
    }

    // 1. 기본 통계
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM media_metadata').get() as any;
    const taggedRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
    `).get() as any;
    const untaggedRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM media_metadata
      WHERE auto_tags IS NULL
    `).get() as any;

    // 2. Rating 분포 조회 (가장 높은 rating 기준)
    const ratingQuery = `
      SELECT
        COALESCE(SUM(CASE
          WHEN general >= sensitive
            AND general >= questionable
            AND general >= explicit
          THEN 1 ELSE 0 END), 0) as general,
        COALESCE(SUM(CASE
          WHEN sensitive > general
            AND sensitive >= questionable
            AND sensitive >= explicit
          THEN 1 ELSE 0 END), 0) as sensitive,
        COALESCE(SUM(CASE
          WHEN questionable > general
            AND questionable > sensitive
            AND questionable >= explicit
          THEN 1 ELSE 0 END), 0) as questionable,
        COALESCE(SUM(CASE
          WHEN explicit > general
            AND explicit > sensitive
            AND explicit > questionable
          THEN 1 ELSE 0 END), 0) as explicit
      FROM (
        SELECT
          json_extract(auto_tags, '$.rating.general') as general,
          json_extract(auto_tags, '$.rating.sensitive') as sensitive,
          json_extract(auto_tags, '$.rating.questionable') as questionable,
          json_extract(auto_tags, '$.rating.explicit') as explicit
        FROM media_metadata
        WHERE json_type(auto_tags, '$.rating') = 'object'
      )
    `;
    const ratingRow = db.prepare(ratingQuery).get() as any;

    // 3. Character 개수 조회
    const characterQuery = `
      SELECT COUNT(*) as character_count
      FROM media_metadata
      WHERE json_type(auto_tags, '$.character') = 'object'
    `;
    const characterRow = db.prepare(characterQuery).get() as any;

    // 4. Model 분포 조회
    const modelQuery = `
      SELECT
        json_extract(auto_tags, '$.model') as model,
        COUNT(*) as count
      FROM media_metadata
      WHERE json_extract(auto_tags, '$.model') IS NOT NULL
      GROUP BY model
      ORDER BY count DESC
    `;
    const modelRows = db.prepare(modelQuery).all() as any[];

    // Model 분포를 객체로 변환
    const modelDistribution: { [key: string]: number } = {};
    modelRows.forEach(row => {
      if (row.model) {
        modelDistribution[row.model] = row.count;
      }
    });

    // 최종 결과 반환
    const stats: AutoTagStats = {
      total_images: totalRow.count || 0,
      tagged_images: taggedRow.count || 0,
      untagged_images: untaggedRow.count || 0,
      rating_distribution: {
        general: ratingRow?.general || 0,
        sensitive: ratingRow?.sensitive || 0,
        questionable: ratingRow?.questionable || 0,
        explicit: ratingRow?.explicit || 0
      },
      top_general_tags: [],
      character_count: characterRow?.character_count || 0,
      model_distribution: modelDistribution
    };

    this.autoTagStatsCache = {
      value: this.cloneAutoTagStats(stats),
      expiresAt: now + this.AUTO_TAG_STATS_CACHE_TTL_MS,
    };

    return stats;
  }
}
