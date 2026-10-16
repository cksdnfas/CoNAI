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

const storedLayouts = createJsonFileReader(LAYOUTS_FILE, (raw): Partial<Record<GenerationLayoutSurface, unknown>> => {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = raw as { presets?: unknown; surfaces?: Record<string, unknown> };
  // Version 1 held only the NAI list.
  return parsed.surfaces && typeof parsed.surfaces === 'object' ? parsed.surfaces : { nai: parsed.presets };
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
  writeJsonFileAtomic(LAYOUTS_FILE, { version: 2, surfaces });
  return next;
}
