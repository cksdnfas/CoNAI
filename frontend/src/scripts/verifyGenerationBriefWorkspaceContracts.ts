import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGenerationBriefComfyCompatibilityCards,
  buildGenerationBriefComfyCompatibilityText,
  buildGenerationBriefHandoffFilename,
  buildGenerationBriefIterationHandoffCards,
  buildGenerationBriefIterationHandoffSnapshotFromHistoryRecord,
  buildGenerationBriefIterationHandoffText,
  buildGenerationBriefNaiReusableAssetsText,
  buildGenerationBriefNaiReuseCards,
  buildGenerationBriefReviewCopy,
  buildGenerationBriefReviewSummary,
  clearGenerationBriefDraft,
  DEFAULT_GENERATION_BRIEF_DRAFT,
  GENERATION_BRIEF_HANDOFF_SCHEMA,
  GENERATION_BRIEF_STORAGE_KEY,
  normalizeGenerationBriefDraft,
  parseGenerationBriefHandoffPayload,
  readGenerationBriefDraft,
  saveGenerationBriefDraft,
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

const reviewCopy = buildGenerationBriefReviewCopy(readyDraft)
ok(reviewCopy.includes('# CoNAI generation brief review'), 'review copy should be a plain text handoff')
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
equal(buildGenerationBriefHandoffFilename(exportedAt), 'conai-generation-brief-2026-06-12-01-02-03.json', 'handoff filename should be timestamped and safe')

const importedPayload = parseGenerationBriefHandoffPayload(serializedPayload)
equal(importedPayload.status, 'imported', 'valid handoff JSON should import')
if (importedPayload.status === 'imported') {
  deepEqual(importedPayload.draft, readyDraft, 'valid handoff JSON should round-trip the normalized draft')
  equal(importedPayload.summary.status, 'review-ready', 'import should rebuild review summary locally')
}

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
ok(componentSource.includes('data-generation-brief-import-apply="true"'), 'brief UI should expose import apply action')
ok(componentSource.includes('copyTextToClipboard'), 'brief handoff should support local copy review')
ok(componentSource.includes('triggerBlobDownload'), 'brief handoff should support local browser JSON download')
ok(componentSource.includes('parseGenerationBriefHandoffPayload'), 'brief handoff should parse imports through the safe contract')
ok(contractSource.includes('externalActionsExecuted: false'), 'brief contract should preserve the no-external-action boundary')
ok(contractSource.includes("sideEffectBoundary: 'local-draft-only'"), 'brief contract should preserve local-only side-effect boundary')
ok(!componentSource.includes('fetch('), 'brief workspace should not call provider or backend endpoints')
ok(!componentSource.includes('buildApiUrl('), 'brief workspace should not build API action URLs')
ok(!componentSource.includes('addToGenerationQueue'), 'brief workspace should not enqueue generation work')

console.log('Generation brief workspace contracts verified.')
