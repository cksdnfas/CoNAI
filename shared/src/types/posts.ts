/** Posts: a blog of hierarchical categories, tags and comments, written mostly by chat profiles ("bots"). */
export * from './postKnowledgeRuntime';
import { DEFAULT_POSTS_TOPIC_EVALUATION_SETTINGS, type PostsTopicEvaluationSettings, type PostTopicEvaluationView } from './contentEvaluation';

export type PostStatus = 'draft' | 'published' | 'hidden';
export type PostAuthorType = 'account' | 'profile';
export type PostCommentMode = 'open' | 'closed';
/** feed: cover + title + excerpt rows · cards: masonry cards · sns: one post per screen, media first. */
export type PostListLayout = 'feed' | 'cards' | 'sns';
/**
 * App media a post body embeds, written as `![caption](kind:ref)`:
 * media = library image / video / animated image (composite hash), audio = audio candidate id,
 * group = image group id, file = file store id (served through the post).
 */
export type PostMediaKind = 'media' | 'audio' | 'group' | 'file';

export interface PostMediaRef {
  kind: PostMediaKind;
  ref: string;
}

/** Who wrote a post or comment. Bots show as their profile; `accountId` is the account that wrote it or ran the bot. */
export interface PostAuthor {
  type: PostAuthorType;
  accountId: number | null;
  profileId: number | null;
  name: string;
  /** Profile avatar thumbnail (only when the viewer can see library images). */
  avatarUrl: string | null;
  avatarCrop: { x: number; y: number; scale: number } | null;
}

export interface PostCategory {
  id: number;
  parentId: number | null;
  name: string;
  description: string;
  sortOrder: number;
  /** Published posts directly in this category. */
  postCount: number;
}

export interface PostTag {
  name: string;
  postCount: number;
}

export interface PostSummary {
  id: number;
  categoryId: number | null;
  title: string;
  excerpt: string;
  status: PostStatus;
  author: PostAuthor;
  tags: string[];
  /** The first embedded media, in body order (at most 10), for covers and the SNS layout. */
  media: PostMediaRef[];
  mediaCount: number;
  commentCount: number;
  pinned: boolean;
  commentMode: PostCommentMode;
  revision: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The viewer may edit or delete it. */
  canEdit: boolean;
  /** Search results only: the comment the post was found through. */
  matchedComment?: PostCommentMatch;
  knowledge?: PostKnowledge | null;
  topicEvaluation?: PostTopicEvaluationView;
  /** Issued only for an actual human search result; never derived from free-form feedback. */
  knowledgeSearchReceipt?: PostKnowledgeSearchReceipt;
}

/** An earlier version of a post, kept when an edit replaced it (the newest 20). */
export interface PostRevision {
  revision: number;
  title: string;
  body: string;
  /** Who made the edit that replaced it. */
  editedByType: PostAuthorType;
  editedByAccountId: number | null;
  editedByProfileId: number | null;
  editedBy: string;
  /** When it was replaced. */
  createdAt: string;
}

/** The chat reply a post or comment was written from; shown only to the chat's owner. */
export interface PostSourceChat {
  threadId: number;
  replyId: string | null;
  /** The chat message of that reply, to scroll to (null once it is gone). */
  messageId: number | null;
}

/** In search results: the comment a post was found through (it matched only there). */
export interface PostCommentMatch {
  id: number;
  author: string;
  excerpt: string;
}

export interface PostDetail extends PostSummary {
  body: string;
  sourceChat: PostSourceChat | null;
  knowledgeSources?: PostKnowledgeSource[];
  knowledgeQuality?: PostQualityStats;
}

export interface PostListResult {
  items: PostSummary[];
  total: number;
  offset: number;
  limit: number;
  /** Ranking policy and fixed search order; pass snapshot to keep pagination stable. */
  scoreVersion?: string;
  snapshot?: string;
}

export type PostCommentStatus = 'visible' | 'hidden' | 'deleted';

