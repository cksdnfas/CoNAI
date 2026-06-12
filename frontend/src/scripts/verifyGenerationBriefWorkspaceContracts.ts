import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGenerationBriefComfyCompatibilityCards,
  buildGenerationBriefComfyCompatibilityText,
  buildGenerationBriefHandoffFilename,
  buildGenerationBriefHistoryEvolutionSummary,
  buildGenerationBriefHistoryDiscoveryLabels,
  buildGenerationBriefHistoryQueryResult,
  buildGenerationBriefHistoryRestoreComparison,
  buildGenerationBriefHistorySnapshot,
  buildGenerationBriefHistorySnapshotComparison,
  buildGenerationBriefImportDiff,
  buildGenerationBriefRecoveryCheckpoint,
  buildGenerationBriefSelectiveImportDraft,
  countGenerationBriefSelectedImportChanges,
  buildGenerationBriefIterationHandoffCards,
  buildGenerationBriefIterationHandoffSnapshotFromHistoryRecord,
  buildGenerationBriefIterationHandoffText,
  buildGenerationBriefNaiReusableAssetsText,
  buildGenerationBriefNaiReuseCards,
  buildGenerationBriefReadinessGate,
  buildGenerationBriefReviewCopy,
  buildGenerationBriefReviewSummary,
  buildGenerationBriefSaveMetadata,
  clearGenerationBriefDraft,
  clearGenerationBriefHistorySnapshots,
  clearGenerationBriefRecoveryCheckpoint,
  DEFAULT_GENERATION_BRIEF_DRAFT,
  deleteGenerationBriefHistorySnapshot,
  GENERATION_BRIEF_HANDOFF_SCHEMA,
  GENERATION_BRIEF_HISTORY_STORAGE_KEY,
  GENERATION_BRIEF_RECOVERY_STORAGE_KEY,
  GENERATION_BRIEF_SAVE_METADATA_STORAGE_KEY,
  GENERATION_BRIEF_STORAGE_KEY,
  normalizeGenerationBriefDraft,
  parseGenerationBriefHandoffPayload,
  readGenerationBriefDraft,
  readGenerationBriefHistorySnapshots,
  readGenerationBriefRecoveryCheckpoint,
  readGenerationBriefSaveMetadata,
  saveGenerationBriefDraft,
  saveGenerationBriefHistorySnapshot,
  saveGenerationBriefRecoveryCheckpoint,
  serializeGenerationBriefHandoffPayload,
  type GenerationBriefComfyCompatibilitySnapshot,
  type GenerationBriefDraft,
  type GenerationBriefNaiReuseSnapshot,
} from '../features/image-generation/generation-brief-workspace'
import { DEFAULT_NAI_FORM } from '../features/image-generation/image-generation-shared'
import type { ComfyUIServer, WorkflowMarkedField } from '../lib/api-image-generation-types'

const root = process.cwd()
const pageSource = readFileSync(join(root, 'src/features/image-generation/image-generation-page.tsx'), 'utf8')
const componentSource = readFileSync(join(root, 'src/features/image-generation/components/generation-brief-workspace.tsx'), 'utf8')
const panelSource = readFileSync(join(root, 'src/features/image-generation/components/nai-generation-panel.tsx'), 'utf8')
const contractSource = readFileSync(join(root, 'src/features/image-generation/generation-brief-workspace.ts'), 'utf8')

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const emptySummary = buildGenerationBriefReviewSummary(DEFAULT_GENERATION_BRIEF_DRAFT)
equal(emptySummary.status, 'empty', 'empty brief should stay empty')
equal(emptySummary.localOnly, true, 'brief summary should be explicitly local-only')
equal(emptySummary.externalActionsExecuted, false, 'brief summary must not claim provider calls or queue operations')
equal(emptySummary.sideEffectBoundary, 'local-draft-only', 'brief boundary should remain a local draft')
equal(emptySummary.missingFields.length, 5, 'empty brief should report all missing planning fields')
const emptyReadinessGate = buildGenerationBriefReadinessGate(DEFAULT_GENERATION_BRIEF_DRAFT)
equal(emptyReadinessGate.status, 'not-ready', 'empty brief readiness gate should not be ready')
equal(emptyReadinessGate.missingCount, 3, 'empty readiness gate should flag missing intent, target, and evidence')
equal(emptyReadinessGate.externalActionsExecuted, false, 'readiness gate must not claim external actions')
equal(emptyReadinessGate.queueMutations, false, 'readiness gate must not mutate queues')
equal(emptyReadinessGate.fileMutations, false, 'readiness gate must not mutate files')

const unsafeInput = normalizeGenerationBriefDraft({
  intent: '  portrait lighting plan  ',
  target: 'provider-call' as GenerationBriefDraft['target'],
  sourceReferences: null as unknown as string,
  reusableAssets: 'NAI Vibe + Comfy workflow candidate',
})
equal(unsafeInput.target, 'undecided', 'unknown generation target should fail closed')
equal(unsafeInput.sourceReferences, '', 'non-string source references should normalize to an empty local note')

const readyDraft: GenerationBriefDraft = {
  intent: 'portrait lighting plan',
  target: 'novelai',
  sourceReferences: 'prior result #42',
  reusableAssets: 'character reference and Vibe notes',
  reviewNotes: 'avoid queueing until user presses generate',
}
const readySummary = buildGenerationBriefReviewSummary(readyDraft)
equal(readySummary.status, 'review-ready', 'filled brief should be review-ready')
equal(readySummary.filledFieldCount, 5, 'filled brief should count all planning fields')
deepEqual(readySummary.missingFields, [], 'filled brief should not report missing fields')
const readyReadinessGate = buildGenerationBriefReadinessGate(readyDraft)
equal(readyReadinessGate.status, 'ready', 'filled draft with no warning cards should pass the readiness gate')
equal(readyReadinessGate.readyCount, 5, 'filled draft should mark every readiness item ready')

const reviewCopy = buildGenerationBriefReviewCopy(readyDraft)
ok(reviewCopy.includes('# CoNAI generation brief review'), 'review copy should be a plain text handoff')
ok(reviewCopy.includes('Readiness gate: ready'), 'review copy should include readiness gate status')
ok(reviewCopy.includes('## Readiness gate'), 'review copy should include the readiness gate section')
ok(reviewCopy.includes('External actions executed: false'), 'review copy must preserve the no-external-action boundary')
ok(reviewCopy.includes('portrait lighting plan'), 'review copy should include local intent text')

