import {
  AutoTagSearchParams,
  RatingFilter,
  TagFilter,
  CharacterFilter,
  QueryBuilderResult
} from '../types/autoTag';
import { RatingScoreService } from './ratingScoreService';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
  AUTO_TAG_MODEL_JSON_PATHS,
  buildAutoTagExistsForPaths,
  buildAutoTagModelExpr,
  buildAutoTagRatingExpr,
  pushAutoTagPathMatchParams,
} from './autoTagSqlShared';
import { normalizeAutoTagSearchTerm } from './autoTagSearch/autoTagSearchTerms';
import { AutoTagSearchMatcher } from './autoTagSearch/AutoTagSearchMatcher';

/**
 * 자동태그 검색 서비스
 * SQLite JSON 함수를 활용한 동적 쿼리 빌더
 */
export class AutoTagSearchService {

  /**
   * 자동태그 검색 파라미터를 SQL WHERE 조건으로 변환
   * @param searchParams 자동태그 검색 파라미터
   * @param basicSearchParams 기본 검색 파라미터 (선택)
   */
  static async buildAutoTagSearchQuery(
    searchParams: AutoTagSearchParams,
    basicSearchParams?: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<QueryBuilderResult> {
    const conditions: string[] = [];
    const params: any[] = [];

    // 기본 검색 조건 추가
    if (basicSearchParams) {
      if (basicSearchParams.search_text) {
        conditions.push('i.prompt LIKE ?');
        params.push(`%${basicSearchParams.search_text}%`);
      }
      if (basicSearchParams.negative_text) {
        conditions.push('i.negative_prompt LIKE ?');
        params.push(`%${basicSearchParams.negative_text}%`);
      }
      if (basicSearchParams.ai_tool) {
        conditions.push('i.ai_tool = ?');
        params.push(basicSearchParams.ai_tool);
      }
      if (basicSearchParams.model_name) {
        conditions.push('i.model_name LIKE ?');
        params.push(`%${basicSearchParams.model_name}%`);
      }
      if (basicSearchParams.start_date) {
        conditions.push('DATE(i.upload_date) >= DATE(?)');
        params.push(basicSearchParams.start_date);
      }
      if (basicSearchParams.end_date) {
        conditions.push('DATE(i.upload_date) <= DATE(?)');
        params.push(basicSearchParams.end_date);
      }
    }

    // 1. 자동태그 존재 여부 필터
    if (searchParams.has_auto_tags !== undefined) {
      if (searchParams.has_auto_tags === true) {
        conditions.push('i.auto_tags IS NOT NULL');
      } else {
        conditions.push('i.auto_tags IS NULL');
      }
    }

    // 자동태그가 없어야 하는 경우, 다른 조건은 무의미하므로 early return
    if (searchParams.has_auto_tags === false) {
      return { conditions, params };
    }

    // 2. Rating 필터
    if (searchParams.rating) {
      const ratingConditions = this.buildRatingConditions(searchParams.rating);
      conditions.push(...ratingConditions.conditions);
      params.push(...ratingConditions.params);
    }

    // 2-1. Rating Score 필터 (가중치 기반)
    if (searchParams.rating_score) {
      const scoreConditions = await this.buildRatingScoreConditions(searchParams.rating_score);
      conditions.push(...scoreConditions.conditions);
      params.push(...scoreConditions.params);
    }

    // 3. General 태그 필터
    if (searchParams.general_tags && searchParams.general_tags.length > 0) {
      const generalConditions = this.buildGeneralTagConditions(searchParams.general_tags);
      conditions.push(...generalConditions.conditions);
      params.push(...generalConditions.params);
    }

    // 4. Character 필터
    if (searchParams.character) {
      const characterConditions = this.buildCharacterConditions(searchParams.character);
      conditions.push(...characterConditions.conditions);
      params.push(...characterConditions.params);
    }

    // 4.5 Any Tag 필터 (General + Character 통합 검색)
    if (searchParams.any_tags && searchParams.any_tags.length > 0) {
      const anyConditions = this.buildAnyTagConditions(searchParams.any_tags);
      conditions.push(...anyConditions.conditions);
      params.push(...anyConditions.params);
    }

    // 5. Model 필터
    if (searchParams.model) {
      conditions.push(`${buildAutoTagModelExpr('i')} = ?`);
      params.push(searchParams.model);
    }

    return { conditions, params };
  }

  /**
   * Rating Score 조건 생성 (stored media_metadata.rating_score 기반)
   */
  private static async buildRatingScoreConditions(scoreFilter: { min_score?: number; max_score?: number }): Promise<QueryBuilderResult> {
    const conditions: string[] = [];
    const params: any[] = [];

    const result = RatingScoreService.buildScoreFilterSQL(scoreFilter);

    if (result.condition) {
      conditions.push(result.condition);
      params.push(...result.params);
    }

    return { conditions, params };
  }

  /**
   * Rating 조건 생성
   */
  private static buildRatingConditions(rating: RatingFilter): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    const ratingTypes = ['general', 'sensitive', 'questionable', 'explicit'] as const;

    for (const type of ratingTypes) {
      const filter = rating[type];
      if (!filter) continue;

      if (filter.min !== undefined) {
        conditions.push(`${buildAutoTagRatingExpr('i', type)} >= ?`);
        params.push(filter.min);
      }

      if (filter.max !== undefined) {
        conditions.push(`${buildAutoTagRatingExpr('i', type)} <= ?`);
        params.push(filter.max);
      }
    }

    return { conditions, params };
  }

