/**
 * Block layouts of the generation page. Every arrangeable screen (a "surface": the NAI form, the Codex form, a ComfyUI
 * workflow, the workflows tab…) has its own blocks and its own shared preset list, edited by admins; viewers only pick
 * which preset to use.
 */

export const GENERATION_LAYOUT_SURFACE_DEFINITIONS = {
  nai: {
    blocks: ['prompt', 'characters', 'settings', 'images', 'references', 'vibes', 'action', 'result', 'recent'],
    required: ['action', 'result'],
    columns: [
      { weight: 40, blocks: ['prompt', 'characters', 'settings', 'images', 'references', 'vibes', 'action'] },
      { weight: 60, blocks: ['result', 'recent'] },
    ],
  },
  codex: {
    blocks: ['model', 'prompt', 'output', 'images', 'action', 'result', 'recent'],
    required: ['action', 'result'],
    columns: [
      { weight: 40, blocks: ['model', 'prompt', 'output', 'images', 'action'] },
      { weight: 60, blocks: ['result', 'recent'] },
    ],
  },
  /** A selected ComfyUI workflow. */
  comfy: {
    blocks: ['workflow', 'fields', 'action', 'result', 'recent'],
    required: ['workflow', 'fields', 'action', 'result'],
    columns: [
      { weight: 40, blocks: ['workflow', 'fields', 'action'] },
      { weight: 60, blocks: ['result', 'recent'] },
    ],
  },
  /** The ComfyUI tab before a workflow is picked. */
  'comfy-home': {
    blocks: ['workflows', 'management'],
    required: ['workflows'],
    columns: [{ weight: 100, blocks: ['workflows', 'management'] }],
  },
  /** Workflows tab, browsing: list and outputs. */
  'workflow-browse': {
    blocks: ['list', 'outputs'],
    required: ['list'],
    columns: [{ weight: 40, blocks: ['list'] }, { weight: 60, blocks: ['outputs'] }],
  },
  /** Workflows tab, one workflow open for running. */
  'workflow-run': {
    blocks: ['runner', 'results'],
    required: ['runner', 'results'],
    columns: [{ weight: 40, blocks: ['runner'] }, { weight: 60, blocks: ['results'] }],
  },
} as const satisfies Record<string, { blocks: readonly string[]; required: readonly string[]; columns: ReadonlyArray<{ weight: number; blocks: readonly string[] }> }>;

export type GenerationLayoutSurface = keyof typeof GENERATION_LAYOUT_SURFACE_DEFINITIONS;
export const GENERATION_LAYOUT_SURFACES = Object.keys(GENERATION_LAYOUT_SURFACE_DEFINITIONS) as GenerationLayoutSurface[];
export type GenerationLayoutBlock = (typeof GENERATION_LAYOUT_SURFACE_DEFINITIONS)[GenerationLayoutSurface]['blocks'][number];

export const GENERATION_LAYOUT_LIMITS = { columns: 4, presets: 20, nameLength: 40, minWeight: 10, maxWeight: 100 } as const;

export interface GenerationLayoutColumn {
  /** Relative width (fr). */
  weight: number;
  blocks: GenerationLayoutBlock[];
  /** Show the column's blocks one at a time behind text tabs (not with the result block). */
  tabs?: boolean;
}

export interface GenerationLayoutPreset {
  id: string;
  name: string;
  columns: GenerationLayoutColumn[];
  /** Hidden blocks keep their place in `columns`, so showing one again puts it back where it was. */
  hidden: GenerationLayoutBlock[];
}

export interface GenerationLayoutSurfaceSnapshot {
  presets: GenerationLayoutPreset[];
  revision: string;
}

export type GenerationLayoutSnapshot = Record<GenerationLayoutSurface, GenerationLayoutSurfaceSnapshot>;

export const DEFAULT_GENERATION_LAYOUT_PRESET_ID = 'default';

export function isGenerationLayoutSurface(value: unknown): value is GenerationLayoutSurface {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GENERATION_LAYOUT_SURFACE_DEFINITIONS, value);
}

export function generationLayoutBlocks(surface: GenerationLayoutSurface): readonly GenerationLayoutBlock[] {
  return GENERATION_LAYOUT_SURFACE_DEFINITIONS[surface].blocks;
}

export function isGenerationLayoutRequiredBlock(surface: GenerationLayoutSurface, block: GenerationLayoutBlock) {
  return (GENERATION_LAYOUT_SURFACE_DEFINITIONS[surface].required as readonly string[]).includes(block);
}