const naiReuseSnapshot: GenerationBriefNaiReuseSnapshot = {
  form: {
    ...DEFAULT_NAI_FORM,
    prompt: 'masterpiece portrait, black background',
    negativePrompt: 'low quality, blurry',
    model: 'nai-diffusion-4-5-curated',
    action: 'img2img',
    sourceImage: { fileName: 'source-reference.png', dataUrl: 'data:image/png;base64,SECRET' },
    characters: [{ prompt: 'blue hair heroine', uc: 'extra arms', centerX: '0.5', centerY: '0.3' }],
    vibes: [{ image: { fileName: 'vibe.png', dataUrl: 'data:image/png;base64,VIBE' }, encoded: 'encoded-payload', strength: '0.7', informationExtracted: '1' }],
    characterReferences: [{ image: { fileName: 'character-ref.png', dataUrl: 'data:image/png;base64,REF' }, type: 'character&style', strength: '0.6', fidelity: '0.8' }],
  },
  connectionStatus: 'connected',
  tierName: 'Opus',
  anlasBalance: 321,
  costStatus: 'ready',
  estimatedCost: 5,
  isOpusFree: false,
}
const naiReuseCards = buildGenerationBriefNaiReuseCards(naiReuseSnapshot)
equal(naiReuseCards.length, 7, 'NAI reuse card builder should expose every planned context category')
ok(naiReuseCards.some((card) => card.kind === 'prompt' && card.evidence.some((item) => item.includes('masterpiece portrait'))), 'NAI cards should include prompt evidence')
ok(naiReuseCards.some((card) => card.kind === 'character-references' && card.evidence.some((item) => item.includes('character-ref.png'))), 'NAI cards should include character reference evidence')
ok(naiReuseCards.some((card) => card.kind === 'vibes' && card.evidence.some((item) => item.includes('encoded ready'))), 'NAI cards should include Vibe readiness evidence')
ok(naiReuseCards.some((card) => card.kind === 'source-image' && card.evidence.some((item) => item.includes('source-reference.png'))), 'NAI cards should include source image context')
ok(naiReuseCards.some((card) => card.kind === 'cost-status' && card.evidence.some((item) => item.includes('5 Anlas'))), 'NAI cards should include cost/status context')
const naiReusableAssetsText = buildGenerationBriefNaiReusableAssetsText(naiReuseSnapshot)
ok(naiReusableAssetsText.includes('External actions executed: false'), 'NAI reusable text should preserve the no-external-action boundary')
ok(naiReusableAssetsText.includes('NAI Diffusion 4.5 Curated'), 'NAI reusable text should include readable model context')
ok(!naiReusableAssetsText.includes('data:image'), 'NAI reusable text must not copy image data URLs into the brief')

const comfyWorkflowFields: WorkflowMarkedField[] = [
  {
    id: 'prompt',
    label: 'Prompt',
    jsonPath: '$.6.inputs.text',
    type: 'textarea',
    required: true,
  },
  {
    id: 'seed',
    label: 'Seed',
    jsonPath: '$.3.inputs.seed',
    type: 'number',
    required: true,
  },
  {
    id: 'reference_image',
    label: 'Reference image',
    jsonPath: '$.12.inputs.image',
    type: 'image',
  },
]
const comfyServers: ComfyUIServer[] = [
  {
    id: 2,
    name: 'Studio GPU',
    endpoint: 'http://127.0.0.1:8188',
    backend_type: 'comfyui',
    capacity: 1,
    routing_tags: ['portrait', 'render'],
    is_active: true,
    is_default: true,
  },
]
const comfyCompatibilitySnapshot: GenerationBriefComfyCompatibilitySnapshot = {
  workflowId: 7,
  workflowName: 'Studio portrait workflow',
  workflowDescription: 'Portrait workflow with prompt, seed, and optional reference image.',
  workflowFields: comfyWorkflowFields,
  workflowDraft: {
    prompt: ['masterpiece portrait', 'rim light'],
    seed: '',
    reference_image: { fileName: 'pose-reference.png', dataUrl: 'data:image/png;base64,COMFYSECRET' },
  },
  selectedTarget: 'server:2',
  servers: comfyServers,
  serverTests: {
    2: {
      isLoading: false,
      status: {
        server_id: 2,
        server_name: 'Studio GPU',
        endpoint: 'http://127.0.0.1:8188',
        is_connected: true,
        is_idle: true,
      },
    },
  },
}
const comfyCompatibilityCards = buildGenerationBriefComfyCompatibilityCards(comfyCompatibilitySnapshot)
equal(comfyCompatibilityCards.length, 5, 'Comfy compatibility builder should expose every planned context category')
ok(comfyCompatibilityCards.some((card) => card.kind === 'workflow' && card.evidence.some((item) => item.includes('Workflow ID: 7'))), 'Comfy cards should include workflow identity evidence')
ok(comfyCompatibilityCards.some((card) => card.kind === 'target' && card.summary.includes('Studio GPU')), 'Comfy cards should include selected server context')
ok(comfyCompatibilityCards.some((card) => card.kind === 'expected-inputs' && card.evidence.some((item) => item.includes('Prompt: textarea'))), 'Comfy cards should include marked-field input context')
ok(comfyCompatibilityCards.some((card) => card.kind === 'missing-data' && card.evidence.some((item) => item.includes('Missing required inputs: Seed'))), 'Comfy cards should warn about missing required draft values')
const comfyCompatibilityText = buildGenerationBriefComfyCompatibilityText(comfyCompatibilitySnapshot)
ok(comfyCompatibilityText.includes('Comfy workflow compatibility summary'), 'Comfy reusable text should have a clear summary heading')
ok(comfyCompatibilityText.includes('Studio portrait workflow'), 'Comfy reusable text should include selected workflow context')
ok(comfyCompatibilityText.includes('Prompt: textarea · required · masterpiece portrait, rim light'), 'Comfy reusable text should include joined textarea draft evidence')
ok(comfyCompatibilityText.includes('Reference image: image · image: pose-reference.png'), 'Comfy reusable text should include image file-name evidence only')
ok(comfyCompatibilityText.includes('Queue mutations: false'), 'Comfy reusable text should preserve the no-queue-mutation boundary')
ok(!comfyCompatibilityText.includes('data:image'), 'Comfy reusable text must not copy image data URLs into the brief')
const cardAwareReadinessGate = buildGenerationBriefReadinessGate(readyDraft, {
  naiReuseCards,
  comfyCompatibilityCards,
})
equal(cardAwareReadinessGate.status, 'review-needed', 'readiness gate should require review when local evidence cards carry warnings')
equal(cardAwareReadinessGate.warningCount, 1, 'readiness gate should count the warning review item')
ok(cardAwareReadinessGate.items.some((item) => item.kind === 'warning-review' && item.evidence.some((entry) => entry.includes('Warning cards: 1'))), 'readiness gate should summarize local warning cards')
const cardAwareReviewCopy = buildGenerationBriefReviewCopy(readyDraft, { naiReuseCards, comfyCompatibilityCards })
ok(cardAwareReviewCopy.includes('Readiness gate: review-needed'), 'review copy should reflect card-aware readiness warnings')

const iterationSnapshot = buildGenerationBriefIterationHandoffSnapshotFromHistoryRecord({
  id: 42,
  service_type: 'novelai',
  generation_status: 'completed',
  queue_status: 'completed',
  actual_composite_hash: 'abc123hash',
  result_file_status: 'active',
  actual_width: 1024,
  actual_height: 1536,
  nai_model: 'nai-diffusion-4-5-curated',
  nai_sampler: 'k_euler',
  nai_seed: 123456,
  nai_steps: 28,
  nai_scale: 5,
  positive_prompt: 'masterpiece portrait with rim light',
  negative_prompt: 'low quality, blurry',
  created_at: '2026-06-12T01:00:00.000Z',
})
equal(iterationSnapshot.source, 'generation-history', 'iteration packet should identify generation history as the source')
equal(iterationSnapshot.sourceId, 'history:42', 'iteration packet should preserve a stable source id')
equal(iterationSnapshot.target, 'novelai', 'history packet should map service type to a brief target')
equal(iterationSnapshot.externalActionsExecuted, false, 'iteration packet must not claim provider calls or queue operations')
equal(iterationSnapshot.queueMutations, false, 'iteration packet must not mutate queues')
equal(iterationSnapshot.fileMutations, false, 'iteration packet must not mutate files')
const iterationCards = buildGenerationBriefIterationHandoffCards(iterationSnapshot)
equal(iterationCards.length, 4, 'iteration packet should expose source, evidence, next action, and boundary cards')
ok(iterationCards.some((card) => card.kind === 'source-artifact' && card.evidence.some((item) => item.includes('abc123hash'))), 'iteration packet should include source artifact evidence')
ok(iterationCards.some((card) => card.kind === 'generation-evidence' && card.evidence.some((item) => item.includes('masterpiece portrait'))), 'iteration packet should include prompt evidence')
const iterationText = buildGenerationBriefIterationHandoffText(iterationSnapshot)
ok(iterationText.includes('Artifact iteration handoff packet'), 'iteration handoff text should have a clear packet heading')
ok(iterationText.includes('History record: #42'), 'iteration handoff text should include the selected history record id')
ok(iterationText.includes('NAI Diffusion 4.5 Curated'), 'iteration handoff text should include readable model evidence')
ok(iterationText.includes('Queue mutations: false'), 'iteration handoff text should preserve the no-queue-mutation boundary')
ok(iterationText.includes('File mutations: false'), 'iteration handoff text should preserve the no-file-mutation boundary')
ok(!iterationText.includes('data:image'), 'iteration handoff text must not copy image data URLs into the brief')

