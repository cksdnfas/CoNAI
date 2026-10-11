import axios from 'axios';
import type { NextFunction, Request, Response, Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { ComfyUIServerModel } from '../models/ComfyUIServer';
import { GraphWorkflowModel } from '../models/GraphWorkflow';
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule';
import { ChatGroupStore } from '../services/codex-chat/chatGroupStore';
import { ChatProfileStore } from '../services/codex-chat/chatProfiles';
import { loadChatSettings } from '../services/codex-chat/chatSettings';
import { resolveChatAccess } from '../services/codex-chat/codexChatAccess';
import { CodexChatService } from '../services/codex-chat/codexChatService';
import { GroupChatService } from '../services/codex-chat/groupChatService';
import { enqueueScheduleRuns, parseStoredScheduleInputValues } from '../services/graphWorkflowScheduleRuns';
import { settingsService } from '../services/settingsService';
import { getWallpaperRuntimeAccess, sendWallpaperRuntimeForbidden } from '../services/wallpaperRuntimeAccess';
import { logger } from '../utils/logger';
import { errorResponse, successResponse } from '@conai/shared';

const COMFY_STATS_TTL_MS = 3_000;
const COMFY_STATS_TIMEOUT_MS = 2_500;
/** One press per quick-run widget at most this often, whoever presses it. */
const QUICK_RUN_COOLDOWN_MS = 10_000;
/** One message per chat widget at most this often, whoever types it. */
const CHAT_SEND_COOLDOWN_MS = 5_000;
const CHAT_SEND_MAX_LENGTH = 500;

interface ComfyServerStats {
  id: number;
  name: string;
  online: boolean;
  /** Bytes; null when the server did not report them. */
  ramTotal: number | null;
  ramFree: number | null;
  devices: Array<{ name: string; vramTotal: number; vramFree: number }>;
}

let comfyStatsCache: { at: number; data: ComfyServerStats[] } | null = null;
const quickRunPressedAt = new Map<string, number>();
const chatSentAt = new Map<string, number>();

function requireAdminReader(_req: Request, res: Response, next: NextFunction) {
  if (!getWallpaperRuntimeAccess(res).isAdmin) {
    sendWallpaperRuntimeForbidden(res);
    return;
  }
  next();
}

/** The chats a chat widget lists, newest first (the same order as GET /chat/threads), of one character when it names one. */
function widgetChatThreads(accountId: number | null, isAdmin: boolean, profileId: number | null, limit: number) {
  return CodexChatService.listThreads({ accountId, accountType: isAdmin ? 'admin' : 'guest' })
    .filter((thread) => !thread.archived && (profileId === null || thread.profile_id === profileId))
    .sort((left, right) => String(right.updated_date).localeCompare(String(left.updated_date)))
    .slice(0, limit);
}

/** Chat widgets that can send: chat-recent (its one chat) and chat-inbox (any chat in its list). */
const CHAT_SEND_WIDGET_TYPES = new Set(['chat-recent', 'chat-inbox']);

/** Whether a reply in this chat can act beyond text: CoNAI tools, or a Codex / Claude Code engine with its own. */
function chatUsesTools(thread: { id: number; kind: string; profile_id: number | null }) {
  const profileIds = thread.kind === 'group'
    ? ChatGroupStore.members(thread.id).map((member) => member.profile_id)
    : thread.profile_id === null ? [] : [thread.profile_id];
  return profileIds.some((profileId) => {
    const profile = ChatProfileStore.find(profileId);
    return !profile || profile.mcpEnabled || profile.engine !== 'llm';
  });
}

function finiteOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readComfyServerStats(): Promise<ComfyServerStats[]> {
  if (comfyStatsCache && Date.now() - comfyStatsCache.at < COMFY_STATS_TTL_MS) return comfyStatsCache.data;
  // Modal backends have no /system_stats and bill per call; only self-hosted ComfyUI is asked.
  const servers = ComfyUIServerModel.findActiveServers().filter((server) => server.backend_type !== 'modal');
  const data = await Promise.all(servers.map(async (server): Promise<ComfyServerStats> => {
    try {
      const response = await axios.get(`${server.endpoint.replace(/\/+$/, '')}/system_stats`, { timeout: COMFY_STATS_TIMEOUT_MS });
      const system = response.data?.system ?? {};
      const devices = Array.isArray(response.data?.devices) ? response.data.devices : [];
      return {
        id: server.id,
        name: server.name,
        online: true,
        ramTotal: finiteOrNull(system.ram_total),
        ramFree: finiteOrNull(system.ram_free),
        devices: devices
          .filter((device: Record<string, unknown>) => typeof device?.vram_total === 'number' && (device.vram_total as number) > 0)
          .map((device: Record<string, unknown>) => ({
            name: typeof device.name === 'string' ? device.name.replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, '') : 'GPU',
            vramTotal: Number(device.vram_total),
            vramFree: Number(device.vram_free ?? 0),
          })),
      };
    } catch {
      return { id: server.id, name: server.name, online: false, ramTotal: null, ramFree: null, devices: [] };
    }
  }));
  comfyStatsCache = { at: Date.now(), data };
  return data;
}

