/**
 * 프롬프트 수집 관련 타입 정의
 */

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