const exportedAt = '2026-06-12T01:02:03.000Z'
const serializedPayload = serializeGenerationBriefHandoffPayload(readyDraft, exportedAt)
const rawPayload = JSON.parse(serializedPayload) as Record<string, unknown>
equal(rawPayload.schema, GENERATION_BRIEF_HANDOFF_SCHEMA, 'handoff JSON should carry the expected schema')
equal(rawPayload.localOnly, true, 'handoff JSON should stay local-only')
equal(rawPayload.externalActionsExecuted, false, 'handoff JSON should not claim external actions')
equal(rawPayload.sideEffectBoundary, 'local-draft-only', 'handoff JSON should preserve local-only boundary')
ok(typeof rawPayload.readinessGate === 'object' && rawPayload.readinessGate !== null, 'handoff JSON should include readiness gate evidence')
equal((rawPayload.readinessGate as { status?: unknown }).status, 'ready', 'handoff readiness gate should preserve the local readiness status')
equal(buildGenerationBriefHandoffFilename(exportedAt), 'conai-generation-brief-2026-06-12-01-02-03.json', 'handoff filename should be timestamped and safe')

const importedPayload = parseGenerationBriefHandoffPayload(serializedPayload)
equal(importedPayload.status, 'imported', 'valid handoff JSON should import')
if (importedPayload.status === 'imported') {
  deepEqual(importedPayload.draft, readyDraft, 'valid handoff JSON should round-trip the normalized draft')
  equal(importedPayload.summary.status, 'review-ready', 'import should rebuild review summary locally')
  const importedReadinessGate = buildGenerationBriefReadinessGate(importedPayload.draft)
  equal(importedReadinessGate.status, 'ready', 'import preview should rebuild readiness status locally before restore')
  equal(importedReadinessGate.sideEffectBoundary, 'local-draft-only', 'import preview should preserve the local-only boundary')
}

const importDiff = buildGenerationBriefImportDiff({ ...DEFAULT_GENERATION_BRIEF_DRAFT, reviewNotes: 'keep this local note' }, readyDraft)
equal(importDiff.changedCount, 5, 'import diff should count every field that would be overwritten')
equal(importDiff.filledCount, 4, 'import diff should distinguish fields filled from empty current values')
equal(importDiff.clearedCount, 0, 'import diff should not report clears for a fully populated incoming draft')
equal(importDiff.fields.find((field) => field.field === 'reviewNotes')?.status, 'changed', 'import diff should flag useful current notes that would change')
equal(importDiff.sideEffectBoundary, 'local-draft-only', 'import diff should keep the local-only boundary')

const clearingImportDiff = buildGenerationBriefImportDiff(readyDraft, { ...readyDraft, reusableAssets: '', reviewNotes: '' })
equal(clearingImportDiff.clearedCount, 2, 'import diff should flag current populated fields that the import would clear')
equal(clearingImportDiff.fields.find((field) => field.field === 'reusableAssets')?.status, 'cleared', 'import diff should mark reusable asset replacement as a clear')
equal(
  countGenerationBriefSelectedImportChanges(importDiff, ['intent', 'target', 'sourceReferences', 'reusableAssets', 'reviewNotes']),
  5,
  'selected import change count should count every selected field that would alter the draft',
)
equal(countGenerationBriefSelectedImportChanges(importDiff, []), 0, 'selected import change count should be zero when no field is selected')
const singleChangedImportDiff = buildGenerationBriefImportDiff({ ...readyDraft, reviewNotes: 'keep local note' }, { ...readyDraft, reviewNotes: 'incoming review note' })
equal(countGenerationBriefSelectedImportChanges(singleChangedImportDiff, ['intent']), 0, 'selected import change count should ignore selected unchanged fields')
equal(countGenerationBriefSelectedImportChanges(singleChangedImportDiff, ['reviewNotes']), 1, 'selected import change count should count selected changed fields')

const selectiveImportDraft = buildGenerationBriefSelectiveImportDraft(
  { ...readyDraft, intent: 'keep local intent', reviewNotes: 'keep local review note' },
  { ...readyDraft, intent: 'incoming intent', reusableAssets: '', reviewNotes: 'incoming review note' },
  ['intent', 'reusableAssets'],
)
deepEqual(
  selectiveImportDraft,
  {
    ...readyDraft,
    intent: 'incoming intent',
    reusableAssets: '',
    reviewNotes: 'keep local review note',
  },
  'selective import restore should apply only selected incoming fields and preserve unselected current draft fields',
)

const noFieldImportDraft = buildGenerationBriefSelectiveImportDraft(readyDraft, { ...readyDraft, intent: 'ignored incoming intent' }, [])
deepEqual(noFieldImportDraft, readyDraft, 'selective import restore should keep the current draft when no fields are selected')

equal(parseGenerationBriefHandoffPayload('').status, 'rejected', 'empty imports should be rejected')
equal(parseGenerationBriefHandoffPayload('{not-json').status, 'rejected', 'invalid JSON imports should be rejected')
equal(parseGenerationBriefHandoffPayload(JSON.stringify({ schema: 'other', draft: readyDraft })).status, 'rejected', 'unknown handoff schemas should be rejected')
equal(parseGenerationBriefHandoffPayload(JSON.stringify({ ...rawPayload, externalActionsExecuted: true })).status, 'rejected', 'unsafe external-action handoffs should be rejected')