/** Live-wallpaper actions beyond reads: ComfyUI GPU stats and the quick-run button. */
export function registerWallpaperRuntimeActionRoutes(router: Router) {
  router.get('/comfyui/stats', requireAdminReader, asyncHandler(async (_req: Request, res: Response) => {
    res.json(successResponse(await readComfyServerStats()));
  }));

  /**
   * Run the workflow schedule a saved quick-run widget points at. Only widgets an administrator saved into a
   * preset can trigger a run, so a runtime key cannot start arbitrary work; the reader also needs
   * generation.execute, and the schedule must run as the reader's account unless the reader is an administrator
   * (the same rule as "run now" on the schedule page).
   */
  router.post('/quick-run', asyncHandler(async (req: Request, res: Response) => {
    const access = getWallpaperRuntimeAccess(res);
    if (access.isAnonymous || !access.permissionKeys.includes('generation.execute')) {
      return sendWallpaperRuntimeForbidden(res);
    }
    const presetId = typeof req.body?.presetId === 'string' ? req.body.presetId : '';
    const widgetId = typeof req.body?.widgetId === 'string' ? req.body.widgetId : '';
    const preset = settingsService.loadSettings().appearance.wallpaperLayoutPresets.find((item) => item.id === presetId);
    const widget = preset?.widgets.find((item) => item.id === widgetId && item.type === 'quick-run');
    const scheduleId = Number(widget?.settings?.scheduleId);
    if (!widget || !Number.isInteger(scheduleId)) {
      return res.status(404).json(errorResponse('Quick-run button not found in a saved wallpaper'));
    }
    const schedule = GraphWorkflowScheduleModel.findById(scheduleId);
    if (!schedule || !GraphWorkflowModel.findById(schedule.graph_workflow_id)) {
      return res.status(404).json(errorResponse('Schedule not found'));
    }
    const runAs = schedule.run_as_account_id ?? null;
    if (runAs !== null && runAs !== access.accountId && !access.isAdmin) {
      return res.status(403).json(errorResponse('Only the schedule owner or an administrator can run it'));
    }
    const pressKey = `${presetId}:${widgetId}`;
    const lastPressed = quickRunPressedAt.get(pressKey) ?? 0;
    if (Date.now() - lastPressed < QUICK_RUN_COOLDOWN_MS) {
      return res.status(429).json(errorResponse('Pressed too recently'));
    }
    quickRunPressedAt.set(pressKey, Date.now());

    const result = enqueueScheduleRuns({
      scheduleId,
      workflowId: schedule.graph_workflow_id,
      inputValues: parseStoredScheduleInputValues(schedule.input_values),
      requestedCount: 1,
      maxRunCount: schedule.max_run_count,
      requestedByAccountId: runAs ?? access.accountId,
    });
    if (result.enqueued_count > 0) {
      GraphWorkflowScheduleModel.update(scheduleId, {
        last_execution_id: result.execution_ids.at(-1) ?? null,
        last_enqueued_at: new Date().toISOString(),
      });
    }
    return res.json(successResponse({ enqueued: result.enqueued_count, executionId: result.execution_ids.at(-1) ?? null }));
  }));

  /**
   * Send a message from a saved chat widget that allows replies. The key reads (and writes) as the issuing account,
   * so the chat must be one the saved widget shows (its list is resolved here from the widget's settings; the
   * request only names which of them), and a chat whose replies can use tools also needs the widget's own
   * "allow tools". The reply is written in the background; the widget picks it up from the chat events.
   */
  router.post('/chat/send', (req: Request, res: Response) => {
    const access = getWallpaperRuntimeAccess(res);
    const chat = resolveChatAccess(access.accountId);
    if (access.isAnonymous || !loadChatSettings().enabled || (!chat.codex && !chat.llm && !chat.claude)) {
      return sendWallpaperRuntimeForbidden(res);
    }
    const presetId = typeof req.body?.presetId === 'string' ? req.body.presetId : '';
    const widgetId = typeof req.body?.widgetId === 'string' ? req.body.widgetId : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const preset = settingsService.loadSettings().appearance.wallpaperLayoutPresets.find((item) => item.id === presetId);
    const widget = preset?.widgets.find((item) => item.id === widgetId && CHAT_SEND_WIDGET_TYPES.has(item.type));
    const settings = (widget?.settings ?? {}) as { profileId?: unknown; allowReply?: unknown; allowTools?: unknown; listCount?: unknown };
    if (!widget || settings.allowReply !== true) {
      return res.status(404).json(errorResponse('Chat widget with replies not found in a saved wallpaper'));
    }
    if (!text || text.length > CHAT_SEND_MAX_LENGTH) {
      return res.status(400).json(errorResponse(`Message must be 1-${CHAT_SEND_MAX_LENGTH} characters`));
    }
    const profileId = typeof settings.profileId === 'number' && Number.isSafeInteger(settings.profileId) ? settings.profileId : null;
    const listed = widget.type === 'chat-inbox' ? Math.min(30, Math.max(1, Math.round(Number(settings.listCount) || 8))) : 1;
    const threads = widgetChatThreads(access.accountId, access.isAdmin, profileId, listed);
    if (threads.length === 0) return res.status(404).json(errorResponse('Chat not found'));
    // The list can change between rendering and sending; never post into a chat the widget no longer shows.
    const thread = threads.find((item) => item.id === Number(req.body?.threadId));
    if (!thread) {
      return res.status(409).json({ success: false, error: 'The chat changed; refresh and try again', code: 'chat_changed' });
    }
    if (settings.allowTools !== true && chatUsesTools(thread)) {
      return res.status(403).json({ success: false, error: 'This chat can use tools; allow tools on the widget first', code: 'tools_not_allowed' });
    }
    const isGroup = thread.kind === 'group';
    if (isGroup ? GroupChatService.isRunning(thread.id) : CodexChatService.isRunning(thread.id)) {
      return res.status(409).json({ success: false, error: 'Still answering', code: 'chat_running' });
    }
    const sendKey = `${presetId}:${widgetId}`;
    if (Date.now() - (chatSentAt.get(sendKey) ?? 0) < CHAT_SEND_COOLDOWN_MS) {
      return res.status(429).json(errorResponse('Sent too recently'));
    }
    chatSentAt.set(sendKey, Date.now());

    const requester = { accountId: access.accountId, accountType: access.isAdmin ? 'admin' as const : 'guest' as const };
    const sending = isGroup
      ? GroupChatService.sendMessage(requester, thread.id, text, () => {})
      : CodexChatService.sendMessage(requester, thread.id, text, () => {});
    void sending.catch((error: unknown) => logger.warn('[WallpaperChat] Send failed:', error));
    return res.status(202).json(successResponse({ threadId: thread.id }));
  });
}
