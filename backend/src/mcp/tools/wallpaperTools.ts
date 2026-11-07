import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AppearanceSettings } from '@conai/shared';
import { settingsService } from '../../services/settingsService';
import { WALLPAPER_SCHEDULE_TIME } from '../../services/settingsServiceStorage';
import { resolveScheduledWallpaperPresetId } from '@conai/shared';
import { saveWallpaperSchedule, setLiveWallpaper } from '../../services/wallpaperSettings';
import { errorResult, textResult } from '../toolResults';

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
    { description: 'Get saved wallpaper summaries, live selection, schedule and current scheduled/live/fallback pick; runtime keys, ?preset links or host picks may override it. Edit appearance on the connected wallpaper page.', inputSchema: z.object({}) },
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
    { description: 'Admin: set the live wallpaper; returns updated state. The schedule still takes precedence; open pages refresh within about 5 minutes or on reload. If the ID is missing, choose one from list_wallpapers.', inputSchema: z.object({
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
    { description: 'Admin: replace the wallpaper schedule; returns updated state. Outside windows the live wallpaper shows. If a saved wallpaper is missing, refresh IDs with list_wallpapers before resubmitting.', inputSchema: z.object({
      enabled: z.boolean().describe('false keeps the windows but always shows the live wallpaper'),
      entries: z.array(z.object({
        preset_id: z.string().trim().min(1).describe('Saved wallpaper id from list_wallpapers'),
        days: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('0 = Sunday … 6 = Saturday; omitted or [] = every day'),
        start: clockSchema('Window start'),
        end: clockSchema('Window end').describe('HH:MM local time; before start wraps past midnight on the starting weekday; equal to start means all day'),
      })).max(48).describe('Complete replacement; [] clears. Each window shows preset_id on its weekdays; earlier entries win overlaps.'),
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
