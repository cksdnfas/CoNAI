import type { ComplexFilter } from './filter';
export interface GroupRecord {
    id: number;
    name: string;
    description?: string;
    color?: string;
    parent_id?: number;
    created_date: string;
    updated_date: string;
    auto_collect_enabled: boolean;
    auto_collect_conditions?: string;
    auto_collect_last_run?: string;
}
export interface ImageGroupRecord {
    id: number;
    group_id: number;
    image_id: number;
    added_date: string;
    order_index: number;
    collection_type: 'manual' | 'auto';
    auto_collected_date?: string;
}
export interface AutoCollectCondition {
    type: 'prompt_contains' | 'prompt_regex' | 'negative_prompt_contains' | 'negative_prompt_regex' | 'ai_tool' | 'model_name' | 'auto_tag_rating' | 'auto_tag_general' | 'auto_tag_character' | 'auto_tag_model' | 'auto_tag_has_character' | 'auto_tag_exists' | 'auto_tag_rating_score' | 'duplicate_exact' | 'duplicate_near' | 'duplicate_similar' | 'duplicate_custom';
    value: string | number | boolean;
    case_sensitive?: boolean;
    exact_match?: boolean;
    min_score?: number;
    max_score?: number;
    rating_type?: 'general' | 'sensitive' | 'questionable' | 'explicit';
    hamming_threshold?: number;
}
export interface GroupCreateData {
    name: string;
    description?: string;
    color?: string;
    parent_id?: number;
    auto_collect_enabled?: boolean;
    auto_collect_conditions?: AutoCollectCondition[] | ComplexFilter;
}
export interface GroupUpdateData {
    name?: string;
    description?: string;
    color?: string;
    parent_id?: number;
    auto_collect_enabled?: boolean;
    auto_collect_conditions?: AutoCollectCondition[] | ComplexFilter;
}
export interface GroupWithStats extends GroupRecord {
    image_count: number;
    auto_collected_count: number;
    manual_added_count: number;
}
export interface GroupResponse {
    success: boolean;
    data?: any;
    error?: string;
}
export interface AutoCollectResult {
    group_id: number;
    group_name: string;
    images_added: number;
    images_removed: number;
    execution_time: number;
}
export interface GroupWithHierarchy extends GroupWithStats {
    child_count: number;
    has_children: boolean;
    depth?: number;
}
export interface BreadcrumbItem {
    id: number;
    name: string;
    color?: string | null;
}
export interface HierarchyValidation {
    valid: boolean;
    error?: string;
    current_depth?: number;
    max_depth?: number;
}
export interface GroupMoveRequest {
    parent_id: number | null;
}
//# sourceMappingURL=group.d.ts.map