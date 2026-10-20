import { WALLPAPER_BACKGROUND_KINDS, WALLPAPER_WIDGET_TYPES } from '@conai/shared';
import type { AppSettings, WallpaperSchedule, WallpaperWidgetType } from '@conai/shared';
import { settingsService } from './settingsService';
import { normalizeWallpaperSchedule, WALLPAPER_SCHEDULE_TIME } from './settingsServiceStorage';

/**
 * Wallpaper settings rules shared by the appearance settings route (the wallpaper editor) and the MCP wallpaper tools:
 * the same validation and the same `settingsService.updateAppearanceSettings` save.
 */

const validWallpaperWidgetTypes: readonly WallpaperWidgetType[] = WALLPAPER_WIDGET_TYPES;

function validateWallpaperWidget(widget: unknown, path: string): string | null {
  if (!widget || typeof widget !== 'object') {
    return `${path} must be an object`;
  }

  const record = widget as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    return `${path}.id must be a non-empty string`;
  }

  if (!validWallpaperWidgetTypes.includes(record.type as WallpaperWidgetType)) {
    return `${path}.type must be one of: ${validWallpaperWidgetTypes.join(', ')}`;
  }

  const integerFields = ['x', 'y', 'w', 'h', 'zIndex'] as const;
  for (const field of integerFields) {
    const value = record[field];
    if (!Number.isInteger(value)) {
      return `${path}.${field} must be an integer`;
    }
  }

  if (typeof record.locked !== 'boolean') {
    return `${path}.locked must be a boolean`;
  }

  if (typeof record.hidden !== 'boolean') {
    return `${path}.hidden must be a boolean`;
  }

  if (record.settings !== undefined && (record.settings === null || typeof record.settings !== 'object' || Array.isArray(record.settings))) {
    return `${path}.settings must be an object`;
  }

  if (record.style !== undefined && (record.style === null || typeof record.style !== 'object' || Array.isArray(record.style))) {
    return `${path}.style must be an object`;
  }

  if (record.rotation !== undefined && (typeof record.rotation !== 'number' || !Number.isFinite(record.rotation))) {
    return `${path}.rotation must be a number`;
  }

  return null;
}

export function validateWallpaperLayoutPresets(layoutPresets: unknown): string | null {
  if (!Array.isArray(layoutPresets)) {
    return 'wallpaperLayoutPresets must be an array';
  }

  for (const [index, preset] of layoutPresets.entries()) {
    if (!preset || typeof preset !== 'object') {
      return `wallpaperLayoutPresets[${index}] must be an object`;
    }

    const record = preset as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      return `wallpaperLayoutPresets[${index}].id must be a non-empty string`;
    }

    if (typeof record.name !== 'string' || record.name.trim().length === 0 || record.name.trim().length > 80) {
      return `wallpaperLayoutPresets[${index}].name must be a non-empty string up to 80 characters`;
    }

    if (typeof record.canvasPresetId !== 'string' || record.canvasPresetId.trim().length === 0) {
      return `wallpaperLayoutPresets[${index}].canvasPresetId must be a non-empty string`;
    }

    if (!Array.isArray(record.widgets)) {
      return `wallpaperLayoutPresets[${index}].widgets must be an array`;
    }

    if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
      return `wallpaperLayoutPresets[${index}] must include createdAt and updatedAt strings`;
    }

    if (record.version !== undefined && !Number.isInteger(record.version)) {
      return `wallpaperLayoutPresets[${index}].version must be an integer`;
    }

    for (const field of ['canvasWidth', 'canvasHeight'] as const) {
      const value = record[field];
      if (value !== undefined && (!Number.isInteger(value) || Number(value) < 320 || Number(value) > 7680)) {
        return `wallpaperLayoutPresets[${index}].${field} must be an integer between 320 and 7680`;
      }
    }

    if (record.themeMode !== undefined && record.themeMode !== 'dark' && record.themeMode !== 'light' && record.themeMode !== 'auto') {
      return `wallpaperLayoutPresets[${index}].themeMode must be dark, light or auto`;
    }

    if (record.options !== undefined && (!record.options || typeof record.options !== 'object' || Array.isArray(record.options))) {
      return `wallpaperLayoutPresets[${index}].options must be an object`;
    }

    if (record.background !== undefined) {
      const background = record.background as Record<string, unknown> | null;
      if (!background || typeof background !== 'object' || Array.isArray(background) || !(WALLPAPER_BACKGROUND_KINDS as readonly unknown[]).includes(background.kind)) {
        return `wallpaperLayoutPresets[${index}].background.kind must be one of: ${WALLPAPER_BACKGROUND_KINDS.join(', ')}`;
      }
    }

    for (const [widgetIndex, widget] of record.widgets.entries()) {
      const widgetError = validateWallpaperWidget(widget, `wallpaperLayoutPresets[${index}].widgets[${widgetIndex}]`);
      if (widgetError) {
        return widgetError;
      }
    }
  }

  return null;
}

export function validateWallpaperSchedule(schedule: unknown): string | null {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    return 'wallpaperSchedule must be an object';
  }
  const record = schedule as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') {
    return 'wallpaperSchedule.enabled must be a boolean';
  }
  if (!Array.isArray(record.entries) || record.entries.length > 48) {
    return 'wallpaperSchedule.entries must be an array of up to 48 windows';
  }
  for (const [index, entry] of record.entries.entries()) {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
    if (!item || typeof item.id !== 'string' || typeof item.presetId !== 'string' || !item.presetId.trim()) {
      return `wallpaperSchedule.entries[${index}] needs an id and a presetId`;
    }
    if (typeof item.start !== 'string' || !WALLPAPER_SCHEDULE_TIME.test(item.start) || typeof item.end !== 'string' || !WALLPAPER_SCHEDULE_TIME.test(item.end)) {
      return `wallpaperSchedule.entries[${index}].start and end must be HH:MM`;
    }
    if (!Array.isArray(item.days) || item.days.some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) {
      return `wallpaperSchedule.entries[${index}].days must be weekday numbers 0-6`;
    }
  }
  return null;
}

function savedPresetIds() {
  return new Set(settingsService.loadSettings().appearance.wallpaperLayoutPresets.map((preset) => preset.id));
}

/** Make a saved wallpaper the live one (the editor's "set live"). */
export function setLiveWallpaper(presetId: string): AppSettings {
  if (!savedPresetIds().has(presetId)) {
    throw new Error(`Wallpaper not found: ${presetId}. Use a saved wallpaper id from list_wallpapers.`);
  }
  return settingsService.updateAppearanceSettings({ wallpaperActivePresetId: presetId });
}

/** Replace the whole schedule; every window must name a saved wallpaper, as in the editor's schedule dialog. */
export function saveWallpaperSchedule(schedule: unknown): AppSettings {
  const error = validateWallpaperSchedule(schedule);
  if (error) throw new Error(error);
  const ids = savedPresetIds();
  const unknown = [...new Set((schedule as WallpaperSchedule).entries.map((entry) => entry.presetId).filter((id) => !ids.has(id)))];
  if (unknown.length > 0) {
    throw new Error(`Unknown wallpaper id(s) in the schedule: ${unknown.join(', ')}. Use saved wallpaper ids from list_wallpapers.`);
  }
  return settingsService.updateAppearanceSettings({ wallpaperSchedule: normalizeWallpaperSchedule(schedule) });
}
