import { NAI_MODEL_OPTIONS, type NAIFormDraft } from './image-generation-shared'

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

export type GenerationBriefNaiReuseCostStatus = 'idle' | 'calculating' | 'ready' | 'unavailable' | 'error'
export type GenerationBriefNaiReuseConnectionStatus = 'connected' | 'disconnected' | 'unknown'
export type GenerationBriefNaiReuseCardStatus = 'ready' | 'missing' | 'warning'

export type GenerationBriefNaiReuseSnapshot = {
  form: NAIFormDraft
  connectionStatus: GenerationBriefNaiReuseConnectionStatus
  tierName?: string
  anlasBalance?: number
  costStatus: GenerationBriefNaiReuseCostStatus
  estimatedCost?: number
  isOpusFree?: boolean
  costErrorMessage?: string | null
}

export type GenerationBriefNaiReuseCard = {
  kind: 'prompt' | 'model' | 'characters' | 'character-references' | 'vibes' | 'source-image' | 'cost-status'
  title: string
  summary: string
  evidence: string[]
  status: GenerationBriefNaiReuseCardStatus
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

const NAI_REUSE_TEXT_LIMIT = 160

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function trimForReuseEvidence(value: string, fallback = 'not set') {
  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) return fallback
  if (normalizedValue.length <= NAI_REUSE_TEXT_LIMIT) return normalizedValue
  return `${normalizedValue.slice(0, NAI_REUSE_TEXT_LIMIT - 1).trimEnd()}…`
}

function resolveNaiModelLabel(model: string) {
  return NAI_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
}

function hasReusableText(value: string) {
  return value.trim().length > 0
}

function getImageFileEvidence(label: string, fileName?: string) {
  return `${label}: ${fileName?.trim() || 'not selected'}`
}

