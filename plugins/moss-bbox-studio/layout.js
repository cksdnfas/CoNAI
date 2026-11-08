// MOSS-Image layout prompts (https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md#layout-prompts-experimental):
// the prompt is a JSON document whose boxes are `yxyx` pixels measured from the canvas centre (`abs_centralized`).
// Here a draft keeps every box as fractions of the canvas, so resizing the canvas keeps the composition.
// Pure functions only (no DOM, no host calls) so they can be tested on their own.

export const KINDS = [
  { id: 'character', label: '인물' },
  { id: 'object', label: '오브젝트' },
  { id: 'text', label: '텍스트' },
]

/** Sizes are multiples of 16, which the model requires. */
export const SIZE_PRESETS = [
  { id: '9:16', size: [1088, 1920] },
  { id: '3:4', size: [1152, 1536] },
  { id: '1:1', size: [1024, 1024] },
  { id: '4:3', size: [1536, 1152] },
  { id: '16:9', size: [1920, 1088] },
]

/** The palette the app's image detail view uses for layout regions, so a region keeps its colour everywhere. */
export const REGION_COLORS = ['#f95e14', '#4cc9f0', '#ffd166', '#9be564', '#f78fb3', '#b8a1ff']

export const MIN_BOX = 0.02

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const text = (value) => (typeof value === 'string' ? value.trim() : '')

export function snapSize(value) {
  return Math.max(64, Math.round(Number(value) / 16) * 16)
}

export function newDraft(size = SIZE_PRESETS[0].size) {
  return { size: [...size], summary: '', meta: [], canvas: 'single', items: [] }
}

export function cloneDraft(draft) {
  return JSON.parse(JSON.stringify(draft))
}

export function kindId(value) {
  return KINDS.some((kind) => kind.id === value) ? value : 'object'
}

/** Order the corners and keep the box inside the canvas; null when it is too small to mean anything. */
export function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null
  const [x0, y0, x1, y1] = box
  const result = [clamp(Math.min(x0, x1), 0, 1), clamp(Math.min(y0, y1), 0, 1), clamp(Math.max(x0, x1), 0, 1), clamp(Math.max(y0, y1), 0, 1)]
  return result[2] - result[0] >= MIN_BOX && result[3] - result[1] >= MIN_BOX ? result : null
}

export function addRegion(draft, region = {}) {
  const box = normalizeBox(region.box) ?? [0.3, 0.4, 0.6, 0.6]
  draft.items.push({ label: kindId(region.label), caption: text(region.caption), text: text(region.text), box })
  return draft.items.length - 1
}

export function moveRegion(draft, index, delta) {
  const target = index + delta
  if (!draft.items[index] || target < 0 || target >= draft.items.length) return index
  ;[draft.items[index], draft.items[target]] = [draft.items[target], draft.items[index]]
  return target
}

/** The document the model reads: boxes converted to `yxyx` pixels from the canvas centre. */
export function buildLayout(draft) {
  const [width, height] = draft.size
  return {
    summary: { meta: [...draft.meta], canvas: draft.canvas || 'single', caption: draft.summary },
    items: draft.items.map((item) => {
      const [x0, y0, x1, y1] = item.box
      return {
        label: item.label,
        caption: item.caption,
        ...(item.label === 'text' && item.text ? { text: item.text } : {}),
        bbox: [Math.round(y0 * height - height / 2), Math.round(x0 * width - width / 2), Math.round(y1 * height - height / 2), Math.round(x1 * width - width / 2)],
      }
    }),
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  }
}

/** The string a workflow's prompt field receives. */
export function stringifyLayout(draft) {
  return JSON.stringify(buildLayout(draft))
}

function toFractions(bbox, format, space, width, height) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null
  let x0, y0, x1, y1
  if (format === 'yxyx') [y0, x0, y1, x1] = bbox
  else if (format === 'xyxy') [x0, y0, x1, y1] = bbox
  else if (format === 'xywh') [x0, y0, x1, y1] = [bbox[0], bbox[1], bbox[0] + bbox[2], bbox[1] + bbox[3]]
  else return null
  if (space === 'abs_centralized') [x0, x1, y0, y1] = [x0 + width / 2, x1 + width / 2, y0 + height / 2, y1 + height / 2]
  if (space === 'abs_centralized' || space === 'abs') [x0, x1, y0, y1] = [x0 / width, x1 / width, y0 / height, y1 / height]
  else if (space !== 'relative') return null
  return normalizeBox([x0, y0, x1, y1])
}

/**
 * Read a layout prompt back into a draft for a canvas of `size`; null when the text is not a layout document.
 * Besides MOSS's own box format it reads `xyxy`/`xywh` boxes and absolute or relative coordinates that other box tools write.
 */