const storage = new MemoryStorage()
const builtSaveMetadata = buildGenerationBriefSaveMetadata(readyDraft, '2026-06-12T03:00:00.000Z')
equal(builtSaveMetadata.savedAt, '2026-06-12T03:00:00.000Z', 'save metadata should preserve a stable saved-at timestamp')
equal(builtSaveMetadata.summary.status, 'review-ready', 'save metadata should carry the draft review status')
equal(builtSaveMetadata.filledFieldCount, 5, 'save metadata should carry compact filled-field evidence')
equal(builtSaveMetadata.localOnly, true, 'save metadata should be explicitly browser-local')
equal(builtSaveMetadata.externalActionsExecuted, false, 'save metadata must not claim provider calls or queue operations')
equal(builtSaveMetadata.queueMutations, false, 'save metadata must not mutate queues')
equal(builtSaveMetadata.fileMutations, false, 'save metadata must not mutate files')
equal(builtSaveMetadata.sideEffectBoundary, 'local-draft-only', 'save metadata should preserve the local draft boundary')
saveGenerationBriefDraft(readyDraft, storage, '2026-06-12T03:01:00.000Z')
deepEqual(readGenerationBriefDraft(storage), readyDraft, 'brief drafts should round-trip through local storage')
equal(storage.getItem(GENERATION_BRIEF_STORAGE_KEY)?.includes('portrait lighting plan'), true, 'stored brief should preserve local intent text')
const storedSaveMetadata = readGenerationBriefSaveMetadata(storage)
equal(storedSaveMetadata?.savedAt, '2026-06-12T03:01:00.000Z', 'saving a draft should persist local save metadata')
equal(storedSaveMetadata?.summary.status, 'review-ready', 'stored save metadata should summarize the saved draft')
equal(storedSaveMetadata?.filledFieldCount, 5, 'stored save metadata should preserve filled-field evidence')
equal(storedSaveMetadata?.externalActionsExecuted, false, 'stored save metadata should preserve no-external-action evidence')
equal(storage.getItem(GENERATION_BRIEF_SAVE_METADATA_STORAGE_KEY)?.includes('2026-06-12T03:01:00.000Z'), true, 'save metadata storage should contain the saved timestamp')
storage.setItem(GENERATION_BRIEF_SAVE_METADATA_STORAGE_KEY, JSON.stringify({ ...storedSaveMetadata, externalActionsExecuted: true }))
equal(readGenerationBriefSaveMetadata(storage), null, 'unsafe save metadata should fail closed')
storage.setItem(GENERATION_BRIEF_SAVE_METADATA_STORAGE_KEY, '{not-json')
equal(readGenerationBriefSaveMetadata(storage), null, 'corrupt save metadata should fail closed')
saveGenerationBriefDraft(readyDraft, storage, '2026-06-12T03:02:00.000Z')
deepEqual(clearGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'clear should return the default brief')
deepEqual(readGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'clear should remove persisted brief data')
equal(readGenerationBriefSaveMetadata(storage), null, 'clearing the draft should remove stale local save metadata')
const builtHistorySnapshot = buildGenerationBriefHistorySnapshot(readyDraft, 'manual-save', '2026-06-12T04:00:00.000Z')
equal(builtHistorySnapshot.reason, 'manual-save', 'history snapshot should preserve the manual save reason')
equal(builtHistorySnapshot.savedAt, '2026-06-12T04:00:00.000Z', 'history snapshot should preserve saved-at evidence')
deepEqual(builtHistorySnapshot.draft, readyDraft, 'history snapshot should preserve the normalized draft')
equal(builtHistorySnapshot.filledFieldCount, 5, 'history snapshot should carry compact filled-field evidence')
equal(builtHistorySnapshot.externalActionsExecuted, false, 'history snapshot must not claim provider calls or queue operations')
equal(builtHistorySnapshot.queueMutations, false, 'history snapshot must not mutate queues')
equal(builtHistorySnapshot.fileMutations, false, 'history snapshot must not mutate files')
equal(builtHistorySnapshot.sideEffectBoundary, 'local-draft-only', 'history snapshot should preserve the local draft boundary')
saveGenerationBriefHistorySnapshot(readyDraft, 'manual-save', storage, '2026-06-12T04:01:00.000Z')
let historySnapshots = readGenerationBriefHistorySnapshots(storage)
equal(historySnapshots.length, 1, 'manual save should persist one local history snapshot')
equal(historySnapshots[0]?.savedAt, '2026-06-12T04:01:00.000Z', 'stored history should expose saved-at evidence')
deepEqual(historySnapshots[0]?.draft, readyDraft, 'stored history should round-trip the manual snapshot draft')
equal(storage.getItem(GENERATION_BRIEF_HISTORY_STORAGE_KEY)?.includes('manual-save'), true, 'history storage should contain the manual save reason')
for (let index = 0; index < 6; index += 1) {
  saveGenerationBriefHistorySnapshot(
    { ...readyDraft, reviewNotes: `history note ${index}` },
    'manual-save',
    storage,
    `2026-06-12T04:0${index}:30.000Z`,
  )
}
historySnapshots = readGenerationBriefHistorySnapshots(storage)
equal(historySnapshots.length, 5, 'history snapshots should stay bounded to the five most recent manual saves')
equal(historySnapshots[0]?.draft.reviewNotes, 'history note 5', 'history snapshots should read newest manual save first')
equal(historySnapshots.every((snapshot) => snapshot.localOnly && !snapshot.externalActionsExecuted && !snapshot.queueMutations && !snapshot.fileMutations), true, 'history snapshots should preserve local-only side-effect evidence')
const allHistoryQueryResult = buildGenerationBriefHistoryQueryResult(historySnapshots, '')
equal(allHistoryQueryResult.totalCount, 5, 'blank history queries should inspect the parsed local history list')
equal(allHistoryQueryResult.matchedCount, 5, 'blank history queries should return every safe local history snapshot')
equal(allHistoryQueryResult.externalActionsExecuted, false, 'history discovery must not claim provider calls or queue operations')
equal(allHistoryQueryResult.queueMutations, false, 'history discovery must not mutate queues')
equal(allHistoryQueryResult.fileMutations, false, 'history discovery must not mutate files')
const noteHistoryQueryResult = buildGenerationBriefHistoryQueryResult(historySnapshots, 'history note 5 04:05:30')
equal(noteHistoryQueryResult.matchedCount, 1, 'history discovery should match local draft text and saved-at evidence together')
equal(noteHistoryQueryResult.snapshots[0]?.draft.reviewNotes, 'history note 5', 'history discovery should return the matching local snapshot')
equal(buildGenerationBriefHistoryQueryResult(historySnapshots, 'novelai review-ready').matchedCount, 5, 'history discovery should match target and status terms')
equal(buildGenerationBriefHistoryQueryResult(historySnapshots, 'missing-local-history-query').matchedCount, 0, 'history discovery should expose no-match results without mutating history')
const restoreComparison = buildGenerationBriefHistoryRestoreComparison(
  { ...readyDraft, intent: 'local intent', sourceReferences: '', reviewNotes: 'history note 5' },
  historySnapshots[0]!,
)
equal(restoreComparison.snapshotId, historySnapshots[0]?.id, 'history restore comparison should preserve the target snapshot id')
equal(restoreComparison.fieldCount, 5, 'history restore comparison should cover every brief field')
equal(restoreComparison.changedCount, 2, 'history restore comparison should count changed and filled fields')
equal(restoreComparison.filledCount, 1, 'history restore comparison should distinguish fields filled by the snapshot')
equal(restoreComparison.clearedCount, 0, 'history restore comparison should not invent clears when the snapshot has values')
equal(restoreComparison.wouldChange, true, 'history restore comparison should flag snapshots that would alter the current draft')
equal(restoreComparison.externalActionsExecuted, false, 'history restore comparison must not claim provider calls or queue operations')
equal(restoreComparison.queueMutations, false, 'history restore comparison must not mutate queues')
equal(restoreComparison.fileMutations, false, 'history restore comparison must not mutate files')
equal(restoreComparison.fields.find((field) => field.field === 'sourceReferences')?.status, 'filled', 'history restore comparison should mark empty current fields filled from snapshots')
equal(restoreComparison.fields.find((field) => field.field === 'intent')?.snapshotPreview, 'portrait lighting plan', 'history restore comparison should expose snapshot previews')
const clearingHistoryComparison = buildGenerationBriefHistoryRestoreComparison(
  readyDraft,
  buildGenerationBriefHistorySnapshot({ ...readyDraft, sourceReferences: '' }, 'manual-save', '2026-06-12T04:10:00.000Z'),
)
equal(clearingHistoryComparison.clearedCount, 1, 'history restore comparison should flag current fields that the snapshot would clear')
equal(buildGenerationBriefHistoryRestoreComparison(historySnapshots[0]!.draft, historySnapshots[0]!).wouldChange, false, 'history restore comparison should expose no-op restores')
const snapshotComparisonBase = buildGenerationBriefHistorySnapshot(
  { ...readyDraft, sourceReferences: '', reusableAssets: 'baseline Vibe card', reviewNotes: 'shared review note' },
  'manual-save',
  '2026-06-12T04:11:00.000Z',
)
const snapshotComparisonCandidate = buildGenerationBriefHistorySnapshot(
  { ...readyDraft, sourceReferences: 'new source reference', reusableAssets: '', reviewNotes: 'shared review note' },
  'manual-save',
  '2026-06-12T04:12:00.000Z',
)
const snapshotComparison = buildGenerationBriefHistorySnapshotComparison(snapshotComparisonBase, snapshotComparisonCandidate)
equal(snapshotComparison.baseSnapshotId, snapshotComparisonBase.id, 'snapshot comparison should preserve the selected baseline snapshot id')
equal(snapshotComparison.snapshotId, snapshotComparisonCandidate.id, 'snapshot comparison should preserve the compared snapshot id')
equal(snapshotComparison.fieldCount, 5, 'snapshot comparison should cover every brief field')
equal(snapshotComparison.changedCount, 2, 'snapshot comparison should count fields changed against the baseline')
equal(snapshotComparison.filledCount, 1, 'snapshot comparison should distinguish fields filled from the baseline')
equal(snapshotComparison.clearedCount, 1, 'snapshot comparison should distinguish fields cleared from the baseline')
equal(snapshotComparison.wouldChange, true, 'snapshot comparison should flag snapshots that differ from the baseline')
equal(snapshotComparison.externalActionsExecuted, false, 'snapshot comparison must not claim provider calls or queue operations')
equal(snapshotComparison.queueMutations, false, 'snapshot comparison must not mutate queues')
equal(snapshotComparison.fileMutations, false, 'snapshot comparison must not mutate files')
equal(snapshotComparison.fields.find((field) => field.field === 'sourceReferences')?.status, 'filled', 'snapshot comparison should mark baseline-empty fields filled by the compared snapshot')
equal(snapshotComparison.fields.find((field) => field.field === 'reusableAssets')?.status, 'cleared', 'snapshot comparison should mark baseline assets cleared by the compared snapshot')
equal(snapshotComparison.fields.find((field) => field.field === 'sourceReferences')?.basePreview, 'empty', 'snapshot comparison should expose baseline previews')
equal(snapshotComparison.fields.find((field) => field.field === 'sourceReferences')?.snapshotPreview, 'new source reference', 'snapshot comparison should expose compared snapshot previews')
equal(buildGenerationBriefHistorySnapshotComparison(snapshotComparisonBase, snapshotComparisonBase).wouldChange, false, 'snapshot comparison should expose no-op baseline comparisons')
const evolutionOldestSnapshot = buildGenerationBriefHistorySnapshot(
  { ...readyDraft, target: 'novelai', sourceReferences: 'reference A', reusableAssets: 'vibe A', reviewNotes: 'review A' },
  'manual-save',
  '2026-06-12T04:20:00.000Z',
)
const evolutionMiddleSnapshot = buildGenerationBriefHistorySnapshot(
  { ...readyDraft, target: 'comfyui', sourceReferences: 'reference A', reusableAssets: 'workflow B', reviewNotes: 'review A' },
  'manual-save',
  '2026-06-12T04:21:00.000Z',
)
const evolutionNewestSnapshot = buildGenerationBriefHistorySnapshot(
  { ...readyDraft, intent: 'portrait closeup lighting plan', target: 'comfyui', sourceReferences: 'reference C', reusableAssets: 'workflow B', reviewNotes: 'review C' },
  'manual-save',
  '2026-06-12T04:22:00.000Z',
)
const evolutionSummary = buildGenerationBriefHistoryEvolutionSummary([
  evolutionNewestSnapshot,
  evolutionOldestSnapshot,
  evolutionMiddleSnapshot,
])
equal(evolutionSummary.snapshotCount, 3, 'history evolution should normalize and count parsed local history snapshots')
equal(evolutionSummary.transitionCount, 2, 'history evolution should compare chronological snapshot transitions')
equal(evolutionSummary.totalChangedFieldCount, 5, 'history evolution should sum field changes across transitions')
equal(evolutionSummary.changedFieldCount, 5, 'history evolution should count every field that changed during the local timeline')
equal(evolutionSummary.targetChangeCount, 1, 'history evolution should expose target flow changes')
ok(evolutionSummary.transitions[0]?.labels.some((label) => label.kind === 'target-pivot'), 'history evolution labels should mark target-flow pivots')
ok(evolutionSummary.transitions[0]?.labels.some((label) => label.kind === 'asset-change'), 'history evolution labels should mark reusable asset revisions')
ok(evolutionSummary.transitions[1]?.labels.some((label) => label.kind === 'intent-change'), 'history evolution labels should mark intent revisions')
ok(evolutionSummary.transitions[1]?.labels.some((label) => label.kind === 'source-reference-change'), 'history evolution labels should mark source-reference revisions')
ok(evolutionSummary.transitions[1]?.labels.some((label) => label.kind === 'review-note-change'), 'history evolution labels should mark review-note revisions')
ok(evolutionSummary.transitions[1]?.labels.some((label) => label.kind === 'multi-field-revision'), 'history evolution labels should mark broad multi-field revisions')
ok(evolutionSummary.transitions.every((transition) => transition.labels.every((label) => label.summary.length > 0)), 'history evolution labels should include operator-readable summaries')
const historyDiscoveryLabels = buildGenerationBriefHistoryDiscoveryLabels([
  evolutionNewestSnapshot,
  evolutionOldestSnapshot,
  evolutionMiddleSnapshot,
])
ok(historyDiscoveryLabels.some((label) => label.snapshotId === evolutionMiddleSnapshot.id && label.kind === 'target-pivot'), 'history discovery labels should attach target pivots to the reached snapshot')
const targetPivotHistoryQueryResult = buildGenerationBriefHistoryQueryResult([
  evolutionNewestSnapshot,
  evolutionOldestSnapshot,
  evolutionMiddleSnapshot,
], 'target-pivot')
equal(targetPivotHistoryQueryResult.matchedCount, 1, 'label-aware history discovery should find snapshots by transition label kind')
equal(targetPivotHistoryQueryResult.snapshots[0]?.id, evolutionMiddleSnapshot.id, 'transition label queries should return the snapshot reached by that transition')
ok(targetPivotHistoryQueryResult.discoveryLabels.some((label) => label.kind === 'target-pivot'), 'label-aware history discovery should return matched discovery cues')
equal(targetPivotHistoryQueryResult.matchedLabelCount, targetPivotHistoryQueryResult.discoveryLabels.length, 'history discovery should expose matched label counts')
equal(buildGenerationBriefHistoryQueryResult([
  evolutionNewestSnapshot,
  evolutionOldestSnapshot,
  evolutionMiddleSnapshot,
], 'multi-field revision').snapshots[0]?.id, evolutionNewestSnapshot.id, 'history discovery should find operator-readable transition labels with multi-word terms')
equal(buildGenerationBriefHistoryQueryResult([
  evolutionNewestSnapshot,
  evolutionOldestSnapshot,
  evolutionMiddleSnapshot,
], 'source-reference-change').snapshots[0]?.id, evolutionNewestSnapshot.id, 'history discovery should find decision categories by label kind')
equal(evolutionSummary.earliestSavedAt, evolutionOldestSnapshot.savedAt, 'history evolution should expose earliest saved-at evidence')
equal(evolutionSummary.latestSavedAt, evolutionNewestSnapshot.savedAt, 'history evolution should expose latest saved-at evidence')
equal(evolutionSummary.transitions[0]?.fromSnapshotId, evolutionOldestSnapshot.id, 'history evolution should start from the oldest snapshot')
equal(evolutionSummary.transitions[0]?.toSnapshotId, evolutionMiddleSnapshot.id, 'history evolution should compare oldest to next snapshot')
equal(evolutionSummary.transitions[0]?.changedCount, 2, 'history evolution should count first transition changes')
equal(evolutionSummary.transitions[1]?.changedCount, 3, 'history evolution should count second transition changes')
equal(evolutionSummary.fields.find((field) => field.field === 'target')?.changedCount, 1, 'history evolution should count target field changes')
equal(evolutionSummary.fields.find((field) => field.field === 'sourceReferences')?.changedCount, 1, 'history evolution should count source reference changes')
equal(evolutionSummary.externalActionsExecuted, false, 'history evolution must not claim provider calls or queue operations')
equal(evolutionSummary.queueMutations, false, 'history evolution must not mutate queues')
equal(evolutionSummary.fileMutations, false, 'history evolution must not mutate files')
equal(buildGenerationBriefHistoryEvolutionSummary([evolutionNewestSnapshot]).transitionCount, 0, 'single-snapshot evolution should expose no timeline transitions')
const removedHistorySnapshotId = historySnapshots[0]?.id ?? ''
const prunedHistorySnapshots = deleteGenerationBriefHistorySnapshot(removedHistorySnapshotId, storage)
equal(prunedHistorySnapshots.length, 4, 'deleting a manual history snapshot should remove only the selected snapshot')
equal(prunedHistorySnapshots.some((snapshot) => snapshot.id === removedHistorySnapshotId), false, 'deleted history snapshots should not be returned')
equal(readGenerationBriefHistorySnapshots(storage).length, 4, 'history deletion should persist the pruned snapshot list')
deepEqual(readGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'history deletion should not alter the active local draft')
historySnapshots = deleteGenerationBriefHistorySnapshot('', storage)
equal(historySnapshots.length, 4, 'blank history deletion requests should leave local history unchanged')
const historyBeforeEmptySave = historySnapshots
saveGenerationBriefHistorySnapshot(DEFAULT_GENERATION_BRIEF_DRAFT, 'manual-save', storage, '2026-06-12T05:00:00.000Z')
deepEqual(readGenerationBriefHistorySnapshots(storage), historyBeforeEmptySave, 'empty drafts should not create stale history snapshots')
const clearedHistorySnapshots = clearGenerationBriefHistorySnapshots(storage)
deepEqual(clearedHistorySnapshots, [], 'clearing local history should return an empty snapshot list')
deepEqual(readGenerationBriefHistorySnapshots(storage), [], 'clearing local history should persist an empty snapshot list')
equal(storage.getItem(GENERATION_BRIEF_HISTORY_STORAGE_KEY), null, 'clearing local history should remove the history storage key')
deepEqual(readGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'history clear should not alter the active local draft')
storage.setItem(GENERATION_BRIEF_HISTORY_STORAGE_KEY, JSON.stringify([{ ...historyBeforeEmptySave[0], externalActionsExecuted: true }]))
deepEqual(readGenerationBriefHistorySnapshots(storage), [], 'unsafe history snapshots should fail closed')
storage.setItem(GENERATION_BRIEF_HISTORY_STORAGE_KEY, '{not-json')
deepEqual(readGenerationBriefHistorySnapshots(storage), [], 'corrupt history storage should fail closed')
const recoveryCheckpoint = buildGenerationBriefRecoveryCheckpoint(readyDraft, 'reset', '2026-06-12T02:00:00.000Z')
equal(recoveryCheckpoint.reason, 'reset', 'recovery checkpoint should preserve the replacement reason')
equal(recoveryCheckpoint.summary.status, 'review-ready', 'recovery checkpoint should summarize the preserved draft')
equal(recoveryCheckpoint.queueMutations, false, 'recovery checkpoint must not mutate queues')
equal(recoveryCheckpoint.fileMutations, false, 'recovery checkpoint must not mutate files')
saveGenerationBriefRecoveryCheckpoint(readyDraft, 'import-restore', storage, '2026-06-12T02:03:00.000Z')
equal(storage.getItem(GENERATION_BRIEF_RECOVERY_STORAGE_KEY)?.includes('import-restore'), true, 'recovery checkpoint should persist as a single local slot')
const storedRecoveryCheckpoint = readGenerationBriefRecoveryCheckpoint(storage)
equal(storedRecoveryCheckpoint?.reason, 'import-restore', 'recovery checkpoint should round-trip the import reason')
deepEqual(storedRecoveryCheckpoint?.draft, readyDraft, 'recovery checkpoint should preserve the previous local draft')
equal(clearGenerationBriefRecoveryCheckpoint(storage), null, 'clearing recovery checkpoint should return null')
equal(readGenerationBriefRecoveryCheckpoint(storage), null, 'clearing recovery checkpoint should remove persisted recovery state')
saveGenerationBriefRecoveryCheckpoint(DEFAULT_GENERATION_BRIEF_DRAFT, 'reset', storage, '2026-06-12T02:04:00.000Z')
equal(storage.getItem(GENERATION_BRIEF_RECOVERY_STORAGE_KEY), null, 'empty drafts should not create stale recovery checkpoints')
storage.setItem(GENERATION_BRIEF_RECOVERY_STORAGE_KEY, '{not-json')
equal(readGenerationBriefRecoveryCheckpoint(storage), null, 'corrupt recovery checkpoint storage should fail closed')
storage.setItem(GENERATION_BRIEF_STORAGE_KEY, '{not-json')
deepEqual(readGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'corrupt brief storage should fail closed')

