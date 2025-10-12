import {
  AutoTagSearchParams,
  RatingFilter,
  TagFilter,
  CharacterFilter,
  QueryBuilderResult
} from '../types/autoTag';

/**
 * 오토태그 검색 서비스
 * SQLite JSON 함수를 활용한 동적 쿼리 빌더
 */
export class AutoTagSearchService {
  /**
   * 오토태그 검색 파라미터를 SQL WHERE 조건으로 변환
   */
  static buildAutoTagSearchQuery(searchParams: AutoTagSearchParams): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    // 1. 오토태그 존재 여부 필터
    if (searchParams.has_auto_tags !== undefined) {
      if (searchParams.has_auto_tags === true) {
        conditions.push('auto_tags IS NOT NULL');
      } else {
        conditions.push('auto_tags IS NULL');
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
      conditions.push(`json_extract(auto_tags, '$.model') = ?`);
      params.push(searchParams.model);
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
        conditions.push(`json_extract(auto_tags, '${jsonPath}') >= ?`);
        params.push(filter.min);
      }

      if (filter.max !== undefined) {
        conditions.push(`json_extract(auto_tags, '${jsonPath}') <= ?`);
        params.push(filter.max);
      }
    }

    return { conditions, params };
  }

  /**
   * General 태그 조건 생성
   */
  private static buildGeneralTagConditions(tags: TagFilter[]): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    for (const tagFilter of tags) {
      // 태그명에 특수문자가 있을 수 있으므로 JSON path escape 처리
      const escapedTag = this.escapeJsonPath(tagFilter.tag);
      const jsonPath = `$.general.${escapedTag}`;

      // 태그가 존재하는지 먼저 확인
      const tagConditions: string[] = [];
      tagConditions.push(`json_extract(auto_tags, '${jsonPath}') IS NOT NULL`);

      if (tagFilter.min_score !== undefined) {
        tagConditions.push(`json_extract(auto_tags, '${jsonPath}') >= ?`);
        params.push(tagFilter.min_score);
      }

      if (tagFilter.max_score !== undefined) {
        tagConditions.push(`json_extract(auto_tags, '${jsonPath}') <= ?`);
        params.push(tagFilter.max_score);
      }

      // 각 태그의 조건들을 AND로 결합
      if (tagConditions.length > 0) {
        conditions.push(`(${tagConditions.join(' AND ')})`);
      }
    }

    return { conditions, params };
  }

  /**
   * Character 조건 생성
   */
  private static buildCharacterConditions(character: CharacterFilter): QueryBuilderResult {
    const conditions: string[] = [];
    const params: any[] = [];

    // has_character 플래그가 있는 경우
    if (character.has_character !== undefined) {
      if (character.has_character === true) {
        // 캐릭터 필드가 존재하고 비어있지 않음
        conditions.push(`json_extract(auto_tags, '$.character') IS NOT NULL`);
        conditions.push(`json_type(auto_tags, '$.character') = 'object'`);
      } else {
        // 캐릭터 필드가 없거나 비어있음
        const noCharConditions = [
          `json_extract(auto_tags, '$.character') IS NULL`,
          `json_type(auto_tags, '$.character') != 'object'`,
          `json_extract(auto_tags, '$.character') = '{}'`
        ];
        conditions.push(`(${noCharConditions.join(' OR ')})`);
      }
    }

    // 특정 캐릭터명 검색
    if (character.name) {
      const escapedName = this.escapeJsonPath(character.name);
      const jsonPath = `$.character.${escapedName}`;

      const characterConditions: string[] = [];
      characterConditions.push(`json_extract(auto_tags, '${jsonPath}') IS NOT NULL`);

      if (character.min_score !== undefined) {
        characterConditions.push(`json_extract(auto_tags, '${jsonPath}') >= ?`);
        params.push(character.min_score);
      }

      if (character.max_score !== undefined) {
        characterConditions.push(`json_extract(auto_tags, '${jsonPath}') <= ?`);
        params.push(character.max_score);
      }

      if (characterConditions.length > 0) {
        conditions.push(`(${characterConditions.join(' AND ')})`);
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
   * 오토태그가 검색 조건과 일치하는지 확인 (메모리 내 필터링)
   * 주로 자동수집 서비스에서 사용
   */
  static matchesAutoTagConditions(
    autoTagsJson: string | null,
    searchParams: AutoTagSearchParams
  ): boolean {
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
   * General 태그 조건 매칭 (메모리 내)
   */
  private static matchesGeneralTags(general: any, filters: TagFilter[]): boolean {
    if (!general) return false;

    for (const filter of filters) {
      const value = general[filter.tag];
      if (value === undefined || value === null) return false;

      if (filter.min_score !== undefined && value < filter.min_score) return false;
      if (filter.max_score !== undefined && value > filter.max_score) return false;
    }

    return true;
  }

  /**
   * Character 조건 매칭 (메모리 내)
   */
  private static matchesCharacter(character: any, filter: CharacterFilter): boolean {
    // has_character 체크
    if (filter.has_character !== undefined) {
      const hasChar = character && Object.keys(character).length > 0;
      if (filter.has_character !== hasChar) return false;
    }

    // 특정 캐릭터명 체크
    if (filter.name) {
      if (!character) return false;
      const value = character[filter.name];
      if (value === undefined || value === null) return false;

      if (filter.min_score !== undefined && value < filter.min_score) return false;
      if (filter.max_score !== undefined && value > filter.max_score) return false;
    }

    return true;
  }
}
