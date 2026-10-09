import type { PostBotRun, PostBotRunStatus, PostMentionableProfile } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { canUseChatProfile, resolveChatAccess } from '../codex-chat/codexChatAccess';
import { loadChatSettings } from '../codex-chat/chatSettings';
import { ChatProfileStore } from '../codex-chat/chatProfiles';
import { isProfileAssetHidden } from '../codex-chat/chatProfileAssets';
import { PostError, type PostActor } from './postActor';
import { announcePostChange, iso, requirePostRow } from './postStore';
import { loadPostsSettings } from './postsSettings';

export type BotRunRow = {
  id: number; post_id: number; trigger_comment_id: number | null; profile_id: number; profile_name: string; status: PostBotRunStatus;
  run_as_account_id: number | null; requested_by_account_id: number | null; chain_root_comment_id: number | null; chain_depth: number;
  result_comment_id: number | null; error: string | null; created_at: string; started_at: string | null; finished_at: string | null;
};

const db = () => getUserSettingsDb();
/** Runs a post shows: everything still open plus the last day of finished ones. */
const RECENT_FINISHED = "datetime('now', '-1 day')";

function canCancel(actor: PostActor, row: BotRunRow) {
  return (row.status === 'queued' || row.status === 'running') && (actor.isAdmin || (actor.accountId !== null && row.requested_by_account_id === actor.accountId));
}

export function toBotRun(actor: PostActor, row: BotRunRow): PostBotRun {
  return {
    id: row.id, postId: row.post_id, triggerCommentId: row.trigger_comment_id, profileId: row.profile_id, profileName: row.profile_name,
    status: row.status, chainDepth: row.chain_depth, resultCommentId: row.result_comment_id, error: row.error,
    createdAt: iso(row.created_at) as string, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), canCancel: canCancel(actor, row),
  };
}

/** Profiles an account may call: switched on, chat on, and usable by the account (engine key and allowed groups). */
export function summonableProfiles(accountId: number | null) {
  if (!loadPostsSettings().safety.summonEnabled || !loadChatSettings().enabled) return [];
  const access = resolveChatAccess(accountId);
  return ChatProfileStore.list({ enabledOnly: true }).filter((profile) => canUseChatProfile(access, profile));
}

export const PostBotRuns = {
  list(actor: PostActor, postId: number): PostBotRun[] {
    requirePostRow(actor, postId);
    return (db().prepare(`SELECT * FROM post_bot_runs WHERE post_id = ? AND (status IN ('queued', 'running') OR created_at >= ${RECENT_FINISHED}) ORDER BY id`)
      .all(postId) as BotRunRow[]).map((row) => toBotRun(actor, row));
  },

  mentionable(actor: PostActor): PostMentionableProfile[] {
    const canSeeImages = actor.isAdmin || actor.keys.has('images.view');
    return summonableProfiles(actor.accountId).map((profile) => ({
      id: profile.id, name: profile.name, tagline: profile.tagline,
      avatarUrl: canSeeImages && profile.avatarHash && !isProfileAssetHidden(profile.avatarHash) ? `/api/images/${profile.avatarHash}/thumbnail` : null,
      avatarCrop: profile.avatarCrop ?? null,
    }));
  },

  /** The caller or an administrator stops a run that has not finished. A running turn is told to stop. */
  cancel(actor: PostActor, runId: number): PostBotRun {
    const row = db().prepare('SELECT * FROM post_bot_runs WHERE id = ?').get(runId) as BotRunRow | undefined;
    if (!row) throw new PostError('봇 호출을 찾을 수 없어.', 404);
    requirePostRow(actor, row.post_id);
    if (!canCancel(actor, row)) throw new PostError('이 호출을 취소할 수 없어.', 403);
    db().prepare(`UPDATE post_bot_runs SET status = 'cancelled', error = '취소됨', finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'running')`).run(runId);
    for (const listener of cancelListeners) {
      try { listener(runId); } catch { /* the runner logs its own failures */ }
    }
    announcePostChange(row.post_id, 'run');
    return toBotRun(actor, db().prepare('SELECT * FROM post_bot_runs WHERE id = ?').get(runId) as BotRunRow);
  },

  onCancel(listener: (runId: number) => void) {
    cancelListeners.add(listener);
    return () => { cancelListeners.delete(listener); };
  },
};

const cancelListeners = new Set<(runId: number) => void>();
