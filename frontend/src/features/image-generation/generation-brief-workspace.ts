export type GenerationBriefTarget = 'undecided' | 'novelai' | 'comfyui' | 'codex'

export type GenerationBriefDraft = {
  intent: string
  target: GenerationBriefTarget
  sourceReferences: string
  reusableAssets: string
  reviewNotes: string
}

export type GenerationBriefReviewSummary = {
  status: 'empty' | 'drafting' | 'review-ready'
  filledFieldCount: number
  missingFields: Array<keyof GenerationBriefDraft>
  localOnly: true
  externalActionsExecuted: false
  sideEffectBoundary: 'local-draft-only'
}

export type GenerationBriefHandoffPayload = {
  schema: typeof GENERATION_BRIEF_HANDOFF_SCHEMA
  exportedAt: string
  localOnly: true
  externalActionsExecuted: false
  sideEffectBoundary: 'local-draft-only'
  draft: GenerationBriefDraft
  reviewSummary: GenerationBriefReviewSummary
}

export type GenerationBriefImportResult =
  | {
    status: 'imported'
    draft: GenerationBriefDraft
    summary: GenerationBriefReviewSummary
  }
  | {
    status: 'rejected'
    reason: 'empty' | 'invalid-json' | 'invalid-schema' | 'unsafe-boundary'
  }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const GENERATION_BRIEF_STORAGE_KEY = 'conai:image-generation:generation-brief-workspace:v1'
export const GENERATION_BRIEF_HANDOFF_SCHEMA = 'conai.generation-brief.handoff.v1'

export const DEFAULT_GENERATION_BRIEF_DRAFT: GenerationBriefDraft = {
  intent: '',
  target: 'undecided',
  sourceReferences: '',
  reusableAssets: '',
  reviewNotes: '',
}

const GENERATION_BRIEF_FIELDS: Array<keyof GenerationBriefDraft> = [
  'intent',
  'target',
  'sourceReferences',
  'reusableAssets',
  'reviewNotes',
]

