import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGenerationBriefHandoffFilename,
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
  type GenerationBriefDraft,
} from '../features/image-generation/generation-brief-workspace'

const root = process.cwd()
const pageSource = readFileSync(join(root, 'src/features/image-generation/image-generation-page.tsx'), 'utf8')
const componentSource = readFileSync(join(root, 'src/features/image-generation/components/generation-brief-workspace.tsx'), 'utf8')
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
