import './support/testTemp'
// The runtime base must point at a scratch folder before anything reads runtimePaths: this import must stay first.
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { enqueueGenerationJobs } from '../src/services/generation-queue/queueEnqueue'
import { preprocessMetadata } from '../src/utils/nai/metadata'
import { assertValidNaiRequest, NaiRequestValidationError } from '../src/utils/nai/requestValidation'

initializeUserSettingsDb()

const valid = { prompt: '1girl, solo', model: 'nai-diffusion-5-full', sampler: 'k_euler_ancestral', noise_schedule: 'karras', uc_preset: 'heavy', width: 832, height: 1216, steps: 28, scale: 5, n_samples: 1 }
const countJobs = () => (getUserSettingsDb().prepare("SELECT COUNT(*) AS n FROM generation_queue_jobs WHERE service_type = 'novelai'").get() as { n: number }).n

test('valid and default-only NovelAI payloads pass, including graph "use default" blanks', () => {
  assert.doesNotThrow(() => assertValidNaiRequest(valid))
  assert.doesNotThrow(() => assertValidNaiRequest({ prompt: 'forest', seed: '', sampler: null, width: undefined }))
})

test('malformed NovelAI payloads are refused with every problem named', () => {
  // The chat payloads NovelAI answered with a bare 500: an unknown sampler, and no prompt at all.
  assert.throws(() => assertValidNaiRequest({ ...valid, sampler: 'k_lms' }), /sampler must be one of/)
  const { prompt: _prompt, ...noPrompt } = valid
  assert.throws(() => assertValidNaiRequest({ ...noPrompt, sampler: 'k_euler_analytic' }), (error: unknown) => (
    error instanceof NaiRequestValidationError && error.statusCode === 400 && error.problems.length === 2
  ))
  assert.throws(() => assertValidNaiRequest({ ...valid, width: 830, steps: 80, uc_preset: 'standard' }), (error: unknown) => (error as NaiRequestValidationError).problems.length === 3)
  assert.throws(() => assertValidNaiRequest({ ...valid, action: 'infill', image: 'data:image/png;base64,AA' }), /requires mask/)
})

test('a malformed NovelAI job is never queued, and a stored one is stopped before sending', () => {
  const before = countJobs()
  assert.throws(() => enqueueGenerationJobs({ service_type: 'novelai', request_payload: { ...valid, sampler: 'k_lms' } }), NaiRequestValidationError)
  assert.equal(countJobs(), before)
  // Jobs queued before validation existed reach preprocessMetadata, the last step before the upstream request.
  assert.throws(() => preprocessMetadata({ ...valid, sampler: 'k_lms' } as never), NaiRequestValidationError)
})