  /**
   * General 태그 조건 생성 (부분 매칭 및 띄어쓰기 정규화 지원)
   */
  private static buildGeneralTagConditions(tags: TagFilter[]): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    for (const tagFilter of tags) {
      // Score 조건이 있으면 더 정확한 매칭 필요 (개별 토큰 제외)
      const hasScoreFilter = tagFilter.min_score !== undefined || tagFilter.max_score !== undefined;

      // 검색어 정규화 및 변형 생성
      const searchVariants = normalizeAutoTagSearchTerm(tagFilter.tag, hasScoreFilter);

      // 각 변형에 대한 OR 조건 생성
      const tagOrConditions: string[] = [];

      for (const variant of searchVariants) {
        // SQLite JSON 키 검색: json_each로 키를 순회하며 LIKE 패턴 매칭
        const keyMatchCondition = buildAutoTagExistsForPaths(
          'i',
          AUTO_TAG_GENERAL_JSON_PATHS,
          'LOWER(key) LIKE ?'
        );

        tagOrConditions.push(keyMatchCondition);
        pushAutoTagPathMatchParams(params, AUTO_TAG_GENERAL_JSON_PATHS.length, variant);
      }

      // 매칭되는 키가 하나라도 있으면 통과 (OR 조건)
      const existsCondition = `(${tagOrConditions.join(' OR ')})`;

      // Score 범위 조건이 실질적으로 필터링을 하는 경우만 적용
      // 0~1 범위는 모든 값을 포함하므로 조건이 없는 것과 동일
      const hasMinFilter = tagFilter.min_score !== undefined && tagFilter.min_score > 0;
      const hasMaxFilter = tagFilter.max_score !== undefined && tagFilter.max_score < 1;

      if (hasMinFilter || hasMaxFilter) {
        // Score 조건을 위한 서브쿼리
        const scoreConditions: string[] = [];

        for (const variant of searchVariants) {
          const scoreCheck: string[] = [];
          if (hasMinFilter) {
            scoreCheck.push(`value >= ?`);
          }
          if (hasMaxFilter) {
            scoreCheck.push(`value <= ?`);
          }

          const scoreCheckStr = scoreCheck.length > 0
            ? ` AND ${scoreCheck.join(' AND ')}`
            : '';

          const scoreCondition = buildAutoTagExistsForPaths(
            'i',
            AUTO_TAG_GENERAL_JSON_PATHS,
            `LOWER(key) LIKE ?${scoreCheckStr}`
          );

          scoreConditions.push(scoreCondition);

          // 파라미터 순서: 문자열(key LIKE), 숫자(min), 숫자(max)
          pushAutoTagPathMatchParams(
            params,
            AUTO_TAG_GENERAL_JSON_PATHS.length,
            variant,
            hasMinFilter ? tagFilter.min_score : undefined,
            hasMaxFilter ? tagFilter.max_score : undefined
          );
        }

        // 존재 여부와 Score 조건을 AND로 결합
        const finalCondition = `(${existsCondition} AND (${scoreConditions.join(' OR ')}))`;
        console.log('[AutoTagSearch] Final condition:', finalCondition);
        conditions.push(finalCondition);
      } else {
        // Score 조건이 없으면 존재 여부만 체크
        conditions.push(existsCondition);
      }
    }

