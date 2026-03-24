import { ImageWithFileView } from './image';

export type PromptSimilarityAlgorithm = 'simhash' | 'minhash';

export interface PromptSimilarityWeights {
  positive: number;
  negative: number;
  auto: number;
}

export interface PromptSimilarityFieldThresholds {
  positive: number;
  negative: number;
  auto: number;
}

export interface PromptSimilaritySettings {
  enabled: boolean;
  algorithm: PromptSimilarityAlgorithm;
  autoBuildOnMetadataUpdate: boolean;
  resultLimit: number;
  combinedThreshold: number;
  weights: PromptSimilarityWeights;
  fieldThresholds: PromptSimilarityFieldThresholds;
}

export interface PromptSimilarityFieldScore {
  similarity: number;
  threshold: number;
  passed: boolean;
  exact: boolean;
  hasSource: boolean;
  hasTarget: boolean;
}

export interface PromptSimilarityMatch {
  image: ImageWithFileView;
  combinedSimilarity: number;
  positive: PromptSimilarityFieldScore;
  negative: PromptSimilarityFieldScore;
  auto: PromptSimilarityFieldScore;
}

export interface PromptSimilaritySearchResult {
  items: PromptSimilarityMatch[];
  total: number;
  settings: PromptSimilaritySettings;
  source: {
    compositeHash: string;
  };
}

export interface PromptSimilarityRebuildResult {
  algorithm: PromptSimilarityAlgorithm;
  processed: number;
  updated: number;
  skipped: number;
}