const GENERATION_BRIEF_FIELD_LABELS: Record<keyof GenerationBriefDraft, string> = {
  intent: 'Generation intent',
  target: 'Target flow',
  sourceReferences: 'Source references',
  reusableAssets: 'Reusable assets',
  reviewNotes: 'Review notes',
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeTarget(value: unknown): GenerationBriefTarget {
  if (value === 'novelai' || value === 'comfyui' || value === 'codex' || value === 'undecided') {
    return value
  }

  return 'undecided'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeGenerationBriefDraft(value: Partial<GenerationBriefDraft> | null | undefined): GenerationBriefDraft {
  return {
    intent: normalizeText(value?.intent),
    target: normalizeTarget(value?.target),
    sourceReferences: normalizeText(value?.sourceReferences),
    reusableAssets: normalizeText(value?.reusableAssets),
    reviewNotes: normalizeText(value?.reviewNotes),
  }
}

function hasUsefulDraftValue(draft: GenerationBriefDraft, field: keyof GenerationBriefDraft) {
  if (field === 'target') return draft.target !== 'undecided'
  return draft[field].trim().length > 0
}

export function buildGenerationBriefReviewSummary(draft: GenerationBriefDraft): GenerationBriefReviewSummary {
  const missingFields = GENERATION_BRIEF_FIELDS.filter((field) => !hasUsefulDraftValue(draft, field))
  const filledFieldCount = GENERATION_BRIEF_FIELDS.length - missingFields.length
  const status = filledFieldCount === 0
    ? 'empty'
    : missingFields.length === 0
      ? 'review-ready'
      : 'drafting'

  return {
    status,
    filledFieldCount,
    missingFields,
    localOnly: true,
    externalActionsExecuted: false,
    sideEffectBoundary: 'local-draft-only',
  }
}

export function buildGenerationBriefReviewCopy(draft: GenerationBriefDraft) {
  const normalizedDraft = normalizeGenerationBriefDraft(draft)
  const summary = buildGenerationBriefReviewSummary(normalizedDraft)
  const missingFields = summary.missingFields.length > 0
    ? summary.missingFields.map((field) => GENERATION_BRIEF_FIELD_LABELS[field]).join(', ')
    : 'none'

  return [
    '# CoNAI generation brief review',
    '',
    `- Status: ${summary.status}`,
    `- Target flow: ${normalizedDraft.target}`,
    `- Filled fields: ${summary.filledFieldCount}/${GENERATION_BRIEF_FIELDS.length}`,
    `- Missing fields: ${missingFields}`,
    `- Boundary: ${summary.sideEffectBoundary}`,
    `- Local only: ${summary.localOnly}`,
    `- External actions executed: ${summary.externalActionsExecuted}`,
    '',
    '## Generation intent',
    normalizedDraft.intent.trim() || '(empty)',
    '',
    '## Source references',
    normalizedDraft.sourceReferences.trim() || '(empty)',
    '',
    '## Reusable assets',
    normalizedDraft.reusableAssets.trim() || '(empty)',
    '',
    '## Review notes',
    normalizedDraft.reviewNotes.trim() || '(empty)',
  ].join('\n')
}

export function buildGenerationBriefHandoffPayload(draft: GenerationBriefDraft, exportedAt = new Date().toISOString()): GenerationBriefHandoffPayload {
  const normalizedDraft = normalizeGenerationBriefDraft(draft)

  return {
    schema: GENERATION_BRIEF_HANDOFF_SCHEMA,
    exportedAt,
    localOnly: true,
    externalActionsExecuted: false,
    sideEffectBoundary: 'local-draft-only',
    draft: normalizedDraft,
    reviewSummary: buildGenerationBriefReviewSummary(normalizedDraft),
  }
}

export function serializeGenerationBriefHandoffPayload(draft: GenerationBriefDraft, exportedAt = new Date().toISOString()) {
  return JSON.stringify(buildGenerationBriefHandoffPayload(draft, exportedAt), null, 2)
}

export function parseGenerationBriefHandoffPayload(value: string): GenerationBriefImportResult {
  if (value.trim().length === 0) {
    return { status: 'rejected', reason: 'empty' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { status: 'rejected', reason: 'invalid-json' }
  }

  if (!isRecord(parsed) || parsed.schema !== GENERATION_BRIEF_HANDOFF_SCHEMA || !isRecord(parsed.draft)) {
    return { status: 'rejected', reason: 'invalid-schema' }
  }

  if (parsed.localOnly !== true || parsed.externalActionsExecuted !== false || parsed.sideEffectBoundary !== 'local-draft-only') {
    return { status: 'rejected', reason: 'unsafe-boundary' }
  }

  const draft = normalizeGenerationBriefDraft(parsed.draft)

  return {
    status: 'imported',
    draft,
    summary: buildGenerationBriefReviewSummary(draft),
  }
}

export function buildGenerationBriefHandoffFilename(exportedAt: Date | string = new Date()) {
  const isoValue = typeof exportedAt === 'string' ? exportedAt : exportedAt.toISOString()
  const safeTimestamp = isoValue.slice(0, 19).replace(/[T:]/g, '-')
  return `conai-generation-brief-${safeTimestamp || 'local'}.json`
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readGenerationBriefDraft(storage: StorageLike | null = getBrowserStorage()): GenerationBriefDraft {
  if (!storage) return DEFAULT_GENERATION_BRIEF_DRAFT

  try {
    const rawValue = storage.getItem(GENERATION_BRIEF_STORAGE_KEY)
    if (!rawValue) return DEFAULT_GENERATION_BRIEF_DRAFT
    return normalizeGenerationBriefDraft(JSON.parse(rawValue) as Partial<GenerationBriefDraft>)
  } catch {
    return DEFAULT_GENERATION_BRIEF_DRAFT
  }
}

export function saveGenerationBriefDraft(draft: GenerationBriefDraft, storage: StorageLike | null = getBrowserStorage()) {
  const normalizedDraft = normalizeGenerationBriefDraft(draft)

  if (storage) {
    try {
      storage.setItem(GENERATION_BRIEF_STORAGE_KEY, JSON.stringify(normalizedDraft))
    } catch {
      // Storage can be blocked in private, embedded, or policy-restricted contexts.
    }
  }

  return normalizedDraft
}

export function clearGenerationBriefDraft(storage: StorageLike | null = getBrowserStorage()) {
  if (storage) {
    try {
      storage.removeItem(GENERATION_BRIEF_STORAGE_KEY)
    } catch {
      // Storage cleanup can be blocked in private, embedded, or policy-restricted contexts.
    }
  }

  return DEFAULT_GENERATION_BRIEF_DRAFT
}