ok(pageSource.includes('GenerationBriefWorkspace'), 'image generation page should mount the generation brief workspace')
ok(componentSource.includes('data-generation-brief-workspace="true"'), 'brief UI should expose the workspace contract surface')
ok(componentSource.includes('data-generation-brief-boundary="local-only"'), 'brief UI should expose its local-only boundary')
ok(componentSource.includes('data-generation-brief-field="intent"'), 'brief UI should expose the intent field')
ok(componentSource.includes('data-generation-brief-field="sourceReferences"'), 'brief UI should expose the source reference field')
ok(componentSource.includes('data-generation-brief-field="reusableAssets"'), 'brief UI should expose the reusable assets field')
ok(componentSource.includes('data-generation-brief-field="reviewNotes"'), 'brief UI should expose the review notes field')
ok(componentSource.includes('data-generation-brief-target-option'), 'brief UI should expose provider/workflow target choices')
ok(componentSource.includes('data-generation-brief-summary="true"'), 'brief UI should expose local review summary')
ok(componentSource.includes('data-generation-brief-save-status="true"'), 'brief UI should expose local save status evidence')
ok(componentSource.includes('readGenerationBriefSaveMetadata'), 'brief UI should read local save metadata')
ok(componentSource.includes('data-generation-brief-saved-at="true"'), 'brief UI should expose saved-at evidence')
ok(componentSource.includes('data-generation-brief-save-boundary="true"'), 'brief UI should expose local save side-effect boundary')
ok(componentSource.includes('로컬 저장 상태와 히스토리 스냅샷을 갱신했어'), 'manual save should give operator feedback')
ok(componentSource.includes('data-generation-brief-history="true"'), 'brief UI should expose local save history')
ok(componentSource.includes('data-generation-brief-history-snapshot'), 'brief UI should expose individual history snapshots')
ok(componentSource.includes('data-generation-brief-history-restore'), 'brief UI should expose history restore actions')
ok(componentSource.includes('data-generation-brief-history-remove'), 'brief UI should expose per-snapshot history remove actions')
ok(componentSource.includes('data-generation-brief-history-clear="true"'), 'brief UI should expose a clear local history action')
ok(componentSource.includes('data-generation-brief-history-filter="true"'), 'brief UI should expose local history filtering')
ok(componentSource.includes('data-generation-brief-history-filter-count="true"'), 'brief UI should expose local history filter match counts')
ok(componentSource.includes('data-generation-brief-history-label-count="true"'), 'brief UI should expose label-aware discovery cue counts')
ok(componentSource.includes('data-generation-brief-history-filter-help="true"'), 'brief UI should explain transition-label history discovery')
ok(componentSource.includes('data-generation-brief-history-filter-empty="true"'), 'brief UI should expose no-match local history discovery state')
ok(componentSource.includes('data-generation-brief-history-restore-comparison'), 'brief UI should expose local history restore comparison surface')
ok(componentSource.includes('data-generation-brief-history-restore-comparison-summary'), 'brief UI should expose history restore comparison counts')
ok(componentSource.includes('data-generation-brief-history-restore-field'), 'brief UI should expose field-level history restore impact')
ok(componentSource.includes('data-generation-brief-history-restore-noop="true"'), 'brief UI should expose no-op restore impact evidence')
ok(componentSource.includes('data-generation-brief-history-comparison-base="true"'), 'brief UI should expose the selected snapshot comparison baseline')
ok(componentSource.includes('data-generation-brief-history-comparison-select'), 'brief UI should expose per-snapshot comparison baseline controls')
ok(componentSource.includes('data-generation-brief-history-comparison-clear="true"'), 'brief UI should expose comparison baseline clearing')
ok(componentSource.includes('data-generation-brief-history-snapshot-comparison'), 'brief UI should expose snapshot-to-snapshot comparison results')
ok(componentSource.includes('data-generation-brief-history-snapshot-comparison-summary'), 'brief UI should expose snapshot comparison counts')
ok(componentSource.includes('data-generation-brief-history-snapshot-comparison-field'), 'brief UI should expose field-level snapshot comparison differences')
ok(componentSource.includes('data-generation-brief-history-snapshot-comparison-base-marker="true"'), 'brief UI should mark the selected comparison baseline snapshot')
ok(componentSource.includes('data-generation-brief-history-snapshot-comparison-noop="true"'), 'brief UI should expose no-op snapshot comparison evidence')
ok(componentSource.includes('data-generation-brief-history-evolution-summary="true"'), 'brief UI should expose local history evolution summary')
ok(componentSource.includes('data-generation-brief-history-evolution-field'), 'brief UI should expose changed field counts across local history evolution')
ok(componentSource.includes('data-generation-brief-history-evolution-transition'), 'brief UI should expose recent chronological history transitions')
ok(componentSource.includes('data-generation-brief-history-evolution-transition-label'), 'brief UI should expose operator-readable history transition labels')
ok(componentSource.includes('data-generation-brief-history-discovery-labels'), 'brief UI should expose per-snapshot label-aware discovery cues')
ok(componentSource.includes('data-generation-brief-history-discovery-label'), 'brief UI should expose individual local history discovery label badges')
ok(componentSource.includes('historyQueryResult.discoveryLabels'), 'brief UI should render label-aware discovery results from the query contract')
ok(componentSource.includes('transition.labels'), 'brief UI should render transition label metadata from the evolution contract')
ok(componentSource.includes('buildGenerationBriefHistoryEvolutionSummary'), 'brief UI should summarize local history evolution through the side-effect-free contract')
ok(componentSource.includes('targetChangeCount'), 'brief UI should expose target flow changes across local history evolution')
ok(componentSource.includes('buildGenerationBriefHistoryRestoreComparison'), 'brief UI should compare local history snapshots against the active draft before restore')
ok(componentSource.includes('buildGenerationBriefHistorySnapshotComparison'), 'brief UI should compare local history snapshots against the selected baseline')
ok(componentSource.includes('filteredHistorySnapshots.map'), 'brief UI should render restore and remove actions from filtered history snapshots')
ok(componentSource.includes('buildGenerationBriefHistoryQueryResult'), 'brief UI should filter local history through the side-effect-free query contract')
ok(componentSource.includes('deleteGenerationBriefHistorySnapshot'), 'brief UI should prune selected history snapshots through the local-only contract')
ok(componentSource.includes('clearGenerationBriefHistorySnapshots'), 'brief UI should clear manual history through the local-only contract')
ok(componentSource.includes('readGenerationBriefHistorySnapshots'), 'brief UI should read local history snapshots')
ok(componentSource.includes('saveGenerationBriefHistorySnapshot'), 'manual save should persist a local history snapshot')
ok(componentSource.includes("saveGenerationBriefRecoveryCheckpoint(draft, 'history-restore')"), 'history restore should preserve the replaced draft as a recovery checkpoint')
ok(componentSource.includes('data-generation-brief-readiness-gate="true"'), 'brief UI should expose local readiness gate surface')
ok(componentSource.includes('data-generation-brief-readiness-gate-summary="true"'), 'brief UI should expose readiness gate counts')
ok(componentSource.includes('data-generation-brief-readiness-gate-item'), 'brief UI should expose individual readiness gate items')
ok(componentSource.includes('buildGenerationBriefReadinessGate'), 'brief UI should derive readiness gates from local evidence only')
ok(componentSource.includes('data-generation-brief-handoff="true"'), 'brief UI should expose the local handoff surface')
ok(componentSource.includes('data-generation-brief-nai-reuse-cards="true"'), 'brief UI should expose NAI reuse card surface')
ok(componentSource.includes('data-generation-brief-nai-reuse-card'), 'brief UI should expose individual NAI reuse cards')
ok(componentSource.includes('data-generation-brief-nai-reuse-apply="true"'), 'brief UI should allow copying NAI reuse evidence into the local brief')
ok(componentSource.includes('data-generation-brief-comfy-compatibility-summary="true"'), 'brief UI should expose Comfy compatibility summary surface')
ok(componentSource.includes('data-generation-brief-comfy-compatibility-card'), 'brief UI should expose individual Comfy compatibility cards')
ok(componentSource.includes('data-generation-brief-comfy-compatibility-apply="true"'), 'brief UI should allow copying Comfy compatibility evidence into the local brief')
ok(componentSource.includes('data-generation-brief-iteration-handoff="true"'), 'brief UI should expose artifact iteration handoff packet surface')
ok(componentSource.includes('data-generation-brief-iteration-handoff-card'), 'brief UI should expose individual iteration handoff cards')
ok(componentSource.includes('data-generation-brief-iteration-handoff-apply="true"'), 'brief UI should allow copying iteration packet evidence into the local brief')
ok(pageSource.includes('naiReuseSnapshot'), 'image generation page should pass NAI reuse context into the brief workspace')
ok(pageSource.includes('comfyCompatibilitySnapshot'), 'image generation page should pass Comfy compatibility context into the brief workspace')
ok(pageSource.includes('iterationHandoffSnapshot'), 'image generation page should pass selected history iteration context into the brief workspace')
ok(readFileSync(join(root, 'src/features/image-generation/components/generation-history-panel.tsx'), 'utf8').includes('onIterationHandoffChange'), 'history panel should publish selected local iteration packets without queueing generation')
ok(readFileSync(join(root, 'src/features/image-generation/components/generation-history-panel.tsx'), 'utf8').includes('data-generation-history-iteration-handoff="true"'), 'history selection bar should expose iteration handoff action')
ok(panelSource.includes('onReuseSnapshotChange'), 'NAI panel should publish its local reuse snapshot without queueing generation')
ok(readFileSync(join(root, 'src/features/image-generation/components/comfy-generation-panel.tsx'), 'utf8').includes('onCompatibilitySnapshotChange'), 'Comfy panel should publish local compatibility snapshots without queueing generation')
ok(componentSource.includes('data-generation-brief-copy-review="true"'), 'brief UI should expose copy-review affordance')
ok(componentSource.includes('data-generation-brief-export-json="true"'), 'brief UI should expose JSON download affordance')
ok(componentSource.includes('data-generation-brief-import-payload="true"'), 'brief UI should expose JSON import input')
ok(componentSource.includes('data-generation-brief-import-preview="true"'), 'brief UI should preview valid imports before restoring the draft')
ok(componentSource.includes('data-generation-brief-import-preview-summary="true"'), 'brief UI should expose import preview readiness counts')
ok(componentSource.includes('data-generation-brief-import-diff="true"'), 'brief UI should expose the import overwrite diff summary')
ok(componentSource.includes('data-generation-brief-import-diff-field'), 'brief UI should expose field-level import overwrite changes')
ok(componentSource.includes('data-generation-brief-import-field-selection="true"'), 'brief UI should expose field-level import restore selection controls')
ok(componentSource.includes('data-generation-brief-import-field-select'), 'brief UI should expose per-field import restore toggles')
ok(componentSource.includes('data-generation-brief-import-selected-change-count="true"'), 'brief UI should expose selected import change evidence')
ok(componentSource.includes('data-generation-brief-import-noop-guard="true"'), 'brief UI should explain no-op import restore guards')
ok(componentSource.includes('countGenerationBriefSelectedImportChanges'), 'brief UI should count selected changed fields before restore')
ok(componentSource.includes('selectedChangedImportFieldCount === 0'), 'brief UI should fail closed when no selected import field changes the draft')
ok(componentSource.includes('disabled={!canApplyImport}'), 'brief UI should disable restore until the pasted handoff is safe and at least one selected field changes')
ok(componentSource.includes('data-generation-brief-recovery-checkpoint="true"'), 'brief UI should expose local recovery checkpoint state')
ok(componentSource.includes('data-generation-brief-recovery-checkpoint-summary="true"'), 'brief UI should summarize the last replaced local draft')
ok(componentSource.includes('data-generation-brief-recovery-restore="true"'), 'brief UI should expose a recovery restore action')
ok(componentSource.includes('saveGenerationBriefRecoveryCheckpoint'), 'brief UI should save a local recovery checkpoint before replacement actions')
ok(componentSource.includes('readGenerationBriefRecoveryCheckpoint'), 'brief UI should read existing local recovery checkpoints')
ok(componentSource.includes('clearGenerationBriefRecoveryCheckpoint'), 'brief UI should clear recovery state after restoring it')
ok(componentSource.includes('selectedImportFieldSet.has(field.field)'), 'brief UI should keep field restore selection state')
ok(componentSource.includes('buildGenerationBriefSelectiveImportDraft'), 'brief UI should merge imports through the selective restore contract')
ok(componentSource.includes('buildGenerationBriefImportDiff'), 'brief UI should compare incoming handoffs against the current local draft')
ok(componentSource.includes('data-generation-brief-import-preview-error="true"'), 'brief UI should show unsafe or invalid import reasons without applying drafts')
ok(contractSource.includes('countGenerationBriefSelectedImportChanges'), 'brief contract should expose selected import change counting')
ok(componentSource.includes('data-generation-brief-import-apply="true"'), 'brief UI should expose import apply action')
ok(componentSource.includes('copyTextToClipboard'), 'brief handoff should support local copy review')
ok(componentSource.includes('triggerBlobDownload'), 'brief handoff should support local browser JSON download')
ok(componentSource.includes('parseGenerationBriefHandoffPayload'), 'brief handoff should parse imports through the safe contract')
ok(contractSource.includes('buildGenerationBriefReadinessGate'), 'brief contract should expose the local readiness gate builder')
ok(contractSource.includes('buildGenerationBriefRecoveryCheckpoint'), 'brief contract should expose local recovery checkpoint construction')
ok(contractSource.includes('GENERATION_BRIEF_RECOVERY_STORAGE_KEY'), 'brief contract should store recovery checkpoints separately from the active draft')
ok(contractSource.includes('GENERATION_BRIEF_HISTORY_STORAGE_KEY'), 'brief contract should store manual history snapshots separately from active draft state')
ok(contractSource.includes('buildGenerationBriefHistorySnapshot'), 'brief contract should expose manual history snapshot construction')
ok(contractSource.includes('buildGenerationBriefHistoryQueryResult'), 'brief contract should expose side-effect-free local history discovery')
ok(contractSource.includes('GenerationBriefHistoryDiscoveryLabel'), 'brief contract should type label-aware local history discovery cues')
ok(contractSource.includes('buildGenerationBriefHistoryDiscoveryLabels'), 'brief contract should expose label-aware history discovery cues')
ok(contractSource.includes('matchedLabelCount'), 'brief contract should report matched label-aware discovery cue counts')
ok(contractSource.includes('buildGenerationBriefHistoryRestoreComparison'), 'brief contract should expose side-effect-free local history restore comparison')
ok(contractSource.includes('GenerationBriefHistoryRestoreComparison'), 'brief contract should type local history restore comparison evidence')
ok(contractSource.includes('buildGenerationBriefHistorySnapshotComparison'), 'brief contract should expose side-effect-free local history snapshot comparison')
ok(contractSource.includes('GenerationBriefHistorySnapshotComparison'), 'brief contract should type local history snapshot comparison evidence')
ok(contractSource.includes('readGenerationBriefHistorySnapshots'), 'brief contract should expose local history snapshot reading')
ok(contractSource.includes('saveGenerationBriefHistorySnapshot'), 'brief contract should expose local history snapshot saving')
ok(contractSource.includes('deleteGenerationBriefHistorySnapshot'), 'brief contract should expose selected local history snapshot deletion')
ok(contractSource.includes('clearGenerationBriefHistorySnapshots'), 'brief contract should expose local history clearing')
ok(contractSource.includes('persistGenerationBriefHistorySnapshots'), 'brief contract should persist pruned history without touching other local draft stores')
ok(contractSource.includes('queueMutations: false'), 'brief contract should preserve no-queue-mutation readiness evidence')
ok(contractSource.includes('fileMutations: false'), 'brief contract should preserve no-file-mutation readiness evidence')
ok(contractSource.includes('externalActionsExecuted: false'), 'brief contract should preserve the no-external-action boundary')
ok(contractSource.includes("sideEffectBoundary: 'local-draft-only'"), 'brief contract should preserve local-only side-effect boundary')
ok(!componentSource.includes('fetch('), 'brief workspace should not call provider or backend endpoints')
ok(!componentSource.includes('buildApiUrl('), 'brief workspace should not build API action URLs')
ok(!componentSource.includes('addToGenerationQueue'), 'brief workspace should not enqueue generation work')

console.log('Generation brief workspace contracts verified.')