function getNaiCostEvidence(snapshot: GenerationBriefNaiReuseSnapshot) {
  if (snapshot.costStatus === 'ready') {
    if (snapshot.isOpusFree) return 'Cost: Opus free generation'
    if (typeof snapshot.estimatedCost === 'number') return `Cost: ${snapshot.estimatedCost} Anlas`
    return 'Cost: ready'
  }

  if (snapshot.costStatus === 'calculating') return 'Cost: calculating from current local settings'
  if (snapshot.costStatus === 'error') return `Cost: ${snapshot.costErrorMessage || 'estimate unavailable'}`
  if (snapshot.costStatus === 'unavailable') return 'Cost: unavailable until NovelAI is connected'
  return 'Cost: idle'
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

export function buildGenerationBriefNaiReuseCards(snapshot: GenerationBriefNaiReuseSnapshot): GenerationBriefNaiReuseCard[] {
  const { form } = snapshot
  const promptReady = hasReusableText(form.prompt) || hasReusableText(form.negativePrompt)
  const characterPromptCount = form.characters.filter((character) => hasReusableText(character.prompt) || hasReusableText(character.uc)).length
  const characterReferenceCount = form.characterReferences.length
  const vibeCount = form.vibes.length
  const hasSourceImageContext = form.action !== 'generate' || Boolean(form.sourceImage) || Boolean(form.maskImage)
  const connectionEvidence = snapshot.connectionStatus === 'connected'
    ? `NovelAI status: connected${snapshot.tierName ? ` · ${snapshot.tierName}` : ''}${typeof snapshot.anlasBalance === 'number' ? ` · Anlas ${snapshot.anlasBalance}` : ''}`
    : snapshot.connectionStatus === 'disconnected'
      ? 'NovelAI status: disconnected'
      : 'NovelAI status: unknown'

  return [
    {
      kind: 'prompt',
      title: 'NAI prompt context',
      summary: promptReady ? 'Prompt text is ready to reuse in the brief.' : 'No prompt text is available yet.',
      evidence: [
        `Positive prompt: ${trimForReuseEvidence(form.prompt)}`,
        `Negative prompt: ${trimForReuseEvidence(form.negativePrompt)}`,
      ],
      status: promptReady ? 'ready' : 'missing',
    },
    {
      kind: 'model',
      title: 'Model and run settings',
      summary: `${resolveNaiModelLabel(form.model)} · ${form.action} · ${form.width}×${form.height}`,
      evidence: [
        `Sampler: ${form.sampler} · scheduler: ${form.scheduler}`,
        `Steps: ${form.steps} · scale: ${form.scale} · samples: ${form.samples}`,
        `Seed: ${trimForReuseEvidence(form.seed, 'random')}`,
      ],
      status: 'ready',
    },
    {
      kind: 'characters',
      title: 'Character prompts',
      summary: characterPromptCount > 0 ? `${characterPromptCount} character prompt row(s) contain reusable text.` : 'No character prompt rows contain text yet.',
      evidence: form.characters.length > 0
        ? form.characters.map((character, index) => `Character ${index + 1}: prompt ${trimForReuseEvidence(character.prompt)} · UC ${trimForReuseEvidence(character.uc)} · position ${character.centerX},${character.centerY}`)
        : ['No character prompts selected.'],
      status: characterPromptCount > 0 ? 'ready' : 'missing',
    },
    {
      kind: 'character-references',
      title: 'Character references',
      summary: characterReferenceCount > 0 ? `${characterReferenceCount} character/style reference row(s) are available.` : 'No character reference rows are selected.',
      evidence: form.characterReferences.length > 0
        ? form.characterReferences.map((reference, index) => `Reference ${index + 1}: ${reference.type} · strength ${reference.strength} · fidelity ${reference.fidelity} · ${getImageFileEvidence('image', reference.image?.fileName)}`)
        : ['No character reference images selected.'],
      status: characterReferenceCount > 0 ? 'ready' : 'missing',
    },
    {
      kind: 'vibes',
      title: 'Vibe references',
      summary: vibeCount > 0 ? `${vibeCount} Vibe row(s) are available for reuse planning.` : 'No Vibe rows are selected.',
      evidence: form.vibes.length > 0
        ? form.vibes.map((vibe, index) => `Vibe ${index + 1}: strength ${vibe.strength} · information ${vibe.informationExtracted} · ${vibe.encoded.trim() ? 'encoded ready' : 'encoded missing'} · ${getImageFileEvidence('image', vibe.image?.fileName)}`)
        : ['No Vibe images selected.'],
      status: vibeCount > 0 ? 'ready' : 'missing',
    },
    {
      kind: 'source-image',
      title: 'Source image context',
      summary: hasSourceImageContext ? `${form.action} source context is visible for review.` : 'Text-to-image mode has no source image requirement.',
      evidence: [
        `Action: ${form.action}`,
        getImageFileEvidence('Source image', form.sourceImage?.fileName),
        getImageFileEvidence('Mask image', form.maskImage?.fileName),
        `Strength: ${form.strength} · noise: ${form.noise} · add original image: ${form.addOriginalImage}`,
      ],
      status: hasSourceImageContext ? 'ready' : 'warning',
    },
    {
      kind: 'cost-status',
      title: 'Cost and connection status',
      summary: `${connectionEvidence}; ${getNaiCostEvidence(snapshot)}`,
      evidence: [
        connectionEvidence,
        getNaiCostEvidence(snapshot),
        'Boundary: local brief card only; no provider call or queue mutation is performed here.',
      ],
      status: snapshot.connectionStatus === 'connected' && snapshot.costStatus !== 'error' ? 'ready' : 'warning',
    },
  ]
}

export function buildGenerationBriefNaiReusableAssetsText(snapshot: GenerationBriefNaiReuseSnapshot) {
  const cards = buildGenerationBriefNaiReuseCards(snapshot)

  return [
    '## NAI reusable brief cards',
    '- Boundary: local-draft-only',
    '- Local only: true',
    '- External actions executed: false',
    ...cards.flatMap((card) => [
      '',
      `### ${card.title}`,
      `- Status: ${card.status}`,
      `- Summary: ${card.summary}`,
      ...card.evidence.map((item) => `- ${item}`),
    ]),
  ].join('\n')
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
