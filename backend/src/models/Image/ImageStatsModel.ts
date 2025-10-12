import { db } from '../../database/init';
import { AutoTagStats } from '../../types/autoTag';

/**
 * 통계 관련 작업을 담당하는 이미지 모델
 */
export class ImageStatsModel {
  /**
   * 오토태그 통계 정보 조회
   */
  static getAutoTagStats(): Promise<AutoTagStats> {
    return new Promise((resolve, reject) => {
      // 1. 기본 통계
      const statsQuery = `
        SELECT
          COUNT(*) as total_images,
          SUM(CASE WHEN auto_tags IS NOT NULL THEN 1 ELSE 0 END) as tagged_images,
          SUM(CASE WHEN auto_tags IS NULL THEN 1 ELSE 0 END) as untagged_images
        FROM images
      `;

      db.get(statsQuery, [], (err, statsRow: any) => {
        if (err) {
          reject(err);
          return;
        }

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
          FROM images
          WHERE auto_tags IS NOT NULL
        `;

        db.get(ratingQuery, [], (err, ratingRow: any) => {
          if (err) {
            reject(err);
            return;
          }

          // 3. Character 개수 조회
          const characterQuery = `
            SELECT COUNT(*) as character_count
            FROM images
            WHERE auto_tags IS NOT NULL
              AND json_extract(auto_tags, '$.character') IS NOT NULL
              AND json_type(auto_tags, '$.character') = 'object'
          `;

          db.get(characterQuery, [], (err, characterRow: any) => {
            if (err) {
              reject(err);
              return;
            }

            // 4. Model 분포 조회
            const modelQuery = `
              SELECT
                json_extract(auto_tags, '$.model') as model,
                COUNT(*) as count
              FROM images
              WHERE auto_tags IS NOT NULL
                AND json_extract(auto_tags, '$.model') IS NOT NULL
              GROUP BY model
              ORDER BY count DESC
            `;

            db.all(modelQuery, [], (err, modelRows: any[]) => {
              if (err) {
                reject(err);
                return;
              }

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
                top_general_tags: [], // 복잡한 쿼리이므로 추후 구현 가능
                character_count: characterRow?.character_count || 0,
                model_distribution: modelDistribution
              };

              resolve(stats);
            });
          });
        });
      });
    });
  }
}
