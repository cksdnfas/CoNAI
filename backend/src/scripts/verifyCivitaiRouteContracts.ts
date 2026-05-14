import assert from 'node:assert/strict'
import {
  DEFAULT_CIVITAI_MODEL_LIMIT,
  DEFAULT_CIVITAI_MODEL_OFFSET,
  MAX_CIVITAI_POST_INTENT_IMAGES,
  buildCivitaiRescanProgressResponse,
  collectCivitaiRescanModelReferences,
  getCivitaiPostIntentImageError,
  getCivitaiTempImageContentType,
  parseCivitaiRouteInteger,
  resolveCivitaiModelPagination,
} from '../routes/civitai-route-helpers'

function verifyLegacyIntegerParsing() {
  assert.equal(DEFAULT_CIVITAI_MODEL_LIMIT, 100)
  assert.equal(DEFAULT_CIVITAI_MODEL_OFFSET, 0)
  assert.equal(parseCivitaiRouteInteger(undefined, 100), 100)
  assert.equal(parseCivitaiRouteInteger('', 100), 100)
  assert.equal(parseCivitaiRouteInteger('0', 100), 100)
  assert.equal(parseCivitaiRouteInteger('12px', 100), 12)
  assert.equal(parseCivitaiRouteInteger('-5', 100), -5)
  assert.equal(parseCivitaiRouteInteger(['7', '8'], 100), 7)
  assert.equal(parseCivitaiRouteInteger('0x10', 100), 16)
  assert.deepEqual(resolveCivitaiModelPagination({}), { limit: 100, offset: 0 })
  assert.deepEqual(resolveCivitaiModelPagination({ limit: '0', offset: '0' }), { limit: 100, offset: 0 })
  assert.deepEqual(resolveCivitaiModelPagination({ limit: '25', offset: '40' }), { limit: 25, offset: 40 })
}

function verifyPostIntentImageValidation() {
  assert.equal(MAX_CIVITAI_POST_INTENT_IMAGES, 20)
  assert.equal(getCivitaiPostIntentImageError(undefined), 'compositeHashes array is required')
  assert.equal(getCivitaiPostIntentImageError(null), 'compositeHashes array is required')
  assert.equal(getCivitaiPostIntentImageError([]), 'compositeHashes array is required')
  assert.equal(getCivitaiPostIntentImageError('abc'), 'compositeHashes array is required')
  assert.equal(getCivitaiPostIntentImageError(Array.from({ length: 20 }, (_, index) => `hash-${index}`)), null)
  assert.equal(
    getCivitaiPostIntentImageError(Array.from({ length: 21 }, (_, index) => `hash-${index}`)),
    'Maximum 20 images allowed per post',
  )
}

function verifyTempImageContentTypes() {
  assert.equal(getCivitaiTempImageContentType('sample.PNG'), 'image/png')
  assert.equal(getCivitaiTempImageContentType('sample.jpg'), 'image/jpeg')
  assert.equal(getCivitaiTempImageContentType('sample.jpeg'), 'image/jpeg')
  assert.equal(getCivitaiTempImageContentType('sample.webp'), 'image/webp')
  assert.equal(getCivitaiTempImageContentType('sample.gif'), 'image/gif')
  assert.equal(getCivitaiTempImageContentType('sample.bmp'), 'application/octet-stream')
  assert.equal(getCivitaiTempImageContentType('sample'), 'application/octet-stream')
}

function verifyRescanProgressResponse() {
  assert.deepEqual(
    buildCivitaiRescanProgressResponse({ isRunning: false, total: 0, processed: 0, added: 0, startedAt: null }),
    { isRunning: false, total: 0, processed: 0, added: 0, startedAt: null, percentage: 0 },
  )
  assert.deepEqual(
    buildCivitaiRescanProgressResponse({ isRunning: true, total: 10, processed: 3, added: 2, startedAt: '2026-05-14T06:13:00.000Z' }),
    { isRunning: true, total: 10, processed: 3, added: 2, startedAt: '2026-05-14T06:13:00.000Z', percentage: 30 },
  )
  assert.equal(
    buildCivitaiRescanProgressResponse({ isRunning: true, total: 4, processed: 6, added: 6, startedAt: 'now' }).percentage,
    150,
  )
}

function verifyRescanModelReferenceCollection() {
  assert.deepEqual(
    collectCivitaiRescanModelReferences([
      { hash: 'abc123', type: 'lora', weight: 0.75 },
      { hash: '', type: 'vae', weight: 1 },
      { type: 'embedding', weight: 0.5 },
    ]),
    [{ model_hash: 'abc123', model_role: 'lora', weight: 0.75 }],
  )
  assert.deepEqual(collectCivitaiRescanModelReferences('abc'), [])
  assert.throws(() => collectCivitaiRescanModelReferences({ hash: 'abc123', type: 'lora' }))
  assert.throws(() => collectCivitaiRescanModelReferences([null, { hash: 'later' }]))
}

verifyLegacyIntegerParsing()
verifyPostIntentImageValidation()
verifyTempImageContentTypes()
verifyRescanProgressResponse()
verifyRescanModelReferenceCollection()

console.log('✅ Civitai route contracts verified')
