/** Content judging is shared; publication and access stay with the target feature. */
export interface ContentEvaluationTopic {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ContentEvaluationSettings {
  revision: number;
  definitionVersion: number;
  modelSlotId: number | null;
  topics: ContentEvaluationTopic[];
  modelReady: boolean;
}

export interface ContentEvaluationSettingsInput {
  expectedRevision: number;
  modelSlotId: number | null;
  topics: ContentEvaluationTopic[];
}

export type TopicRelevanceLevel = 'none' | 'mention' | 'partial' | 'major' | 'core' | 'unknown' | 'mixed';
export interface TopicRelevanceItem {
  topicId: string;
  name: string;
  description: string;
  score: number | null;
  level: TopicRelevanceLevel;
  answerStatus: 'answered' | 'unknown' | 'missing';
}

export type PostTopicEvaluationStatus = 'unassessed' | 'queued' | 'running' | 'completed' | 'partial' | 'skipped' | 'failed' | 'cancelled' | 'superseded';
export interface PostTopicEvaluationView {
  postId: number;
  contentHash: string;
  requestId: number | null;
  status: PostTopicEvaluationStatus;
  reasonCode: string | null;
  isCurrent: boolean;
  staleReason: 'content_changed' | 'definition_changed' | 'model_changed' | null;
  items: TopicRelevanceItem[];
  coverage: 'full' | 'partial';
  inputCharacters: number | null;
  totalCharacters: number | null;
  evaluatedAt: string | null;
  modelLabel: string | null;
  definitionVersion: number | null;
  canRequest: boolean;
  minimumScore: number;
  maximumTopics: number;
}

export interface PostsTopicEvaluationSettings {
  autoEnabled: boolean;
  reevaluateOnEdit: boolean;
  minimumScore: number;
  maximumTopics: number;
  dailyCallLimit: number;
  dailyTokenLimit: number;
  maxInputCharacters: number;
  maxRetries: number;
}
export const DEFAULT_POSTS_TOPIC_EVALUATION_SETTINGS: PostsTopicEvaluationSettings = {
  autoEnabled: false, reevaluateOnEdit: true, minimumScore: 50, maximumTopics: 3,
  dailyCallLimit: 20, dailyTokenLimit: 50_000, maxInputCharacters: 12_000, maxRetries: 2,
};
export const TOPIC_EVALUATION_LIMITS = {
  activeTopics: 20, totalTopics: 100, nameCharacters: 40, descriptionCharacters: 1000,
  manualCooldownMs: 60_000,
} as const;
