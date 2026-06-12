import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGenerationBriefComfyCompatibilityCards,
  buildGenerationBriefComfyCompatibilityText,
  buildGenerationBriefHandoffFilename,
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
  clearGenerationBriefDraft,
  clearGenerationBriefRecoveryCheckpoint,
  DEFAULT_GENERATION_BRIEF_DRAFT,
  GENERATION_BRIEF_HANDOFF_SCHEMA,
  GENERATION_BRIEF_RECOVERY_STORAGE_KEY,
  GENERATION_BRIEF_STORAGE_KEY,
  normalizeGenerationBriefDraft,
  parseGenerationBriefHandoffPayload,
  readGenerationBriefDraft,
  readGenerationBriefRecoveryCheckpoint,
  saveGenerationBriefDraft,
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
saveGenerationBriefDraft(readyDraft, storage)
deepEqual(readGenerationBriefDraft(storage), readyDraft, 'brief drafts should round-trip through local storage')
equal(storage.getItem(GENERATION_BRIEF_STORAGE_KEY)?.includes('portrait lighting plan'), true, 'stored brief should preserve local intent text')
deepEqual(clearGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'clear should return the default brief')
deepEqual(readGenerationBriefDraft(storage), DEFAULT_GENERATION_BRIEF_DRAFT, 'clear should remove persisted brief data')
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
ok(contractSource.includes('queueMutations: false'), 'brief contract should preserve no-queue-mutation readiness evidence')
ok(contractSource.includes('fileMutations: false'), 'brief contract should preserve no-file-mutation readiness evidence')
ok(contractSource.includes('externalActionsExecuted: false'), 'brief contract should preserve the no-external-action boundary')
ok(contractSource.includes("sideEffectBoundary: 'local-draft-only'"), 'brief contract should preserve local-only side-effect boundary')
ok(!componentSource.includes('fetch('), 'brief workspace should not call provider or backend endpoints')
ok(!componentSource.includes('buildApiUrl('), 'brief workspace should not build API action URLs')
ok(!componentSource.includes('addToGenerationQueue'), 'brief workspace should not enqueue generation work')

console.log('Generation brief workspace contracts verified.')
