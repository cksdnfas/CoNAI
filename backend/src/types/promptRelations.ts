export type PromptRelationPromptType = 'positive' | 'negative' | 'auto';
export type PromptRelationType = 'co_occurrence' | 'continuation';

export interface PromptRelatedPromptItem {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
  shared_count: number;
  score: number;
}

export interface PromptRelatedPromptResult {
  items: PromptRelatedPromptItem[];
  total: number;
  source: {
    prompt: string;
    type: PromptRelationPromptType;
  };
}

export interface PromptRelationRebuildResult {
  processed: number;
  updated: number;
  cleared: number;
}

export interface PromptGraphNodeItem {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
  degree: number;
}

export interface PromptGraphEdgeItem {
  source_prompt: string;
  target_prompt: string;
  shared_count: number;
  score: number;
}

export interface PromptGraphResult {
  nodes: PromptGraphNodeItem[];
  edges: PromptGraphEdgeItem[];
  filters: {
    type: PromptRelationPromptType;
    min_score: number;
    min_shared_count: number;
    min_usage_count: number;
    limit: number;
  };
}
