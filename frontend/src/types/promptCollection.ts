export interface PromptCollectionRecord {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
  synonyms: string | null; // JSON 배열 문자열
  created_at: string;
  updated_at: string;
}

export interface NegativePromptCollectionRecord {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
  synonyms: string | null; // JSON 배열 문자열
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
  type: 'positive' | 'negative';
}

export interface PromptStatistics {
  total_prompts: number;
  total_negative_prompts: number;
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
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface NegativePromptGroupRecord {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface PromptGroupData {
  group_name: string;
  display_order?: number;
  is_visible?: boolean;
}

export interface PromptGroupWithPrompts {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  prompt_count: number;
  created_at: string;
  updated_at: string;
}

export interface PromptItem {
  id: number;
  prompt: string;
  usage_count: number;
  synonyms?: string[];
}

export interface GroupedPrompts {
  id: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
  prompts: PromptItem[];
}

export interface GroupedPromptsResult {
  groups: GroupedPrompts[];
  unclassified_prompts: PromptItem[];
}

export interface PromptGroupResponse {
  success: boolean;
  data?: PromptGroupRecord | PromptGroupRecord[] | PromptGroupWithPrompts[] | GroupedPromptsResult | any;
  error?: string;
}