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
  /**
   * 오토태그 통계 정보 조회
   */
  static async getAutoTagStats(): Promise<AutoTagStats> {
    // 1. 기본 통계
    const statsQuery = `
      SELECT
        COUNT(*) as total_images,
        SUM(CASE WHEN auto_tags IS NOT NULL THEN 1 ELSE 0 END) as tagged_images,
        SUM(CASE WHEN auto_tags IS NULL THEN 1 ELSE 0 END) as untagged_images
      FROM media_metadata
    `;
    const statsRow = db.prepare(statsQuery).get() as any;

    // 2. Rating 분포 조회 (가장 높은 rating 기준)
    const ratingQuery = `
      SELECT
        SUM(CASE
          WHEN json_extract(auto_tags, '$.rating.general') >= json_extract(auto_tags, '$.rating.sensitive')
            AND json_extract(auto_tags, '$.rating.general') >= json_extract(auto_tags, '$.rating.questionable')
            AND json_extract(auto_tags, '$.rating.general') >= json_extract(auto_tags, '$.rating.explicit')
          THEN 1 ELSE 0 END) as general,
        SUM(CASE
          WHEN json_extract(auto_tags, '$.rating.sensitive') > json_extract(auto_tags, '$.rating.general')
            AND json_extract(auto_tags, '$.rating.sensitive') >= json_extract(auto_tags, '$.rating.questionable')
            AND json_extract(auto_tags, '$.rating.sensitive') >= json_extract(auto_tags, '$.rating.explicit')
          THEN 1 ELSE 0 END) as sensitive,
        SUM(CASE
          WHEN json_extract(auto_tags, '$.rating.questionable') > json_extract(auto_tags, '$.rating.general')
            AND json_extract(auto_tags, '$.rating.questionable') > json_extract(auto_tags, '$.rating.sensitive')
            AND json_extract(auto_tags, '$.rating.questionable') >= json_extract(auto_tags, '$.rating.explicit')
          THEN 1 ELSE 0 END) as questionable,
        SUM(CASE
          WHEN json_extract(auto_tags, '$.rating.explicit') > json_extract(auto_tags, '$.rating.general')
            AND json_extract(auto_tags, '$.rating.explicit') > json_extract(auto_tags, '$.rating.sensitive')
            AND json_extract(auto_tags, '$.rating.explicit') > json_extract(auto_tags, '$.rating.questionable')
          THEN 1 ELSE 0 END) as explicit
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
    `;
    const ratingRow = db.prepare(ratingQuery).get() as any;

    // 3. Character 개수 조회
    const characterQuery = `
      SELECT COUNT(*) as character_count
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
        AND json_extract(auto_tags, '$.character') IS NOT NULL
        AND json_type(auto_tags, '$.character') = 'object'
    `;
    const characterRow = db.prepare(characterQuery).get() as any;

    // 4. Model 분포 조회
    const modelQuery = `
      SELECT
        json_extract(auto_tags, '$.model') as model,
        COUNT(*) as count
      FROM media_metadata
      WHERE auto_tags IS NOT NULL
        AND json_extract(auto_tags, '$.model') IS NOT NULL
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
      total_images: statsRow.total_images || 0,
      tagged_images: statsRow.tagged_images || 0,
      untagged_images: statsRow.untagged_images || 0,
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

    return stats;
  }
}
