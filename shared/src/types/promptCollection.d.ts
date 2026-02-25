export interface PromptCollectionRecord {
    id: number;
    prompt: string;
    usage_count: number;
    group_id: number | null;
    synonyms: string | null;
    created_at: string;
    updated_at: string;
}
export interface NegativePromptCollectionRecord {
    id: number;
    prompt: string;
    usage_count: number;
    group_id: number | null;
    synonyms: string | null;
    created_at: string;
    updated_at: string;
}
export interface PromptCollectionData {
    prompt: string;
    group_id?: number;
    synonyms?: string[];
}
export interface SynonymGroup {
    main_prompt: string;
    synonyms: string[];
    group_id: number;
}
export interface PromptSearchResult {
    id: number;
    prompt: string;
    usage_count: number;
    group_id: number | null;
    synonyms: string[];
    type: 'positive' | 'negative' | 'auto';
}
export interface PromptStatistics {
    total_prompts: number;
    total_negative_prompts: number;
    total_auto_prompts: number;
    most_used_prompts: PromptSearchResult[];
    recent_prompts: PromptSearchResult[];
}
export interface PromptCollectionResponse {
    success: boolean;
    data?: PromptSearchResult | PromptSearchResult[] | PromptStatistics | any;
    error?: string;
}
export interface PromptGroupRecord {
    id: number;
    group_name: string;
    description: string | null;
    is_visible: boolean;
    display_order: number;
    parent_id: number | null;
    created_at: string;
    updated_at: string;
}
export interface PromptGroupData {
    group_name: string;
    description?: string;
    is_visible?: boolean;
    display_order?: number;
    parent_id?: number | null;
}
export interface PromptGroupWithPrompts extends PromptGroupRecord {
    prompt_count: number;
    children?: PromptGroupWithPrompts[];
}
export interface PromptGroupResponse {
    success: boolean;
    data?: PromptGroupRecord | PromptGroupWithPrompts | PromptGroupWithPrompts[] | any;
    error?: string;
}
//# sourceMappingURL=promptCollection.d.ts.map