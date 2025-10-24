/**
 * Complex Filter System Type Definitions
 * PoE-style advanced filtering with AND/OR/NOT logic
 */

/**
 * Filter group types (execution priority: exclude > or > and)
 */
export type FilterGroupType = 'exclude' | 'or' | 'and';

/**
 * Filter condition category
 */
export type FilterCategory = 'positive_prompt' | 'negative_prompt' | 'auto_tag' | 'basic';

/**
 * Individual filter condition
 */
export interface FilterCondition {
  // Category (대분류)
  category: FilterCategory;

  // Condition type (세부 조건 타입)
  // Basic category
  type: 'ai_tool' | 'model_name' |
        // Prompt category
        'prompt_contains' | 'prompt_regex' |
        'negative_prompt_contains' | 'negative_prompt_regex' |
        // Auto-tag category
        'auto_tag_exists' | 'auto_tag_has_character' |
        'auto_tag_rating' | 'auto_tag_rating_score' |
        'auto_tag_general' | 'auto_tag_character' |
        'auto_tag_model' |
        // Duplicate detection
        'duplicate_exact' | 'duplicate_near' | 'duplicate_similar' | 'duplicate_custom';

  // Condition value
  value: string | number | boolean;

  // Optional fields for specific condition types
  case_sensitive?: boolean;
  exact_match?: boolean;

  // Auto-tag specific fields
  min_score?: number;  // For auto_tag_* conditions (0.0 ~ 1.0 or weighted score)
  max_score?: number;
  rating_type?: 'general' | 'sensitive' | 'questionable' | 'explicit';  // For auto_tag_rating

  // Duplicate detection fields
  hamming_threshold?: number;  // For duplicate_custom (0-64)
}

/**
 * Filter group containing multiple conditions
 */
export interface FilterGroup {
  id: string;  // UUID for group identification
  type: FilterGroupType;  // exclude, or, and
  name?: string;  // Optional group name for display
  conditions: FilterCondition[];
}

/**
 * Complete complex filter structure
 */
export interface ComplexFilter {
  exclude_group?: FilterCondition[];  // Exclude (NOT) conditions - highest priority
  or_group?: FilterCondition[];       // OR conditions - medium priority
  and_group?: FilterCondition[];      // AND conditions - lowest priority
}

/**
 * Complex search request (API request body)
 */
export interface ComplexSearchRequest {
  // Simple search mode (quick text search)
  simple_search?: {
    text: string;  // Search in prompt + auto_tags
  };

  // Advanced search mode (complex filter)
  complex_filter?: ComplexFilter;

  // Common search parameters
  ai_tool?: string;
  model_name?: string;
  start_date?: string;
  end_date?: string;

  // Pagination
  page?: number;
  limit?: number;
  sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Complex search response
 */
export interface ComplexSearchResponse {
  success: boolean;
  data?: {
    images: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  error?: string;
}

/**
 * Filter validation result
 */
export interface FilterValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Filter execution statistics
 */
export interface FilterExecutionStats {
  excluded_count: number;
  or_matched_count: number;
  and_matched_count: number;
  final_result_count: number;
  execution_time_ms: number;
}
