import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AppearanceSettings } from '@conai/shared';
import { settingsService } from '../../services/settingsService';
import { WALLPAPER_SCHEDULE_TIME } from '../../services/settingsServiceStorage';
import { resolveScheduledWallpaperPresetId } from '@conai/shared';
import { saveWallpaperSchedule, setLiveWallpaper } from '../../services/wallpaperSettings';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

/** Compact wallpaper state: saved wallpapers without their widgets, the live one, the schedule and what it shows now. */
function wallpaperState(appearance: AppearanceSettings) {
  const presets = appearance.wallpaperLayoutPresets;
  const schedule = appearance.wallpaperSchedule ?? { enabled: false, entries: [] };
  const live = appearance.wallpaperActivePresetId;
  const now = new Date();
  const saved = (id: string | null) => id !== null && presets.some((preset) => preset.id === id);
  const scheduled = resolveScheduledWallpaperPresetId(schedule, now);
  // The live page's order without a pinning key, link or host pick: schedule, then the live wallpaper, then the first saved.
  const showing = saved(scheduled) ? { preset_id: scheduled, by: 'schedule' }
    : saved(live) ? { preset_id: live, by: 'live' }
      : presets[0] ? { preset_id: presets[0].id, by: 'first_saved' } : null;
  return {
    wallpapers: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      updated_at: preset.updatedAt,
      widgets: preset.widgets.length,
      canvas: preset.canvasWidth && preset.canvasHeight ? `${preset.canvasWidth}x${preset.canvasHeight}` : preset.canvasPresetId,
    })),
    live_preset_id: live,
    schedule: {
      enabled: schedule.enabled,
      entries: schedule.entries.map((entry) => ({ preset_id: entry.presetId, days: entry.days, start: entry.start, end: entry.end })),
    },
    showing_now: showing && {
      ...showing,
      server_clock: { weekday: now.getDay(), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` },
    },
  };
}

const clockSchema = (what: string) => z.string().regex(WALLPAPER_SCHEDULE_TIME).describe(`${what}, HH:MM local time`);

export function registerWallpaperTools(server: McpServer): void {
  server.registerTool(
    'list_wallpapers',
    { description: 'List the saved live wallpapers (id, name, last update, widget count, canvas), which one is live, the time schedule, and which wallpaper the live page shows now (by schedule, live pick, or first saved; a runtime key, ?preset link or Lively/Wallpaper Engine pick can still pin another). Widgets, background and look are edited on the connected wallpaper page, not here.', inputSchema: z.object({}) },
    () => {
      try {
        return textResult(wallpaperState(settingsService.loadSettings().appearance));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'set_live_wallpaper',
    { description: 'Administrators: make a saved wallpaper the live one (as "set live" in the wallpaper editor). An enabled schedule still wins inside its time windows. Open live pages pick the change up on their next settings refresh (within about 5 minutes) or on reload. Returns the new state like list_wallpapers.', inputSchema: z.object({
      preset_id: z.string().trim().min(1).describe('Saved wallpaper id from list_wallpapers'),
    }) },
    ({ preset_id }) => {
      try {
        return textResult(wallpaperState(setLiveWallpaper(preset_id).appearance));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'save_wallpaper_schedule',
    { description: 'Administrators: replace the whole wallpaper time schedule (as the schedule dialog of the wallpaper editor). Each window shows a saved wallpaper on the given weekdays between start and end; end before start wraps past midnight and belongs to the day it started; start equal to end is the whole day. Where windows overlap, the upper (earlier) entry wins. Outside every window the live wallpaper shows. Send entries: [] to clear it. Returns the new state like list_wallpapers.', inputSchema: z.object({
      enabled: z.boolean().describe('false keeps the windows but always shows the live wallpaper'),
      entries: z.array(z.object({
        preset_id: z.string().trim().min(1).describe('Saved wallpaper id from list_wallpapers'),
        days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('0 = Sunday … 6 = Saturday; omitted or [] = every day'),
        start: clockSchema('Window start'),
        end: clockSchema('Window end'),
      })).max(48),
    }) },
    ({ enabled, entries }) => {
      try {
        const stamp = Date.now().toString(36);
        const schedule = {
          enabled,
          entries: entries.map((entry, index) => {
            // Same entry shape the editor writes: all seven days collapse to "every day".
            const days = [...new Set(entry.days ?? [])].sort((a, b) => a - b);
            return { id: `ws-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`, presetId: entry.preset_id, days: days.length === 7 ? [] : days, start: entry.start, end: entry.end };
          }),
        };
        return textResult(wallpaperState(saveWallpaperSchedule(schedule).appearance));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
