import path from 'path';
import {
  GENERATION_LAYOUT_SURFACES,
  normalizeGenerationLayoutPresets,
  type GenerationLayoutSnapshot,
  type GenerationLayoutSurface,
  type GenerationLayoutSurfaceSnapshot,
} from '@conai/shared';
import { runtimePaths } from '../config/runtimePaths';
import { nativeEditRevision } from './nativeEditRevision';
import { createJsonFileReader, writeJsonFileAtomic } from '../utils/jsonFile';

/** Generation page block layouts: one preset list per surface for every account, edited by admins. */
const LAYOUTS_FILE = path.join(runtimePaths.basePath, 'config', 'generation-layouts.json');

const LAYOUTS_VERSION = 3;

/**
 * Version 2 and earlier put the ComfyUI file name above the workflow header (the default then); it now sits under it.
 * Read-time only: the next save writes version 3, so a later deliberate arrangement is kept.
 */
export function moveComfyFileNameUnderHeader(presets: unknown): unknown {
  if (!Array.isArray(presets)) return presets;
  return presets.map((preset) => {
    const columns = preset && typeof preset === 'object' ? (preset as { columns?: unknown }).columns : undefined;
    if (!Array.isArray(columns)) return preset;
    return {
      ...(preset as object),
      columns: columns.map((column) => {
        const blocks = column && typeof column === 'object' ? (column as { blocks?: unknown }).blocks : undefined;
        if (!Array.isArray(blocks)) return column;
        const fileName = blocks.indexOf('filename');
        const header = blocks.indexOf('workflow');
        if (fileName === -1 || header === -1 || fileName > header) return column;
        const next = blocks.filter((block) => block !== 'filename');
        next.splice(next.indexOf('workflow') + 1, 0, 'filename');
        return { ...(column as object), blocks: next };
      }),
    };
  });
}

const storedLayouts = createJsonFileReader(LAYOUTS_FILE, (raw): Partial<Record<GenerationLayoutSurface, unknown>> => {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = raw as { version?: unknown; presets?: unknown; surfaces?: Record<string, unknown> };
  // Version 1 held only the NAI list.
  const surfaces: Partial<Record<GenerationLayoutSurface, unknown>> = parsed.surfaces && typeof parsed.surfaces === 'object' ? { ...parsed.surfaces } : { nai: parsed.presets };
  if (typeof parsed.version !== 'number' || parsed.version < LAYOUTS_VERSION) surfaces.comfy = moveComfyFileNameUnderHeader(surfaces.comfy);
  return surfaces;
});

function readStored(): Partial<Record<GenerationLayoutSurface, unknown>> {
  return storedLayouts.read();
}

function snapshotOf(surface: GenerationLayoutSurface, raw: unknown): GenerationLayoutSurfaceSnapshot {
  const presets = normalizeGenerationLayoutPresets(surface, raw);
  return { presets, revision: nativeEditRevision(presets) };
}

export function readGenerationLayouts(): GenerationLayoutSnapshot {
  const stored = readStored();
  return Object.fromEntries(GENERATION_LAYOUT_SURFACES.map((surface) => [surface, snapshotOf(surface, stored[surface])])) as GenerationLayoutSnapshot;
}

/** Replace one surface's list; `revision` must match the list the editor started from. */
export function writeGenerationLayouts(surface: GenerationLayoutSurface, presetsInput: unknown, revision: string): GenerationLayoutSurfaceSnapshot | 'conflict' {
  const stored = readStored();
  if (snapshotOf(surface, stored[surface]).revision !== revision) return 'conflict';
  const next = snapshotOf(surface, presetsInput);
  const surfaces = Object.fromEntries(GENERATION_LAYOUT_SURFACES.map((item) => [item, item === surface ? next.presets : snapshotOf(item, stored[item]).presets]));
  writeJsonFileAtomic(LAYOUTS_FILE, { version: LAYOUTS_VERSION, surfaces });
  return next;
}