    return { conditions, params };
  }

  /**
   * Any 태그 조건 생성 (General + Character 통합 검색)
   */
  private static buildAnyTagConditions(tags: TagFilter[]): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    for (const tagFilter of tags) {
      const hasScoreFilter = tagFilter.min_score !== undefined || tagFilter.max_score !== undefined;
      const searchVariants = normalizeAutoTagSearchTerm(tagFilter.tag, hasScoreFilter);

      // 검색 변형에 대한 통합 OR 조건 생성
      const variantConditions: string[] = [];

      for (const variant of searchVariants) {
        // 1. General 태그 검색 조건
        const generalCondition = buildAutoTagExistsForPaths(
          'i',
          AUTO_TAG_GENERAL_JSON_PATHS,
          'LOWER(key) LIKE ?'
        );

        // 2. Character 태그 검색 조건
        const characterCondition = buildAutoTagExistsForPaths(
          'i',
          AUTO_TAG_CHARACTER_JSON_PATHS,
          'LOWER(key) LIKE ?'
        );

        variantConditions.push(`(${generalCondition} OR ${characterCondition})`);

        // 파라미터 추가 (json path 개수에 맞춰 반복)
        for (let i = 0; i < AUTO_TAG_GENERAL_JSON_PATHS.length; i++) {
          params.push(`%${variant}%`);
        }
        for (let i = 0; i < AUTO_TAG_CHARACTER_JSON_PATHS.length; i++) {
          params.push(`%${variant}%`);
        }
      }

      const existsCondition = `(${variantConditions.join(' OR ')})`;
      conditions.push(existsCondition);
    }

    return { conditions, params };
  }

  /**
   * Character 조건 생성 (부분 매칭 및 띄어쓰기 정규화 지원)
   */
  private static buildCharacterConditions(character: CharacterFilter): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    // has_character 플래그가 있는 경우
    if (character.has_character !== undefined) {
      if (character.has_character === true) {
        // 캐릭터가 있음: 필드 존재 + object 타입 + 비어있지 않음
        conditions.push(`json_extract(i.auto_tags, '$.character') IS NOT NULL`);
        conditions.push(`json_type(i.auto_tags, '$.character') = 'object'`);
        conditions.push(`json_extract(i.auto_tags, '$.character') != '{}'`);
      } else {
        // 캐릭터가 없음: 필드 없음 OR object 아님 OR 빈 객체
        const noCharConditions = [
          `json_extract(i.auto_tags, '$.character') IS NULL`,
          `json_type(i.auto_tags, '$.character') != 'object'`,
          `json_extract(i.auto_tags, '$.character') = '{}'`
        ];
        conditions.push(`(${noCharConditions.join(' OR ')})`);
      }
    }

    // 특정 캐릭터명 검색 (부분 매칭 지원)
    if (character.name) {
      // Score 조건이 있으면 더 정확한 매칭 필요 (개별 토큰 제외)
      const hasScoreFilter = character.min_score !== undefined || character.max_score !== undefined;

      // 검색어 정규화 및 변형 생성
      const searchVariants = normalizeAutoTagSearchTerm(character.name, hasScoreFilter);

      // 각 변형에 대한 OR 조건 생성
      const charOrConditions: string[] = [];

      for (const variant of searchVariants) {
        // SQLite JSON 키 검색: json_each로 키를 순회하며 LIKE 패턴 매칭
        const keyMatchCondition = buildAutoTagExistsForPaths(
          'i',
          AUTO_TAG_CHARACTER_JSON_PATHS,
          'LOWER(key) LIKE ?'
        );

        charOrConditions.push(keyMatchCondition);
        pushAutoTagPathMatchParams(params, AUTO_TAG_CHARACTER_JSON_PATHS.length, variant);
      }

      // 매칭되는 키가 하나라도 있으면 통과 (OR 조건)
      const existsCondition = `(${charOrConditions.join(' OR ')})`;

      // Score 범위 조건이 실질적으로 필터링을 하는 경우만 적용
      // 0~1 범위는 모든 값을 포함하므로 조건이 없는 것과 동일
      const hasMinFilter = character.min_score !== undefined && character.min_score > 0;
      const hasMaxFilter = character.max_score !== undefined && character.max_score < 1;

      if (hasMinFilter || hasMaxFilter) {
        // Score 조건을 위한 서브쿼리
        const scoreConditions: string[] = [];

        console.log('[AutoTagSearch] Building character score condition for:', character.name);
        console.log('[AutoTagSearch] Character score range:', character.min_score, '~', character.max_score);
        console.log('[AutoTagSearch] Character search variants:', searchVariants);

        for (const variant of searchVariants) {
          const scoreCheck: string[] = [];
          if (hasMinFilter) {
            scoreCheck.push(`value >= ?`);
          }
          if (hasMaxFilter) {
            scoreCheck.push(`value <= ?`);
          }

          const scoreCheckStr = scoreCheck.length > 0
            ? ` AND ${scoreCheck.join(' AND ')}`
            : '';

          const scoreCondition = buildAutoTagExistsForPaths(
            'i',
            AUTO_TAG_CHARACTER_JSON_PATHS,
            `LOWER(key) LIKE ?${scoreCheckStr}`
          );

          console.log('[AutoTagSearch] Character score condition SQL:', scoreCondition);

          scoreConditions.push(scoreCondition);

          // 파라미터 순서: 문자열(key LIKE), 숫자(min), 숫자(max)
          pushAutoTagPathMatchParams(
            params,
            AUTO_TAG_CHARACTER_JSON_PATHS.length,
            variant,
            hasMinFilter ? character.min_score : undefined,
            hasMaxFilter ? character.max_score : undefined
          );
        }

        // 존재 여부와 Score 조건을 AND로 결합
        const finalCondition = `(${existsCondition} AND (${scoreConditions.join(' OR ')}))`;
        console.log('[AutoTagSearch] Character final condition:', finalCondition);
        conditions.push(finalCondition);
      } else {
        // Score 조건이 없으면 존재 여부만 체크
        conditions.push(existsCondition);
      }
    }

    return { conditions, params };
  }

  /**
   * JSON path에서 특수문자 처리
   * SQLite json_extract에서는 특수문자가 포함된 키를 큰따옴표로 감싸야 함
   */
  private static escapeJsonPath(key: string): string {
    // 이미 큰따옴표로 감싸져 있으면 그대로 반환
    if (key.startsWith('"') && key.endsWith('"')) {
      return key;
    }

    // 특수문자가 있거나 공백이 있으면 큰따옴표로 감싸기
    if (/[^a-zA-Z0-9_]/.test(key)) {
      // 내부의 큰따옴표는 이스케이프
      const escaped = key.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }

    return key;
  }


  /**
   * 검색 파라미터 유효성 검증
   */
  static validateSearchParams(params: AutoTagSearchParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Rating 검증
    if (params.rating) {
      const ratingTypes = ['general', 'sensitive', 'questionable', 'explicit'] as const;
      for (const type of ratingTypes) {
        const filter = params.rating[type];
        if (filter) {
          if (filter.min !== undefined && (filter.min < 0 || filter.min > 1)) {
            errors.push(`Rating ${type} min must be between 0 and 1`);
          }
          if (filter.max !== undefined && (filter.max < 0 || filter.max > 1)) {
            errors.push(`Rating ${type} max must be between 0 and 1`);
          }
          if (filter.min !== undefined && filter.max !== undefined && filter.min > filter.max) {
            errors.push(`Rating ${type} min cannot be greater than max`);
          }
        }
      }
    }

    // General 태그 검증
    if (params.general_tags) {
      if (!Array.isArray(params.general_tags)) {
        errors.push('general_tags must be an array');
      } else {
        params.general_tags.forEach((tag, index) => {
          if (!tag.tag || typeof tag.tag !== 'string') {
            errors.push(`general_tags[${index}]: tag name is required and must be a string`);
          }
          if (tag.min_score !== undefined && (tag.min_score < 0 || tag.min_score > 1)) {
            errors.push(`general_tags[${index}]: min_score must be between 0 and 1`);
          }
          if (tag.max_score !== undefined && (tag.max_score < 0 || tag.max_score > 1)) {
            errors.push(`general_tags[${index}]: max_score must be between 0 and 1`);
          }
          if (tag.min_score !== undefined && tag.max_score !== undefined && tag.min_score > tag.max_score) {
            errors.push(`general_tags[${index}]: min_score cannot be greater than max_score`);
          }
        });
      }
    }

    // Character 검증
    if (params.character) {
      if (params.character.min_score !== undefined && (params.character.min_score < 0 || params.character.min_score > 1)) {
        errors.push('character min_score must be between 0 and 1');
      }
      if (params.character.max_score !== undefined && (params.character.max_score < 0 || params.character.max_score > 1)) {
        errors.push('character max_score must be between 0 and 1');
      }
      if (params.character.min_score !== undefined && params.character.max_score !== undefined &&
        params.character.min_score > params.character.max_score) {
        errors.push('character min_score cannot be greater than max_score');
      }
    }

    // Pagination 검증
    if (params.page !== undefined && params.page < 1) {
      errors.push('page must be greater than 0');
    }
    if (params.limit !== undefined && (params.limit < 1 || params.limit > 1000)) {
      errors.push('limit must be between 1 and 1000');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 자동태그가 검색 조건과 일치하는지 확인 (메모리 내 필터링)
   * 주로 자동수집 서비스에서 사용
   */
  static async matchesAutoTagConditions(
    autoTagsJson: string | null,
    searchParams: AutoTagSearchParams
  ): Promise<boolean> {
    return AutoTagSearchMatcher.matchesAutoTagConditions(autoTagsJson, searchParams);
  }
}