export function parseLayoutPrompt(prompt, size) {
  const source = text(prompt)
  if (!source.startsWith('{')) return null
  let data
  try { data = JSON.parse(source) } catch { return null }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const summary = data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary) ? data.summary : null
  if (!Array.isArray(data.items) && !summary) return null

  const draft = newDraft(size)
  draft.summary = text(summary?.caption)
  draft.meta = Array.isArray(summary?.meta) ? summary.meta.map(text).filter(Boolean) : []
  draft.canvas = text(summary?.canvas) || 'single'
  const format = text(data.bbox_format) || 'yxyx'
  const space = text(data.bbox_coord_space) || 'abs_centralized'
  let skipped = 0
  for (const item of Array.isArray(data.items) ? data.items : []) {
    if (!item || typeof item !== 'object') continue
    const box = toFractions(item.bbox, format, space, size[0], size[1])
    if (!box) { skipped += 1; continue }
    draft.items.push({ label: kindId(text(item.label) || text(item.type)), caption: text(item.caption), text: text(item.text), box })
  }
  return { draft, skipped }
}

/** Marked-field roles the plugin fills; each maps to the id of one of the workflow's Marked Fields (or ''). */
export const FIELD_ROLES = [
  { id: 'prompt', label: '레이아웃 프롬프트', required: true },
  { id: 'negative', label: '네거티브 프롬프트' },
  { id: 'width', label: '너비' },
  { id: 'height', label: '높이' },
  { id: 'seed', label: '시드' },
]

const textLike = (field) => field.type === 'text' || field.type === 'textarea'
const numeric = (field) => field.type === 'number'
const named = (field, pattern) => pattern.test(`${field.id} ${field.label ?? ''}`)

/** Pick a likely field for each role by its type, id and label. The user can change every choice. */
export function guessFieldMapping(fields) {
  const list = Array.isArray(fields) ? fields : []
  const pick = (candidates, ...patterns) => {
    for (const pattern of patterns) {
      const found = candidates.find((field) => named(field, pattern))
      if (found) return found.id
    }
    return ''
  }
  const texts = list.filter(textLike)
  const negative = pick(texts, /negative|네거티브|\buc\b/i)
  const positives = texts.filter((field) => field.id !== negative && !named(field, /negative|네거티브/i))
  return {
    prompt: pick(positives, /layout|json|레이아웃/i, /positive|prompt|프롬프트/i) || positives[0]?.id || '',
    negative,
    width: pick(list.filter(numeric), /width|너비|가로/i),
    height: pick(list.filter(numeric), /height|높이|세로/i),
    seed: pick(list.filter(numeric), /seed|시드/i),
  }
}

/** Problems that stop a generation request, as short Korean sentences. */
export function mappingIssues(fields, mapping) {
  const ids = new Set((fields ?? []).map((field) => field.id))
  const issues = []
  if (!mapping.prompt || !ids.has(mapping.prompt)) issues.push('레이아웃 프롬프트를 받을 칸을 골라줘.')
  for (const role of FIELD_ROLES) {
    if (mapping[role.id] && !ids.has(mapping[role.id])) issues.push(`${role.label} 칸이 워크플로우에 없어. 다시 골라줘.`)
  }
  const used = FIELD_ROLES.map((role) => mapping[role.id]).filter(Boolean)
  if (new Set(used).size !== used.length) issues.push('한 칸을 두 곳에 연결할 수 없어.')
  return issues
}

/** The `prompt_data` of a queue request: values keyed by Marked Field id. A blank seed is left out so each run draws a new one. */
export function buildPromptData(mapping, { draft, negative = '', seed = '' }) {
  const data = { [mapping.prompt]: stringifyLayout(draft) }
  if (mapping.negative && text(negative)) data[mapping.negative] = text(negative)
  if (mapping.width) data[mapping.width] = draft.size[0]
  if (mapping.height) data[mapping.height] = draft.size[1]
  const parsedSeed = Number(seed)
  if (mapping.seed && String(seed).trim() !== '' && Number.isInteger(parsedSeed) && parsedSeed >= 0) data[mapping.seed] = parsedSeed
  return data
}

/** What a connected chat sees of the draft: boxes in the model's own pixel coordinates, bounded in size. */
export function describeDraft(draft) {
  const layout = buildLayout(draft)
  return {
    size: draft.size,
    summary: draft.summary,
    meta: draft.meta,
    regions: layout.items.map((item, index) => ({ number: index + 1, kind: item.label, caption: item.caption, ...(item.text ? { text: item.text } : {}), bbox_yxyx_center_px: item.bbox })),
  }
}