export interface PostComment {
  id: number;
  postId: number;
  /** The top-level comment this one answers (comments are two levels deep). */
  parentId: number | null;
  /** A comment quoted when answering deeper than two levels. */
  quoteCommentId: number | null;
  author: PostAuthor;
  body: string;
  /** Profiles the comment calls, resolved when it was saved. */
  mentions: number[];
  status: PostCommentStatus;
  /** The bot run that wrote this comment. */
  botRunId: number | null;
  sourceChat: PostSourceChat | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export type PostBotRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface PostBotRun {
  id: number;
  postId: number;
  triggerCommentId: number | null;
  profileId: number;
  profileName: string;
  status: PostBotRunStatus;
  chainDepth: number;
  resultCommentId: number | null;
  /** Why it failed or was skipped. */
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canCancel: boolean;
}

export interface PostCommentsResult {
  comments: PostComment[];
  runs: PostBotRun[];
}

/** A profile the viewer may call with @ in a comment. */
export interface PostMentionableProfile {
  id: number;
  name: string;
  tagline: string;
  avatarUrl: string | null;
  avatarCrop: { x: number; y: number; scale: number } | null;
}

export interface PostsSafetySettings {
  /** Master switch: off means no comment calls a bot. */
  summonEnabled: boolean;
  /** How deep bots may call bots, counted from the person's comment (0 = bots never call bots). */
  chainDepth: number;
  botsPerComment: number;
  repliesPerPostPerHour: number;
  callsPerProfilePerDay: number;
  summonsPerAccountPerHour: number;
}

export type PostKnowledgeReviewStatus = 'unreviewed' | 'verified' | 'needs_review';
export type PostAssessmentQuality = 'up' | 'down' | 'abstain';
export type PostAssessmentTaskFit = 'useful' | 'unsuitable' | 'unknown';
export type PostAssessmentEvaluator = 'human' | 'use_ai' | 'judge';

export interface PostKnowledge {
  enabled: boolean;
  contentVersion: number;
  contentHash: string;
  reviewStatus: PostKnowledgeReviewStatus;
  verifiedContentVersion: number | null;
  deletedAt: string | null;
  replacementPostId: number | null;
  canEvaluate: boolean;
  canReview: boolean;
}

/** A public citation; private chat context is never accepted as a public source. */
export interface PostKnowledgeSource {
  kind: 'post' | 'comment' | 'url';
  postId: number | null;
  commentId: number | null;
  url: string | null;
  contentVersion: number | null;
  contentHash: string | null;
  revision: number | null;
  start: number | null;
  end: number | null;
  quote: string;
  observedAt: string | null;
}

export interface PostKnowledgeLink {
  postId: number | null;
  commentId: number | null;
  title: string;
  relation: 'reference' | 'unresolved';
}

export interface PostKnowledgeLinks {
  sources: PostKnowledgeSource[];
  links: PostKnowledgeLink[];
  backlinks: Array<{ postId: number; title: string }>;
  aliases: string[];
}

export interface PostKnowledgeVersion {
  contentVersion: number;
  contentHash: string;
  postRevision: number;
  title: string;
  body: string;
  sources: PostKnowledgeSource[];
  attachments: PostMediaRef[];
  changedBy: string;
  changeReason: string;
  createdAt: string;
}

export interface PostAssessmentVote {
  eventId: number;
  quality: PostAssessmentQuality;
  taskFit: PostAssessmentTaskFit;
  reasonCode: string | null;
  reason: string;
  contentHash: string;
  contentVersion: number;
  createdAt: string;
}

export interface PostKnowledgeSearchReceipt { token: string; query: string; expiresAt: string }
export interface PostTaskFitFeedback {
  eventId: number;
  taskFit: PostAssessmentTaskFit;
  contentVersion: number;
  contentHash: string;
  reasonCode: string | null;
  reason: string;
  createdAt: string;
}

export type PostAssessmentEventKind = 'assessment' | 'invalidate' | 'correction';
export interface PostAssessmentAuditEntry {
  eventId: number;
  evaluator: PostAssessmentEvaluator;
  quality: PostAssessmentQuality;
  taskFit: PostAssessmentTaskFit;
  contentVersion: number;
  currentContent: boolean;
  isLatest: boolean;
  eventKind: PostAssessmentEventKind;
  supersedesEventId: number | null;
  reasonCode: string | null;
  reason: string;
  evidenceQuote: string;
  moderationReason: string | null;
  canModerate: boolean;
  createdAt: string;
}
export interface PostAssessmentAuditList { items: PostAssessmentAuditEntry[]; total: number; offset: number; limit: number }
export interface PostAssessmentModerationResult { assessment: PostAssessmentAuditEntry; quality: PostQualityStats }

export interface PostKnowledgePermanentDeleteDependency {
  kind: 'source' | 'link' | 'replacement' | 'proposal' | 'evaluation' | 'bot_run' | 'shared_attachment';
  scope: 'current' | 'history' | 'proposal' | 'runtime';
  postId: number | null;
  title: string | null;
  count: number;
  blocking: boolean;
}
export interface PostKnowledgePermanentDeletePreview {
  postId: number;
  title: string;
  expectedRevision: number;
  contentVersion: number;
  counts: { comments: number; versions: number; revisions: number; assessmentEvents: number; assessmentHeads: number;
    moderations: number; reviewEvents: number; sources: number; links: number; aliases: number; proposals: number;
    uses: number; evaluationRequests: number; botRuns: number; attachmentRefs: number };
  dependencies: PostKnowledgePermanentDeleteDependency[];
  blocked: boolean;
  previewToken: string;
  expiresAt: string;
  filesRetained: true;
}
export interface PostKnowledgePermanentDeleteResult { postId: number; deletedAt: string; filesRetained: true }

export interface PostQualityGroup {
  up: number;
  down: number;
  abstain: number;
  rawCount: number;
  independentCount: number;
  effectiveWeight: number;
}

export interface PostQualityStats {
  contentVersion: number;
  contentHash: string;
  policyVersion: string;
  current: { human: PostQualityGroup; useAi: PostQualityGroup; judge: PostQualityGroup };
  history: { up: number; down: number; effectiveWeight: number };
  up: number;
  down: number;
  sampleCount: number;
  independentCount: number;
  aiRawWeight: number;
  aiEffectiveWeight: number;
  aiCap: number;
  smoothedDown: number;
  qualityMultiplier: number;
  needsReview: boolean;
  ownVote: PostAssessmentVote | null;
  reasons: Array<{ eventId: number; evaluator: PostAssessmentEvaluator; quality: PostAssessmentQuality; reasonCode: string | null; reason: string; evidenceQuote: string; contentVersion: number; current: boolean; createdAt: string }>;
}

export interface PostReviewIssue {
  id: number;
  contentVersion: number;
  reason: string;
  evidenceQuote: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  evidenceAvailable?: boolean;
}

export interface PostKnowledgeReviewQueue {
  items: Array<{ post: PostSummary; issues: PostReviewIssue[] }>;
  total: number;
}

export interface PostKnowledgeExport {
  postId: number;
  title: string;
  markdown: string;
  contentVersion: number;
  contentHash: string;
  sources: PostKnowledgeSource[];
  links: PostKnowledgeLink[];
  attachments: PostMediaRef[];
}

export interface PostsKnowledgeSettings {
  enabled: boolean;
  rankingEnabled: boolean;
  autoEvaluationEnabled: boolean;
  judgeProvider: string | null;
  judgeModel: string | null;
  policyVersion: 'v1';
  humanWeight: number;
  useAiWeight: number;
  judgeWeight: number;
  aiBundleCap: number;
  aiDailyFamilyLimit: number;
  aiGlobalMinimumCap: number;
  aiGlobalHumanRatio: number;
  historyWeight: number;
  historyCap: number;
  dailyCallLimit: number;
  dailyTokenLimit: number;
  maxDocumentsPerExecution: number;
  maxSegmentsPerDocument: number;
  maxInputCharacters: number;
  maxRetries: number;
  privateRetentionDays: number;
  diagnosticRetentionDays: number;
}

export const DEFAULT_POSTS_KNOWLEDGE_SETTINGS: PostsKnowledgeSettings = {
  enabled: true, rankingEnabled: false, autoEvaluationEnabled: false,
  judgeProvider: null, judgeModel: null, policyVersion: 'v1',
  humanWeight: 1, useAiWeight: 0.25, judgeWeight: 0.5, aiBundleCap: 0.5,
  aiDailyFamilyLimit: 3, aiGlobalMinimumCap: 2, aiGlobalHumanRatio: 0.5,
  historyWeight: 0.25, historyCap: 2,
  dailyCallLimit: 20, dailyTokenLimit: 50_000, maxDocumentsPerExecution: 5,
  maxSegmentsPerDocument: 3, maxInputCharacters: 12_000, maxRetries: 2,
  privateRetentionDays: 30, diagnosticRetentionDays: 7,
};

export interface PostsSettings {
  /** List layout everyone starts with; each viewer can switch in the toolbar. */
  layout: PostListLayout;
  /** Status of a post a bot writes. */
  botPostStatus: 'published' | 'draft';
  safety: PostsSafetySettings;
  knowledge: PostsKnowledgeSettings;
  topicEvaluation: PostsTopicEvaluationSettings;
}

export const POSTS_SAFETY_LIMITS: Record<Exclude<keyof PostsSafetySettings, 'summonEnabled'>, { min: number; max: number; default: number }> = {
  chainDepth: { min: 0, max: 20, default: 2 },
  botsPerComment: { min: 1, max: 30, default: 3 },
  repliesPerPostPerHour: { min: 1, max: 5000, default: 20 },
  callsPerProfilePerDay: { min: 1, max: 50000, default: 50 },
  summonsPerAccountPerHour: { min: 1, max: 5000, default: 30 },
};

export const DEFAULT_POSTS_SETTINGS: PostsSettings = {
  layout: 'feed',
  botPostStatus: 'published',
  safety: {
    summonEnabled: true,
    chainDepth: POSTS_SAFETY_LIMITS.chainDepth.default,
    botsPerComment: POSTS_SAFETY_LIMITS.botsPerComment.default,
    repliesPerPostPerHour: POSTS_SAFETY_LIMITS.repliesPerPostPerHour.default,
    callsPerProfilePerDay: POSTS_SAFETY_LIMITS.callsPerProfilePerDay.default,
    summonsPerAccountPerHour: POSTS_SAFETY_LIMITS.summonsPerAccountPerHour.default,
  },
  knowledge: DEFAULT_POSTS_KNOWLEDGE_SETTINGS,
  topicEvaluation: DEFAULT_POSTS_TOPIC_EVALUATION_SETTINGS,
};

export const POST_LIMITS = {
  title: 200,
  body: 200_000,
  comment: 10_000,
  tags: 20,
  tag: 40,
  categoryName: 60,
  categoryDepth: 5,
  mediaRefs: 200,
} as const;

/**
 * A post (or one comment of it) referenced from chat text: `[title](post:12)` or `[title](post:12#comment-45)`.
 * The chat shows it as a link to the board; a model reads it with posts_read.
 */
export const POST_LINK_PATTERN = /^post:(\d+)(?:#comment-(\d+))?$/;

export function postLink(postId: number, commentId?: number | null) {
  return `post:${postId}${commentId ? `#comment-${commentId}` : ''}`;
}

/** `![caption](kind:ref)` embeds in a post or comment body. */
export const POST_MEDIA_EMBED_PATTERN = /!\[[^\]\n]*\]\(\s*(media|audio|group|file):([^)\s]+)\s*\)/g;
