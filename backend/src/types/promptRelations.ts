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

export type PromptTaxonomyInferredType =
  | 'quality'
  | 'subject'
  | 'count_or_composition'
  | 'pose_or_action'
  | 'body_or_expression'
  | 'hair_or_face'
  | 'clothing_or_accessory'
  | 'background_or_setting'
  | 'lighting_or_mood'
  | 'style'
  | 'artist_or_source'
  | 'meta_or_technical'
  | 'unknown';

export type PromptTaxonomyRelationKind = 'same_family' | 'string_variant';

export interface PromptTaxonomyNodeItem {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
  inferred_type: PromptTaxonomyInferredType;
  cluster_id: string | null;
  canonical_prompt: string | null;
}

export interface PromptTaxonomyEdgeItem {
  source_prompt: string;
  target_prompt: string;
  relation_kind: PromptTaxonomyRelationKind;
  score: number;
}

export interface PromptTaxonomyGraphResult {
  nodes: PromptTaxonomyNodeItem[];
  edges: PromptTaxonomyEdgeItem[];
  filters: {
    type: PromptRelationPromptType;
    inferred_type: PromptTaxonomyInferredType | 'all';
    relation_kind: PromptTaxonomyRelationKind | 'all';
    min_score: number;
    limit: number;
  };
}

export interface PromptTaxonomyRebuildResult {
  processed: number;
  nodes: number;
  clusters: number;
  relations: number;
}
