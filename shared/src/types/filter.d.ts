export type FilterGroupType = 'exclude' | 'or' | 'and';
export type FilterCategory = 'positive_prompt' | 'negative_prompt' | 'auto_tag' | 'basic';
export interface FilterCondition {
    category: FilterCategory;
    type: 'ai_tool' | 'model_name' | 'prompt_contains' | 'prompt_regex' | 'negative_prompt_contains' | 'negative_prompt_regex' | 'auto_tag_exists' | 'auto_tag_has_character' | 'auto_tag_rating' | 'auto_tag_rating_score' | 'auto_tag_general' | 'auto_tag_character' | 'auto_tag_model' | 'auto_tag_any' | 'duplicate_exact' | 'duplicate_near' | 'duplicate_similar' | 'duplicate_custom';
    value: string | number | boolean;
    case_sensitive?: boolean;
    exact_match?: boolean;
    min_score?: number;
    max_score?: number;
    rating_type?: 'general' | 'sensitive' | 'questionable' | 'explicit';
    hamming_threshold?: number;
}
export interface FilterGroup {
    id: string;
    type: FilterGroupType;
    name?: string;
    conditions: FilterCondition[];
}
export interface ComplexFilter {
    exclude_group?: FilterCondition[];
    or_group?: FilterCondition[];
    and_group?: FilterCondition[];
}
export interface ComplexSearchRequest {
    simple_search?: {
        text: string;
    };
    complex_filter?: ComplexFilter;
    ai_tool?: string;
    model_name?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
    sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
    sortOrder?: 'ASC' | 'DESC';
}
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
export interface FilterValidationResult {
    valid: boolean;
    errors: string[];
}
export interface FilterExecutionStats {
    excluded_count: number;
    or_matched_count: number;
    and_matched_count: number;
    final_result_count: number;
    execution_time_ms: number;
}
//# sourceMappingURL=filter.d.ts.map