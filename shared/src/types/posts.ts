/** Posts: a blog of hierarchical categories, tags and comments, written mostly by chat profiles ("bots"). */

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
}

export interface PostDetail extends PostSummary {
  body: string;
}

export interface PostListResult {
  items: PostSummary[];
  total: number;
  offset: number;
  limit: number;
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

export interface PostsSettings {
  /** List layout everyone starts with; each viewer can switch in the toolbar. */
  layout: PostListLayout;
  /** Status of a post a bot writes. */
  botPostStatus: 'published' | 'draft';
  safety: PostsSafetySettings;
}

export const POSTS_SAFETY_LIMITS: Record<Exclude<keyof PostsSafetySettings, 'summonEnabled'>, { min: number; max: number; default: number }> = {
  chainDepth: { min: 0, max: 5, default: 2 },
  botsPerComment: { min: 1, max: 6, default: 3 },
  repliesPerPostPerHour: { min: 1, max: 200, default: 20 },
  callsPerProfilePerDay: { min: 1, max: 1000, default: 50 },
  summonsPerAccountPerHour: { min: 1, max: 500, default: 30 },
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

/** `![caption](kind:ref)` embeds in a post or comment body. */
export const POST_MEDIA_EMBED_PATTERN = /!\[[^\]\n]*\]\(\s*(media|audio|group|file):([^)\s]+)\s*\)/g;
