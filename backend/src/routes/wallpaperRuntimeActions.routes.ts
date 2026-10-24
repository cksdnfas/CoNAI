import axios from 'axios';
import type { Request, Response, Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { ComfyUIServerModel } from '../models/ComfyUIServer';
import { GraphWorkflowModel } from '../models/GraphWorkflow';
import { GraphWorkflowScheduleModel } from '../models/GraphWorkflowSchedule';
import { enqueueScheduleRuns, parseStoredScheduleInputValues } from '../services/graphWorkflowScheduleRuns';
import { settingsService } from '../services/settingsService';
import { getWallpaperRuntimeAccess, requireWallpaperRuntimeAdmin as requireAdminReader, sendWallpaperRuntimeForbidden } from '../services/wallpaperRuntimeAccess';
import { errorResponse, successResponse } from '@conai/shared';

const COMFY_STATS_TTL_MS = 3_000;
const COMFY_STATS_TIMEOUT_MS = 2_500;
/** One press per quick-run widget at most this often, whoever presses it. */
const QUICK_RUN_COOLDOWN_MS = 10_000;

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
}
