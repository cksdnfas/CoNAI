import {
  GENERATION_LAYOUT_LIMITS,
  createDefaultGenerationLayoutPreset,
  isGenerationLayoutPluginBlock,
  normalizeGenerationLayoutColumns,
  type GenerationLayoutBlock,
  type GenerationLayoutPluginBlock,
  type GenerationLayoutColumn,
  type GenerationLayoutPreset,
  type GenerationLayoutSurface,
} from '@conai/shared'

/** Where a dragged block lands: before `index` of `column.blocks` (hidden blocks included); `blocks.length` appends. */
export type GenerationLayoutDropTarget = { column: number; index: number }

export function moveLayoutBlock(surface: GenerationLayoutSurface, preset: GenerationLayoutPreset, block: GenerationLayoutBlock, target: GenerationLayoutDropTarget): GenerationLayoutPreset {
  const columns = preset.columns.map((column) => ({ ...column, blocks: [...column.blocks] }))
  const from = columns.findIndex((column) => column.blocks.includes(block))
  const destination = columns[target.column]
  if (from === -1 || !destination) return preset
  const fromIndex = columns[from].blocks.indexOf(block)
  columns[from].blocks.splice(fromIndex, 1)
  const index = from === target.column && fromIndex < target.index ? target.index - 1 : target.index
  destination.blocks.splice(Math.max(0, Math.min(index, destination.blocks.length)), 0, block)
  return { ...preset, columns: normalizeGenerationLayoutColumns(surface, columns, { keepEmptyColumns: true }) }
}

export function setLayoutBlockHidden(preset: GenerationLayoutPreset, block: GenerationLayoutBlock, hidden: boolean): GenerationLayoutPreset {
  const rest = preset.hidden.filter((item) => item !== block)
  return { ...preset, hidden: hidden ? [...rest, block] : rest }
}

/** Set the width of the column at `index` and take the difference from its right neighbour, keeping both above the minimum. */
export function resizeLayoutColumn(columns: GenerationLayoutColumn[], index: number, weight: number): GenerationLayoutColumn[] {
  const left = columns[index]
  const right = columns[index + 1]
  if (!left || !right) return columns
  const total = left.weight + right.weight
  const nextLeft = Math.round(Math.min(total - GENERATION_LAYOUT_LIMITS.minWeight, Math.max(GENERATION_LAYOUT_LIMITS.minWeight, weight)))
  return columns.map((column, position) => position === index
    ? { ...column, weight: nextLeft }
    : position === index + 1 ? { ...column, weight: total - nextLeft } : column)
}

export function addLayoutColumn(preset: GenerationLayoutPreset): GenerationLayoutPreset {
  if (preset.columns.length >= GENERATION_LAYOUT_LIMITS.columns) return preset
  const weight = Math.round(preset.columns.reduce((sum, column) => sum + column.weight, 0) / preset.columns.length)
  return { ...preset, columns: [...preset.columns, { weight, blocks: [] }] }
}

/** Only an empty column can go; its blocks would otherwise have nowhere to be. */
export function removeLayoutColumn(preset: GenerationLayoutPreset, index: number): GenerationLayoutPreset {
  if (preset.columns.length <= 1 || preset.columns[index]?.blocks.length) return preset
  return { ...preset, columns: preset.columns.filter((_, position) => position !== index) }
}

export function setLayoutColumnTabs(preset: GenerationLayoutPreset, index: number, tabs: boolean): GenerationLayoutPreset {
  return {
    ...preset,
    columns: preset.columns.map((column, position) => {
      if (position !== index) return column
      return tabs ? { ...column, tabs: true } : { weight: column.weight, blocks: column.blocks }
    }),
  }
}

export function resetLayoutPreset(surface: GenerationLayoutSurface, preset: GenerationLayoutPreset): GenerationLayoutPreset {
  const fresh = createDefaultGenerationLayoutPreset(surface)
  return { ...preset, columns: fresh.columns, hidden: fresh.hidden }
}

/** Where `recent` sits relative to `result`, which decides the result block's filmstrip placement. */
export function resolveRecentStripPlacement(preset: GenerationLayoutPreset): 'top' | 'bottom' | 'hidden' {
  if (preset.hidden.includes('recent')) return 'hidden'
  const column = preset.columns.find((item) => item.blocks.includes('result'))
  return column && column.blocks.includes('recent') && column.blocks.indexOf('recent') < column.blocks.indexOf('result') ? 'top' : 'bottom'
}

/**
 * The preset with the plugin blocks that exist now: blocks of plugins that are gone drop out, and a plugin block the
 * preset has never placed joins the end of the last column (before the Generate button).
 */
export function withPluginBlocks(preset: GenerationLayoutPreset, available: readonly GenerationLayoutPluginBlock[]): GenerationLayoutPreset {
  const keep = (block: GenerationLayoutBlock) => !isGenerationLayoutPluginBlock(block) || available.includes(block)
  const placed = new Set(preset.columns.flatMap((column) => column.blocks))
  const missing = available.filter((block) => !placed.has(block)).slice(0, GENERATION_LAYOUT_LIMITS.pluginBlocks)
  if (!missing.length && [...placed, ...preset.hidden].every(keep)) return preset
  const columns = preset.columns.map((column) => ({ ...column, blocks: column.blocks.filter(keep) }))
  const last = columns[columns.length - 1]
  if (last && missing.length) {
    const actionIndex = last.blocks.indexOf('action')
    last.blocks.splice(actionIndex === -1 ? last.blocks.length : actionIndex, 0, ...missing)
  }
  return { ...preset, columns, hidden: preset.hidden.filter(keep) }
}

/** Narrow screens stack the visible blocks in column order. */
export function stackedLayoutBlocks(preset: GenerationLayoutPreset): GenerationLayoutBlock[] {
  return preset.columns.flatMap((column) => column.blocks).filter((block) => !preset.hidden.includes(block))
}