export function createDefaultGenerationLayoutPreset(surface: GenerationLayoutSurface): GenerationLayoutPreset {
  return {
    id: DEFAULT_GENERATION_LAYOUT_PRESET_ID,
    name: '기본',
    columns: GENERATION_LAYOUT_SURFACE_DEFINITIONS[surface].columns.map((column) => ({ weight: column.weight, blocks: [...column.blocks] })),
    hidden: [],
  };
}

function clampWeight(value: unknown) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 50;
  return Math.min(GENERATION_LAYOUT_LIMITS.maxWeight, Math.max(GENERATION_LAYOUT_LIMITS.minWeight, number));
}

/**
 * Make any stored or edited arrangement renderable: every block of the surface exactly once, `recent` right beside
 * `result`, `action` last in its column, 1–4 columns. `keepEmptyColumns` is for the editor, where a new column starts empty.
 */
export function normalizeGenerationLayoutColumns(surface: GenerationLayoutSurface, raw: unknown, options: { keepEmptyColumns?: boolean } = {}): GenerationLayoutColumn[] {
  const known = generationLayoutBlocks(surface);
  const seen = new Set<GenerationLayoutBlock>();
  let columns: GenerationLayoutColumn[] = (Array.isArray(raw) ? raw : []).slice(0, GENERATION_LAYOUT_LIMITS.columns).map((column) => {
    const record = column && typeof column === 'object' ? column as Record<string, unknown> : {};
    const blocks = (Array.isArray(record.blocks) ? record.blocks : []).filter((block): block is GenerationLayoutBlock => {
      if (typeof block !== 'string' || !(known as readonly string[]).includes(block) || seen.has(block as GenerationLayoutBlock)) return false;
      seen.add(block as GenerationLayoutBlock);
      return true;
    });
    return { weight: clampWeight(record.weight), blocks, ...(record.tabs === true ? { tabs: true } : {}) };
  });
  if (!options.keepEmptyColumns) columns = columns.filter((column) => column.blocks.length > 0);
  if (columns.length === 0) return createDefaultGenerationLayoutPreset(surface).columns;

  // Blocks this layout does not know yet (added in a later version) join the first column.
  const missing = known.filter((block) => !seen.has(block) && block !== 'recent');
  if (missing.length) columns[0].blocks.push(...missing);

  if (known.includes('recent')) {
    const resultColumn = columns.find((column) => column.blocks.includes('result'))!;
    const recentIndex = resultColumn.blocks.indexOf('recent');
    const before = recentIndex !== -1 && recentIndex < resultColumn.blocks.indexOf('result');
    for (const column of columns) column.blocks = column.blocks.filter((block) => block !== 'recent');
    const resultIndex = resultColumn.blocks.indexOf('result');
    resultColumn.blocks.splice(before ? resultIndex : resultIndex + 1, 0, 'recent');
  }

  for (const column of columns) {
    if (column.blocks.includes('action')) column.blocks = [...column.blocks.filter((block) => block !== 'action'), 'action'];
  }
  return columns;
}

export function normalizeGenerationLayoutPreset(surface: GenerationLayoutSurface, raw: unknown, fallbackId: string): GenerationLayoutPreset {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const id = typeof record.id === 'string' && /^[a-z0-9-]{1,32}$/.test(record.id) ? record.id : fallbackId;
  const name = typeof record.name === 'string' ? record.name.replace(/\s+/g, ' ').trim().slice(0, GENERATION_LAYOUT_LIMITS.nameLength) : '';
  const known = generationLayoutBlocks(surface) as readonly string[];
  const hidden = [...new Set((Array.isArray(record.hidden) ? record.hidden : []).filter((block): block is GenerationLayoutBlock => typeof block === 'string' && known.includes(block)))]
    .filter((block) => !isGenerationLayoutRequiredBlock(surface, block));
  return { id, name: name || '프리셋', columns: normalizeGenerationLayoutColumns(surface, record.columns), hidden };
}

/** At least one preset, unique ids, at most the preset limit. The first preset is everyone's default. */
export function normalizeGenerationLayoutPresets(surface: GenerationLayoutSurface, raw: unknown): GenerationLayoutPreset[] {
  const ids = new Set<string>();
  const presets = (Array.isArray(raw) ? raw : []).slice(0, GENERATION_LAYOUT_LIMITS.presets).map((item, index) => {
    const preset = normalizeGenerationLayoutPreset(surface, item, `preset-${index + 1}`);
    let id = preset.id;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${preset.id}-${suffix}`;
    ids.add(id);
    return { ...preset, id };
  });
  return presets.length ? presets : [createDefaultGenerationLayoutPreset(surface)];
}
