import {
  AutoTagSearchParams,
  RatingFilter,
  TagFilter,
  CharacterFilter,
  QueryBuilderResult
} from '../types/autoTag';
import { RatingScoreService } from './ratingScoreService';

/**
 * 오토태그 검색 서비스
 * SQLite JSON 함수를 활용한 동적 쿼리 빌더
 */
export class AutoTagSearchService {
  /**
   * 오토태그 검색 파라미터를 SQL WHERE 조건으로 변환
   * @param searchParams 오토태그 검색 파라미터
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

    // 1. 오토태그 존재 여부 필터
    if (searchParams.has_auto_tags !== undefined) {
      if (searchParams.has_auto_tags === true) {
        conditions.push('i.auto_tags IS NOT NULL');
      } else {
        conditions.push('i.auto_tags IS NULL');
      }
    }

    // 오토태그가 없어야 하는 경우, 다른 조건은 무의미하므로 early return
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

    // 5. Model 필터
    if (searchParams.model) {
      conditions.push(`json_extract(i.auto_tags, '$.model') = ?`);
      params.push(searchParams.model);
    }

    return { conditions, params };
  }

  /**
   * Rating Score 조건 생성 (가중치 기반)
   */
  private static async buildRatingScoreConditions(scoreFilter: { min_score?: number; max_score?: number }): Promise<QueryBuilderResult> {
    const conditions: string[] = [];
    const params: any[] = [];

    // 가중치 설정 조회
    const weights = await RatingScoreService.getWeights();

    // RatingScoreService의 SQL 생성 함수 사용
    const result = RatingScoreService.buildScoreFilterSQL(scoreFilter, weights);

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

      const jsonPath = `$.rating.${type}`;

      if (filter.min !== undefined) {
        conditions.push(`json_extract(i.auto_tags, '${jsonPath}') >= ?`);
        params.push(filter.min);
      }

      if (filter.max !== undefined) {
        conditions.push(`json_extract(i.auto_tags, '${jsonPath}') <= ?`);
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
      const searchVariants = this.normalizeSearchTerm(tagFilter.tag, hasScoreFilter);

      // 각 변형에 대한 OR 조건 생성
      const tagOrConditions: string[] = [];

      for (const variant of searchVariants) {
        // SQLite JSON 키 검색: json_each로 키를 순회하며 LIKE 패턴 매칭
        const keyMatchCondition = `
          EXISTS (
            SELECT 1 FROM json_each(i.auto_tags, '$.general')
            WHERE LOWER(key) LIKE ?
          )
        `.trim();

        tagOrConditions.push(keyMatchCondition);
        params.push(`%${variant}%`);
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

        console.log('[AutoTagSearch] Building score condition for tag:', tagFilter.tag);
        console.log('[AutoTagSearch] Score range:', tagFilter.min_score, '~', tagFilter.max_score);
        console.log('[AutoTagSearch] Search variants:', searchVariants);

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

          const scoreCondition = `
            EXISTS (
              SELECT 1 FROM json_each(i.auto_tags, '$.general')
              WHERE LOWER(key) LIKE ?${scoreCheckStr}
            )
          `.trim();

          console.log('[AutoTagSearch] Score condition SQL:', scoreCondition);
          console.log('[AutoTagSearch] Params for variant:', variant, '- min:', tagFilter.min_score, 'max:', tagFilter.max_score);

          scoreConditions.push(scoreCondition);

          // 파라미터 순서: 문자열(key LIKE), 숫자(min), 숫자(max)
          params.push(`%${variant}%`);
          if (hasMinFilter) {
            params.push(tagFilter.min_score);
          }
          if (hasMaxFilter) {
            params.push(tagFilter.max_score);
          }
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
      const searchVariants = this.normalizeSearchTerm(character.name, hasScoreFilter);

      // 각 변형에 대한 OR 조건 생성
      const charOrConditions: string[] = [];

      for (const variant of searchVariants) {
        // SQLite JSON 키 검색: json_each로 키를 순회하며 LIKE 패턴 매칭
        const keyMatchCondition = `
          EXISTS (
            SELECT 1 FROM json_each(i.auto_tags, '$.character')
            WHERE LOWER(key) LIKE ?
          )
        `.trim();

        charOrConditions.push(keyMatchCondition);
        params.push(`%${variant}%`);
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

          const scoreCondition = `
            EXISTS (
              SELECT 1 FROM json_each(i.auto_tags, '$.character')
              WHERE LOWER(key) LIKE ?${scoreCheckStr}
            )
          `.trim();

          console.log('[AutoTagSearch] Character score condition SQL:', scoreCondition);

          scoreConditions.push(scoreCondition);

          // 파라미터 순서: 문자열(key LIKE), 숫자(min), 숫자(max)
          params.push(`%${variant}%`);
          if (hasMinFilter) {
            params.push(character.min_score);
          }
          if (hasMaxFilter) {
            params.push(character.max_score);
          }
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
   * 검색어 정규화 및 변형 생성
   * 예: "short_hair" → ["short_hair", "short hair", "shorthair", "short", "hair"]
   *
   * @param term 검색어
   * @param exactMatch Score 필터가 있을 때는 개별 토큰 제외 (더 정확한 매칭)
   * @returns LIKE 패턴으로 사용할 수 있는 검색 변형들
   */
  private static normalizeSearchTerm(term: string, exactMatch: boolean = false): string[] {
    const variants: Set<string> = new Set();
    const normalized = term.trim().toLowerCase();

    if (!normalized) return [];

    // 1. 원본 검색어 추가
    variants.add(normalized);

    // 2. 언더스코어 ↔ 공백 변형
    if (normalized.includes('_')) {
      variants.add(normalized.replace(/_/g, ' '));  // short_hair → short hair
      variants.add(normalized.replace(/_/g, ''));   // short_hair → shorthair
    }

    if (normalized.includes(' ')) {
      variants.add(normalized.replace(/ /g, '_'));  // short hair → short_hair
      variants.add(normalized.replace(/ /g, ''));   // short hair → shorthair
    }

    // 3. 토큰 분리 (언더스코어 또는 공백 기준)
    // exactMatch가 true면 개별 토큰 제외 (Score 필터 사용 시)
    if (!exactMatch) {
      const tokens = normalized.split(/[_ ]+/).filter(t => t.length >= 2);

      // 각 토큰을 개별 검색어로 추가 (너무 짧은 토큰 제외)
      if (tokens.length > 1) {
        for (const token of tokens) {
          if (token.length >= 2) {  // 최소 2자 이상만 추가
            variants.add(token);
          }
        }
      }
    }

    // 4. 하이픈 처리 (추가 변형)
    if (normalized.includes('-')) {
      variants.add(normalized.replace(/-/g, '_'));
      variants.add(normalized.replace(/-/g, ' '));
      variants.add(normalized.replace(/-/g, ''));
    }

    return Array.from(variants);
  }

  /**
   * 검색 변형 패턴에 매칭되는 JSON 키 찾기 (메모리 내)
   *
   * @param jsonObject 검색 대상 JSON 객체
   * @param searchTerm 검색어
   * @returns 매칭된 키들
   */
  private static findMatchingKeys(jsonObject: any, searchTerm: string): string[] {
    if (!jsonObject || typeof jsonObject !== 'object') {
      return [];
    }

    const variants = this.normalizeSearchTerm(searchTerm);
    const matchingKeys: string[] = [];

    for (const key of Object.keys(jsonObject)) {
      const normalizedKey = key.toLowerCase();

      // 각 변형 패턴과 비교
      for (const variant of variants) {
        if (normalizedKey.includes(variant)) {
          matchingKeys.push(key);
          break;  // 하나라도 매칭되면 다음 키로
        }
      }
    }

    return matchingKeys;
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
   * 오토태그가 검색 조건과 일치하는지 확인 (메모리 내 필터링)
   * 주로 자동수집 서비스에서 사용
   */
  static async matchesAutoTagConditions(
    autoTagsJson: string | null,
    searchParams: AutoTagSearchParams
  ): Promise<boolean> {
    // 오토태그가 없는 경우
    if (!autoTagsJson) {
      return searchParams.has_auto_tags === false;
    }

    // 오토태그가 없어야 하는데 있는 경우
    if (searchParams.has_auto_tags === false) {
      return false;
    }

    try {
      const autoTags = JSON.parse(autoTagsJson);

      // Rating 체크
      if (searchParams.rating) {
        if (!this.matchesRating(autoTags.rating, searchParams.rating)) {
          return false;
        }
      }

      // Rating Score 체크 (가중치 기반)
      if (searchParams.rating_score) {
        const scoreMatches = await this.matchesRatingScore(autoTags.rating, searchParams.rating_score);
        if (!scoreMatches) {
          return false;
        }
      }

      // General 태그 체크
      if (searchParams.general_tags && searchParams.general_tags.length > 0) {
        if (!this.matchesGeneralTags(autoTags.general, searchParams.general_tags)) {
          return false;
        }
      }

      // Character 체크
      if (searchParams.character) {
        if (!this.matchesCharacter(autoTags.character, searchParams.character)) {
          return false;
        }
      }

      // Model 체크
      if (searchParams.model) {
        if (autoTags.model !== searchParams.model) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.warn('Failed to parse auto_tags JSON:', error);
      return false;
    }
  }

  /**
   * Rating Score 조건 매칭 (메모리 내, 가중치 기반)
   */
  private static async matchesRatingScore(
    rating: any,
    scoreFilter: { min_score?: number; max_score?: number }
  ): Promise<boolean> {
    if (!rating) return false;

    try {
      // 점수 계산
      const scoreResult = await RatingScoreService.calculateScore(rating);
      const score = scoreResult.score;

      // min_score 체크
      if (scoreFilter.min_score !== undefined && score < scoreFilter.min_score) {
        return false;
      }

      // max_score 체크
      if (scoreFilter.max_score !== undefined && score > scoreFilter.max_score) {
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Failed to calculate rating score:', error);
      return false;
    }
  }

  /**
   * Rating 조건 매칭 (메모리 내)
   */
  private static matchesRating(rating: any, filter: RatingFilter): boolean {
    if (!rating) return false;

    const types = ['general', 'sensitive', 'questionable', 'explicit'] as const;
    for (const type of types) {
      const typeFilter = filter[type];
      if (!typeFilter) continue;

      const value = rating[type];
      if (value === undefined || value === null) return false;

      if (typeFilter.min !== undefined && value < typeFilter.min) return false;
      if (typeFilter.max !== undefined && value > typeFilter.max) return false;
    }

    return true;
  }

  /**
   * General 태그 조건 매칭 (메모리 내, 부분 매칭 지원)
   */
  private static matchesGeneralTags(general: any, filters: TagFilter[]): boolean {
    if (!general) return false;

    for (const filter of filters) {
      // 매칭되는 키 찾기 (부분 매칭 및 정규화 지원)
      const matchingKeys = this.findMatchingKeys(general, filter.tag);

      // 매칭되는 키가 없으면 실패
      if (matchingKeys.length === 0) return false;

      // 매칭된 키들 중 하나라도 Score 조건을 만족하면 통과
      let hasValidScore = false;

      for (const key of matchingKeys) {
        const value = general[key];
        if (value === undefined || value === null) continue;

        // Score 조건 체크
        const meetsMinScore = filter.min_score === undefined || value >= filter.min_score;
        const meetsMaxScore = filter.max_score === undefined || value <= filter.max_score;

        if (meetsMinScore && meetsMaxScore) {
          hasValidScore = true;
          break;
        }
      }

      // Score 조건이 있는데 만족하는 키가 없으면 실패
      if ((filter.min_score !== undefined || filter.max_score !== undefined) && !hasValidScore) {
        return false;
      }
    }

    return true;
  }

  /**
   * Character 조건 매칭 (메모리 내, 부분 매칭 지원)
   */
  private static matchesCharacter(character: any, filter: CharacterFilter): boolean {
    // has_character 체크
    if (filter.has_character !== undefined) {
      const hasChar = character && Object.keys(character).length > 0;
      if (filter.has_character !== hasChar) return false;
    }

    // 특정 캐릭터명 체크 (부분 매칭 지원)
    if (filter.name) {
      if (!character) return false;

      // 매칭되는 키 찾기 (부분 매칭 및 정규화 지원)
      const matchingKeys = this.findMatchingKeys(character, filter.name);

      // 매칭되는 키가 없으면 실패
      if (matchingKeys.length === 0) return false;

      // 매칭된 키들 중 하나라도 Score 조건을 만족하면 통과
      let hasValidScore = false;

      for (const key of matchingKeys) {
        const value = character[key];
        if (value === undefined || value === null) continue;

        // Score 조건 체크
        const meetsMinScore = filter.min_score === undefined || value >= filter.min_score;
        const meetsMaxScore = filter.max_score === undefined || value <= filter.max_score;

        if (meetsMinScore && meetsMaxScore) {
          hasValidScore = true;
          break;
        }
      }

      // Score 조건이 있는데 만족하는 키가 없으면 실패
      if ((filter.min_score !== undefined || filter.max_score !== undefined) && !hasValidScore) {
        return false;
      }
    }

    return true;
  }
}
