/**
 * 자동태그 (WD v3 Tagger) 관련 타입 정의
 */

/**
 * Rating 데이터 구조
 */
export interface RatingData {
  general: number;
  sensitive: number;
  questionable: number;
  explicit: number;
}

/**
 * 태그와 점수 쌍
 */
export interface TagScore {
  [tagName: string]: number;
}

/**
 * 자동태그 전체 데이터 구조
 */
export interface AutoTagData {
  caption: string;
  taglist: string;
  rating: RatingData;
  general: TagScore;
  character?: TagScore;
  model: string;
  thresholds: {
    general: number;
    character: number;
  };
  tagged_at: string;
}

/**
 * Rating 필터 조건
 */
export interface RatingFilter {
  general?: { min?: number; max?: number };
  sensitive?: { min?: number; max?: number };
  questionable?: { min?: number; max?: number };
  explicit?: { min?: number; max?: number };
}

/**
 * General 태그 필터 조건
 */
export interface TagFilter {
  tag: string;
  min_score?: number;
  max_score?: number;
}

/**
 * Character 필터 조건
 */
export interface CharacterFilter {
  name?: string;          // 특정 캐릭터명 검색
  min_score?: number;     // 최소 점수
  max_score?: number;     // 최대 점수
  has_character?: boolean; // 캐릭터 존재 여부 (true: 있음, false: 없음)
}

/**
 * 자동태그 검색 파라미터
 */
export interface AutoTagSearchParams {
  rating?: RatingFilter;
  rating_score?: { min_score?: number; max_score?: number };  // 가중치 기반 점수 필터
  general_tags?: TagFilter[];
  any_tags?: TagFilter[];
  character?: CharacterFilter;
  model?: string;
  has_auto_tags?: boolean; // true: 자동태그 있음, false: 없음, undefined: 상관없음
  page?: number;
  limit?: number;
  sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * 자동태그 통계 데이터
 */
export interface AutoTagStats {
  total_images: number;
  tagged_images: number;
  untagged_images: number;
  rating_distribution: {
    general: number;
    sensitive: number;
    questionable: number;
    explicit: number;
  };
  top_general_tags: Array<{
    tag: string;
    count: number;
    avg_score: number;
  }>;
  character_count: number;
  model_distribution: {
    [modelName: string]: number;
  };
}

/**
 * SQL 쿼리 빌더 결과
 */
export interface QueryBuilderResult {
  conditions: string[];
  params: any[];
}
