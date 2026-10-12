import type { PostKnowledgeSource, PostMediaRef, PostStatus } from './posts';

/** Positions are UTF-16 offsets in the exact original Markdown returned by posts_read. */
export interface PostKnowledgeEvidence {
  scope: 'body' | 'comment';
  start: number;
  end: number;
  quote: string;
}

export interface PostKnowledgeReference {
  useId: string;
  referenceToken: string;
  postId: number;
  commentId: number | null;
  contentVersion: number;
  contentHash: string;
  intervals: Array<{ start: number; end: number }>;
  scope: 'body' | 'comment';
  trust: 'observed_execution' | 'external_unverified';
  expiresAt: string;
}

export type PostKnowledgeAssessmentStage = 'provisional' | 'final';
export type PostKnowledgeQualityVote = 'up' | 'down' | 'abstain';
export type PostKnowledgeTaskFit = 'useful' | 'unsuitable' | 'unknown';
export type PostKnowledgeReasonCode = 'error' | 'outdated' | 'insufficient_evidence' | 'reproduction_failed' | 'helpful' | 'scope_mismatch' | 'uncertain';

export interface PostKnowledgeAssessmentInput {
  useId: string;
  referenceToken: string;
  stage: PostKnowledgeAssessmentStage;
  quality: PostKnowledgeQualityVote;
  taskFit: PostKnowledgeTaskFit;
  reasonCode: PostKnowledgeReasonCode;
  evidence: PostKnowledgeEvidence[];
  idempotencyKey: string;
}

export type PostEvaluationStatus = 'queued' | 'running' | 'completed' | 'skipped' | 'failed' | 'cancelled';
export interface PostEvaluationRequest {
  id: string;
  postId: number;
  contentVersion: number;
  purpose: 'document_review' | 'use_review';
  status: PostEvaluationStatus;
  attempts: number;
  /** Provider-reported token total, null when not reported. No estimated price. */
  totalTokens: number | null;
  reasonCode: string | null;
  createdAt: string;
  finishedAt: string | null;
  runtimeJobId: string | null;
  canCancel: boolean;
  /** Private operational facts for the execution's account; never a public conversation transcript. */
  taskContext?: PostKnowledgeTaskContext;
  /** Allowlisted technical metadata only; no endpoint, error message, request or response contents. */
  failureDiagnostic?: PostKnowledgeEvaluationFailure;
}

export interface PostKnowledgeEvaluationFailure {
  errorClass: 'JudgeError' | 'TypesafeError' | 'LlmRequestError' | 'PostError' | 'TimeoutError' | 'AbortError' | 'SyntaxError' | 'TypeError' | 'Error' | 'Unknown';
  httpStatus: number | null;
  errorCode: string | null;
}

export interface PostKnowledgeProposalInput {
  kind: 'create' | 'update';
  postId?: number;
  baseRevision?: number;
  baseContentVersion?: number;
  title: string;
  body: string;
  sources: PostKnowledgeSource[];
  reason?: string;
  idempotencyKey: string;
  categoryId?: number | null;
  tags?: string[];
  status?: Extract<PostStatus, 'draft' | 'published'>;
}

export interface PostKnowledgeProposal {
  id: string;
  kind: 'create' | 'update';
  postId: number | null;
  baseRevision: number | null;
  baseContentVersion: number | null;
  title: string;
  body: string;
  baseTitle: string | null;
  baseBody: string | null;
  baseSources: PostKnowledgeSource[];
  proposedPostStatus: PostStatus;
  categoryId: number | null;
  tags: string[];
  attachments: PostMediaRef[];
  sources: PostKnowledgeSource[];
  status: 'pending' | 'applied' | 'rejected';
  reason: string;
  proposedByName: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  appliedPostId: number | null;
  appliedRevision: number | null;
  appliedContentVersion: number | null;
  canApply: boolean;
  canReject: boolean;
}

export interface PostKnowledgeProposalList {
  items: PostKnowledgeProposal[];
  total: number;
  offset: number;
  limit: number;
}

export type PostKnowledgeProposalDetail = PostKnowledgeProposal;
export type PostKnowledgeProposalListResult = PostKnowledgeProposalList;

export interface PostKnowledgeEvaluationStatus {
  queued: number;
  running: number;
  completed: number;
  skipped: number;
  failed: number;
  cancelled: number;
  todayCalls: number;
  todayTokens: number | null;
  todayReservedTokens: number;
  tokensUnreported: number;
  enabled: boolean;
  providerReady: boolean;
}

/** A server-authorized human action, never free-form private chat or model-supplied intent. */
export interface PostKnowledgeTaskPurpose {
  kind: 'image_generation' | 'image_redraw' | 'audio_generation' | 'lore_save' | 'choices';
  source: 'human_order';
  conditionKey: string;
}

/** These facts prove only a particular operation's state; they do not prove the whole user goal was achieved. */
export interface PostKnowledgeTaskObservation {
  source: 'generation_queue';
  scope: 'operation';
  operation: 'image_generation' | 'audio_generation';
  operationKey: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  artifactCount: number;
  observedAt: string;
}

export interface PostKnowledgeTaskContext {
  purpose: PostKnowledgeTaskPurpose | null;
  observations: PostKnowledgeTaskObservation[];
  goalOutcome: 'unknown';
  evidenceAvailable: boolean;
}
