import type { NextFunction, Request, Response, Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { GenerationQueueModel } from '../models/GenerationQueue';
import { GraphExecutionModel } from '../models/GraphExecution';
import { ImageStatsModel } from '../models/Image/ImageStatsModel';
import { audioCandidateFile, listAudioCandidates } from '../services/audio/audioService';
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess';
import { loadChatSettings } from '../services/codex-chat/chatSettings';
import { ChatProfileStore } from '../services/codex-chat/chatProfiles';
import { profileAssetFields } from '../services/codex-chat/chatProfileAssets';
import { CodexChatStore } from '../services/codex-chat/codexChatStore';
import { CodexChatService } from '../services/codex-chat/codexChatService';
import { GroupChatService } from '../services/codex-chat/groupChatService';
import { getGenerationQueueLiveProgress } from '../services/generation-queue/queueProgressRegistry';
import { GenerationHistoryService } from '../services/generationHistoryService';
import { ImageSafetyService } from '../services/imageSafetyService';
import { buildLlmUsageSummary } from '../services/llmUsage';
import { PostStore } from '../services/posts/postStore';
import { PostError } from '../services/posts/postActor';
import { WildcardService } from '../services/wildcardService';
import {
  getWallpaperRuntimeAccess,
  requireWallpaperRuntimePermission,
  sendWallpaperRuntimeForbidden,
  type WallpaperRuntimeAccess,
} from '../services/wallpaperRuntimeAccess';
import { sendAudioCandidateFile } from './audioCandidateFileResponse';
import { routeParam } from './routeParam';
import { errorResponse, successResponse } from '@conai/shared';

const SERVICE_TYPES = ['novelai', 'comfyui', 'codex'] as const;
type ServiceType = (typeof SERVICE_TYPES)[number];
const LIBRARY_STATS_TTL_MS = 5 * 60_000;
let libraryStatsCache: { at: number; data: unknown } | null = null;

function parseServiceType(value: unknown): ServiceType | undefined {
  return SERVICE_TYPES.includes(value as ServiceType) ? value as ServiceType : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function thumbnailUrl(hash: string | null | undefined) {
  return hash ? `/api/images/${hash}/thumbnail` : null;
}

/** Account-scoped feeds (queue, chat) never open to a logged-out viewer. */
function requireSignedReader(_req: Request, res: Response, next: NextFunction) {
  if (getWallpaperRuntimeAccess(res).isAnonymous) {
    sendWallpaperRuntimeForbidden(res);
    return;
  }
  next();
}

function requireAdminReader(_req: Request, res: Response, next: NextFunction) {
  if (!getWallpaperRuntimeAccess(res).isAdmin) {
    sendWallpaperRuntimeForbidden(res);
    return;
  }
  next();
}

function requireChatReader(_req: Request, res: Response, next: NextFunction) {
  const access = getWallpaperRuntimeAccess(res);
  const chat = resolveChatAccess(access.accountId);
  if (access.isAnonymous || !loadChatSettings().enabled || (!chat.codex && !chat.llm && !chat.claude)) {
    sendWallpaperRuntimeForbidden(res);
    return;
  }
  next();
}

/** Admins read everyone's generations; other accounts their own; anyone else nothing. */
function historyRequesterScope(access: WallpaperRuntimeAccess): { all: true } | { accountId: number } | null {
  if (access.isAdmin) return { all: true };
  if (access.accountId !== null) return { accountId: access.accountId };
  return null;
}

/** Local calendar day of an SQLite UTC timestamp for an offset in minutes east of UTC. */
function localDayExpression(column: string) {
  return `date(datetime(${column}, ? || ' minutes'))`;
}

export function registerWallpaperRuntimeDataRoutes(router: Router) {
  /** Live queue snapshot: counts plus the active jobs with their sampler progress. */
  router.get('/generation/queue', requireSignedReader, (req: Request, res: Response) => {
    const serviceType = parseServiceType(req.query.service);
    const counts = GenerationQueueModel.getStatusCounts(serviceType ? { serviceType } : {});
    const active = GenerationQueueModel.findAllListRecords({
      statuses: ['running', 'dispatching', 'queued'],
      ...(serviceType ? { serviceType } : {}),
      limit: clampInt(req.query.limit, 8, 1, 30),
    }).map((job) => ({
      id: job.id,
      serviceType: job.service_type,
      status: job.status,
      workflowName: job.workflow_name ?? null,
      queuedAt: job.queued_at,
      startedAt: job.started_at ?? null,
      progress: job.status === 'running' ? getGenerationQueueLiveProgress(job.id) ?? null : null,
    }));
    res.json(successResponse({ counts, active }));
  });

  /**
   * Workflow run counts for the queue/activity widgets: a few aggregates instead of the browse snapshot (hundreds of
   * executions plus their outputs) those widgets used to poll every few seconds.
   */
  router.get('/workflow-activity', requireWallpaperRuntimePermission('images.view'), requireSignedReader, (_req: Request, res: Response) => {
    const activity = GraphExecutionModel.summarizeRecentActivity(24);
    res.json(successResponse({
      windowHours: 24,
      workflowCount: activity.workflow_count,
      counts: { queued: activity.queued, running: activity.running, completed: activity.completed, failed: activity.failed },
      recentResults: activity.recent_results,
      oldestQueuedAt: activity.oldest_queued_at,
      oldestRunningAt: activity.oldest_running_at,
      latestUpdatedAt: activity.latest_updated_at,
    }));
  });

  /** Latest finished generations (NAI, ComfyUI, Codex, workflow results) that are safe to show. */
  router.get('/generation/history', requireWallpaperRuntimePermission('images.view'), asyncHandler(async (req: Request, res: Response) => {
    const scope = historyRequesterScope(getWallpaperRuntimeAccess(res));
    // A logged-out viewer has no generations of its own; say so instead of an empty feed that looks like "none yet".
    if (!scope) {
      return sendWallpaperRuntimeForbidden(res);
    }
    const limit = clampInt(req.query.limit, 12, 1, 60);
    const serviceType = parseServiceType(req.query.service);
    const { records } = await GenerationHistoryService.getAllHistory({
      generation_status: 'completed',
      ...(serviceType ? { service_type: serviceType } : {}),
      ...('accountId' in scope ? { requested_by_account_id: scope.accountId } : {}),
      // Hidden or missing results are dropped below, so read a little past the limit.
      limit: limit * 2,
    });
    const items = records
      .filter((record) => (record.actual_composite_hash ?? record.composite_hash) && record.result_file_status !== 'missing' && record.result_file_status !== 'deleted' && !ImageSafetyService.isHidden(record.rating_score))
      .slice(0, limit)
      .map((record) => {
        const hash = (record.actual_composite_hash ?? record.composite_hash) as string;
        return {
          id: record.id,
          serviceType: record.service_type,
          workflowName: record.workflow_name ?? null,
          createdAt: record.created_at ?? null,
          completedAt: record.completed_at ?? null,
          compositeHash: hash,
          width: record.actual_width ?? null,
          height: record.actual_height ?? null,
          mimeType: record.actual_mime_type ?? null,
          thumbnailUrl: thumbnailUrl(hash),
          imageUrl: `/api/images/${hash}/file`,
        };
      });
    return res.json(successResponse(items));
  }));

  /** Generation counts per local day and service over the last `days`. */
  router.get('/generation/stats', requireWallpaperRuntimePermission('images.view'), (req: Request, res: Response) => {
    const scope = historyRequesterScope(getWallpaperRuntimeAccess(res));
    if (!scope) {
      return sendWallpaperRuntimeForbidden(res);
    }
    const days = clampInt(req.query.days, 7, 1, 90);
    const offset = clampInt(req.query.offset, 0, -840, 840);
    const day = localDayExpression('created_at');
    const rows = getUserSettingsDb().prepare(`
      SELECT ${day} AS day, service_type, generation_status, COUNT(*) AS total
      FROM api_generation_history
      WHERE ${day} >= date(datetime('now', ? || ' minutes'), ?)
        ${'accountId' in scope ? 'AND requested_by_account_id = ?' : ''}
      GROUP BY day, service_type, generation_status
    `).all(offset, offset, offset, `-${days - 1} days`, ...('accountId' in scope ? [scope.accountId] : [])) as Array<{ day: string; service_type: ServiceType; generation_status: string; total: number }>;

    const byDay = new Map<string, { date: string; total: number; completed: number; failed: number; byService: Record<ServiceType, number> }>();
    const totals = { total: 0, completed: 0, failed: 0, byService: { novelai: 0, comfyui: 0, codex: 0 } as Record<ServiceType, number> };
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? { date: row.day, total: 0, completed: 0, failed: 0, byService: { novelai: 0, comfyui: 0, codex: 0 } };
      entry.total += row.total;
      totals.total += row.total;
      if (row.generation_status === 'completed') { entry.completed += row.total; totals.completed += row.total; }
      if (row.generation_status === 'failed') { entry.failed += row.total; totals.failed += row.total; }
      if (row.service_type in entry.byService) {
        entry.byService[row.service_type] += row.total;
        totals.byService[row.service_type] += row.total;
      }
      byDay.set(row.day, entry);
    }
    return res.json(successResponse({ days, daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), totals }));
  });

  /** LLM traffic summary (admin data: every account's chats and workflow calls). */
  router.get('/llm-usage', requireAdminReader, (req: Request, res: Response) => {
    res.json(successResponse(buildLlmUsageSummary(clampInt(req.query.days, 7, 1, 90), clampInt(req.query.offset, 0, -840, 840))));
  });

  /**
   * Library size and tag overview over the media a feed shows (hidden tiers excluded, so their tags never reach a
   * public wallpaper); cached because the tag scan is not cheap.
   */
  router.get('/library/stats', requireWallpaperRuntimePermission('images.view'), (_req: Request, res: Response) => {
    const now = Date.now();
    if (!libraryStatsCache || now - libraryStatsCache.at > LIBRARY_STATS_TTL_MS) {
      const stats = ImageStatsModel.getVisibleLibraryStats(20);
      libraryStatsCache = {
        at: now,
        data: {
          total: stats.total,
          taggedImages: stats.tagged_images,
          untaggedImages: stats.untagged_images,
          characterCount: stats.images_with_character,
          ratingDistribution: stats.rating_distribution,
          topTags: stats.top_general_tags,
        },
      };
    }
    res.json(successResponse(libraryStatsCache.data));
  });

  router.get('/chat/profiles', requireChatReader, (_req: Request, res: Response) => {
    const canViewImages = getWallpaperRuntimeAccess(res).permissionKeys.includes('images.view');
    res.json(successResponse(ChatProfileStore.list({ enabledOnly: true }).map((profile) => {
      const assets = profileAssetFields(profile, canViewImages);
      return {
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        tagline: profile.tagline,
        avatarThumbnailUrl: assets.avatarThumbnailUrl,
        backgroundUrl: thumbnailUrl(assets.backgroundHash),
      };
    })));
  });

  /** The reader's own chats, newest first, with the list preview and whether a reply is being written. */
  router.get('/chat/threads', requireChatReader, (req: Request, res: Response) => {
    const access = getWallpaperRuntimeAccess(res);
    const profileId = req.query.profileId === undefined ? null : clampInt(req.query.profileId, 0, 0, Number.MAX_SAFE_INTEGER);
    const threads = CodexChatService.listThreads({ accountId: access.accountId, accountType: access.isAdmin ? 'admin' : 'guest' })
      .filter((thread) => !thread.archived && (profileId === null || thread.profile_id === profileId))
      .sort((left, right) => String(right.updated_date).localeCompare(String(left.updated_date)))
      .slice(0, clampInt(req.query.limit, 10, 1, 30));
    const ids = threads.map((thread) => thread.id);
    const previews = CodexChatStore.listPreviews(ids);
    const unread = CodexChatStore.countUnread(ids);
    res.json(successResponse(threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      kind: thread.kind,
      profileId: thread.profile_id,
      updatedAt: thread.updated_date,
      preview: previews.get(thread.id)?.text || null,
      unreadCount: unread.get(thread.id) ?? 0,
      running: CodexChatService.isRunning(thread.id) || GroupChatService.isRunning(thread.id),
    }))));
  });

  /** Last few messages of one of the reader's chats (text only; the chat widgets embed the real chat). */
  router.get('/chat/threads/:id/messages', requireChatReader, (req: Request, res: Response) => {
    const access = getWallpaperRuntimeAccess(res);
    const threadId = Number(routeParam(req.params.id));
    if (!Number.isSafeInteger(threadId) || !CodexChatStore.findThread(threadId, access.accountId)) {
      res.status(404).json(errorResponse('Chat not found'));
      return;
    }
    const rows = getUserSettingsDb().prepare(`
      SELECT id, role, COALESCE(NULLIF(display_content, ''), content) AS content, speaker_profile_id, created_date
      FROM codex_chat_messages WHERE thread_id = ? AND status = 'completed'
      ORDER BY id DESC LIMIT ?
    `).all(threadId, clampInt(req.query.limit, 3, 1, 12)) as Array<{ id: number; role: 'user' | 'assistant'; content: string; speaker_profile_id: number | null; created_date: string }>;
    res.json(successResponse({
      running: CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId),
      messages: rows.reverse().map((row) => ({
        id: row.id,
        role: row.role,
        text: row.content.length > 600 ? `${row.content.slice(0, 600)}…` : row.content,
        speakerProfileId: row.speaker_profile_id,
        createdAt: row.created_date,
      })),
    }));
  });

  router.get('/audio/groups/:id/candidates', requireWallpaperRuntimePermission('audio.view'), (req: Request, res: Response) => {
    try {
      const { items } = listAudioCandidates(String(routeParam(req.params.id)), { limit: 200 });
      res.json(successResponse(items.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        duration: candidate.file?.duration ?? null,
        fileUrl: `/api/wallpaper-runtime/audio/candidates/${encodeURIComponent(candidate.id)}/file`,
      }))));
    } catch (error) {
      res.status(404).json(errorResponse(error instanceof Error ? error.message : 'Audio group not found'));
    }
  });

  router.get('/audio/candidates/:id/file', requireWallpaperRuntimePermission('audio.view'), (req: Request, res: Response, next: NextFunction) => {
    let found: ReturnType<typeof audioCandidateFile>;
    try {
      found = audioCandidateFile(String(routeParam(req.params.id)));
    } catch {
      res.status(404).json(errorResponse('Audio not found'));
      return;
    }
    sendAudioCandidateFile(req, res, next, found.candidate, found.file);
  });

  /** Newest published posts only, whatever the reader could otherwise see. */
  router.get('/posts/recent', requireWallpaperRuntimePermission('posts.view'), asyncHandler(async (req: Request, res: Response) => {
    const access = getWallpaperRuntimeAccess(res);
    try {
      const result = await PostStore.list(
        { accountId: access.accountId, isAdmin: access.isAdmin, keys: new Set(access.permissionKeys), profileId: null },
        { status: 'published', limit: clampInt(req.query.limit, 5, 1, 20) },
      );
      return res.json(successResponse(result.items.map((post) => {
        const cover = post.media.find((media) => media.kind === 'media');
        return {
          id: post.id,
          title: post.title,
          excerpt: post.excerpt,
          authorName: post.author.name,
          authorAvatarUrl: post.author.avatarUrl ?? null,
          commentCount: post.commentCount,
          coverUrl: cover ? thumbnailUrl(cover.ref) : null,
          publishedAt: post.publishedAt ?? post.createdAt,
        };
      })));
    } catch (error) {
      const status = error instanceof PostError ? error.status : 500;
      return res.status(status).json(errorResponse(error instanceof Error ? error.message : 'Failed to list posts'));
    }
  }));

  /** One roll of a wildcard prompt template (e.g. "__scene__, __light__"). */
  router.get('/prompt-roll', requireWallpaperRuntimePermission('wildcards.view'), (req: Request, res: Response) => {
    const text = typeof req.query.text === 'string' ? req.query.text.slice(0, 2000) : '';
    if (!text.trim()) {
      res.status(400).json(errorResponse('text is required'));
      return;
    }
    const [result] = WildcardService.parseMultiple(text, 'general', 1);
    res.json(successResponse({ text: result ?? text }));
  });
}
