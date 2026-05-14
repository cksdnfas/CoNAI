import assert from 'node:assert/strict'
import type { ImageMetadataRecord } from '../types/image'
import type { SimilarImage } from '../types/similarity'
import { RatingScoreModel } from '../models/RatingScore'
import { ImageSimilarityService } from '../services/imageSimilarity'
import {
  buildColorSimilarMatch,
  buildDuplicateMatch,
  buildSimilarMatch,
  sortColorSimilarResults,
  sortDuplicateResults,
  sortSimilarResults,
  type SimilarityThresholds,
  type SimilarityWeights,
} from '../models/Image/ImageSimilarityMatchBuilder'
import {
  buildColorCandidateQuery,
  buildDuplicateCandidateQuery,
  buildDuplicateGroupFilesQuery,
  buildDuplicateGroupMetadataQuery,
  buildSimilarCandidateQuery,
  type SimilarityCandidateRecord,
} from '../models/Image/ImageSimilarityQueryBuilder'

const ZERO_HASH = '0000000000000000'

function createRecord(overrides: Partial<SimilarityCandidateRecord> = {}): SimilarityCandidateRecord {
  return {
    composite_hash: 'record-hash',
    perceptual_hash: ZERO_HASH,
    dhash: ZERO_HASH,
    ahash: ZERO_HASH,
    color_histogram: null,
    width: 1000,
    height: 500,
    thumbnail_path: null,
    ai_tool: null,
    model_name: null,
    lora_models: null,
    steps: null,
    cfg_scale: null,
    sampler: null,
    seed: null,
    scheduler: null,
    prompt: null,
    negative_prompt: null,
    denoise_strength: null,
    generation_time: null,
    batch_size: null,
    batch_index: null,
    auto_tags: null,
    model_references: null,
    character_prompt_text: null,
    raw_nai_parameters: null,
    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,
    rating_score: null,
    first_seen_date: '2026-05-14T00:00:00.000Z',
    metadata_updated_date: '2026-05-14T00:00:00.000Z',
    ...overrides,
  }
}

function createHistogram(activeBin: number) {
  const histogram = {
    r: new Array(256).fill(0),
    g: new Array(256).fill(0),
    b: new Array(256).fill(0),
  }
  histogram.r[activeBin] = 1
  histogram.g[activeBin] = 1
  histogram.b[activeBin] = 1
  return histogram
}

function createSimilarityResult(
  id: string,
  similarity: number,
  hammingDistance: number,
  image: Record<string, unknown> = {},
): SimilarImage {
  return {
    image: {
      id,
      first_seen_date: '2026-05-14T00:00:00.000Z',
      file_size: 0,
      ...image,
    } as never,
    similarity,
    hammingDistance,
    matchType: 'similar',
  }
}

function assertClose(actual: number, expected: number, epsilon = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  )
}

function verifyDuplicateMatchContracts() {
  const target = createRecord({ composite_hash: 'target-hash' }) as ImageMetadataRecord
  const weights: SimilarityWeights = { perceptualHash: 40, dHash: 35, aHash: 25, color: 0 }
  const thresholds: SimilarityThresholds = { perceptualHash: 5, dHash: 5, aHash: 5, color: 0 }

  const match = buildDuplicateMatch(target, createRecord({
    composite_hash: 'candidate-hash',
    perceptual_hash: '0000000000000003',
    dhash: '000000000000000f',
    ahash: '0000000000000001',
  }), weights, thresholds)

  assert.ok(match)
  assert.equal((match.image as any).composite_hash, 'candidate-hash')
  assertClose(match.similarity, 96.17)
  assertClose(match.hammingDistance, 2.33)
  assert.equal(match.matchType, 'near-duplicate')
  assert.deepEqual({
    pHash: match.componentScores?.perceptualHash,
    dHash: match.componentScores?.dHash,
    aHash: match.componentScores?.aHash,
  }, {
    pHash: {
      available: true,
      used: true,
      weight: 40,
      threshold: 5,
      passed: true,
      distance: 2,
      similarity: 96.88,
    },
    dHash: {
      available: true,
      used: true,
      weight: 35,
      threshold: 5,
      passed: true,
      distance: 4,
      similarity: 93.75,
    },
    aHash: {
      available: true,
      used: true,
      weight: 25,
      threshold: 5,
      passed: true,
      distance: 1,
      similarity: 98.44,
    },
  })

  assert.equal(buildDuplicateMatch(target, createRecord({
    perceptual_hash: '0000000000000001',
    dhash: '000000000000003f',
    ahash: ZERO_HASH,
  }), weights, thresholds), null)

  const zeroWeightedMismatch = buildDuplicateMatch(target, createRecord({
    perceptual_hash: '0000000000000001',
    dhash: 'ffffffffffffffff',
    ahash: ZERO_HASH,
  }), { ...weights, dHash: 0 }, thresholds)
  assert.ok(zeroWeightedMismatch)
  assert.equal(zeroWeightedMismatch.componentScores?.dHash.used, false)
  assert.equal(zeroWeightedMismatch.componentScores?.dHash.passed, false)

  const missingSecondaryHash = buildDuplicateMatch(target, createRecord({
    perceptual_hash: '0000000000000001',
    dhash: null as never,
    ahash: ZERO_HASH,
  }), weights, thresholds)
  assert.ok(missingSecondaryHash)
  assert.equal(missingSecondaryHash.componentScores?.dHash.available, false)
  assert.equal(missingSecondaryHash.componentScores?.dHash.passed, false)
}

function verifyHybridSimilarityContracts() {
  const targetHistogram = createHistogram(0)
  const target = createRecord({
    composite_hash: 'target-hash',
    color_histogram: ImageSimilarityService.serializeHistogram(targetHistogram),
  }) as ImageMetadataRecord
  const weights: SimilarityWeights = { perceptualHash: 50, dHash: 25, aHash: 0, color: 25 }
  const thresholds: SimilarityThresholds = { perceptualHash: 5, dHash: 5, aHash: 0, color: 99 }

  const match = buildSimilarMatch(target, createRecord({
    perceptual_hash: '0000000000000003',
    dhash: '000000000000000f',
    ahash: '0000000000000001',
    color_histogram: ImageSimilarityService.serializeHistogram(targetHistogram),
  }), weights, thresholds, targetHistogram)

  assert.ok(match)
  assertClose(match.similarity, 96.88)
  assert.equal(match.hammingDistance, 3)
  assert.equal(match.matchType, 'near-duplicate')
  assert.equal(match.colorSimilarity, 100)
  assert.equal(match.componentScores?.color.used, true)
  assert.equal(match.componentScores?.color.passed, true)
  assert.equal(match.componentScores?.aHash.used, false)
  assert.equal(match.componentScores?.aHash.passed, false)

  const lowColorMatch = buildSimilarMatch(target, createRecord({
    perceptual_hash: '0000000000000001',
    dhash: ZERO_HASH,
    ahash: ZERO_HASH,
    color_histogram: ImageSimilarityService.serializeHistogram(createHistogram(255)),
  }), weights, thresholds, targetHistogram)
  assert.equal(lowColorMatch, null)

  const fallback = buildSimilarMatch(target, createRecord({
    perceptual_hash: '0000000000000007',
    dhash: 'ffffffffffffffff',
    ahash: 'ffffffffffffffff',
  }), { perceptualHash: 0, dHash: 0, aHash: 0, color: 0 }, {
    perceptualHash: 4,
    dHash: 0,
    aHash: 0,
    color: 0,
  }, null)

  assert.ok(fallback)
  assertClose(fallback.similarity, 95.31)
  assert.equal(fallback.hammingDistance, 3)
  assert.equal(fallback.matchType, 'near-duplicate')
  assert.equal(fallback.componentScores?.perceptualHash.used, false)

  assert.equal(buildSimilarMatch(target, createRecord({
    perceptual_hash: '000000000000001f',
    dhash: ZERO_HASH,
    ahash: ZERO_HASH,
  }), { perceptualHash: 0, dHash: 0, aHash: 0, color: 0 }, {
    perceptualHash: 4,
    dHash: 0,
    aHash: 0,
    color: 0,
  }, null), null)
}

function verifyColorSimilarityContracts() {
  const targetHistogram = createHistogram(0)
  const target = createRecord({ perceptual_hash: ZERO_HASH }) as ImageMetadataRecord

  const match = buildColorSimilarMatch(target, targetHistogram, createRecord({
    perceptual_hash: '0000000000000003',
    color_histogram: ImageSimilarityService.serializeHistogram(targetHistogram),
  }), 99)

  assert.ok(match)
  assert.equal(match.similarity, 100)
  assert.equal(match.colorSimilarity, 100)
  assert.equal(match.hammingDistance, 2)
  assert.equal(match.matchType, 'color-similar')
  assert.equal(buildColorSimilarMatch(target, targetHistogram, createRecord({ color_histogram: null }), 99), null)
  assert.equal(buildColorSimilarMatch(target, targetHistogram, createRecord({
    color_histogram: ImageSimilarityService.serializeHistogram(createHistogram(255)),
  }), 99), null)

  const results = [
    { ...match, colorSimilarity: 75 },
    { ...match, colorSimilarity: 99 },
    { ...match, colorSimilarity: undefined },
  ]
  sortColorSimilarResults(results)
  assert.deepEqual(results.map(result => result.colorSimilarity ?? 0), [99, 75, 0])
}

function verifyResultSortingContracts() {
  const duplicateResults = [
    createSimilarityResult('lower-similarity', 90, 1),
    createSimilarityResult('same-similarity-higher-distance', 95, 4),
    createSimilarityResult('same-similarity-lower-distance', 95, 2),
  ]
  sortDuplicateResults(duplicateResults)
  assert.deepEqual(duplicateResults.map(result => (result.image as any).id), [
    'same-similarity-lower-distance',
    'same-similarity-higher-distance',
    'lower-similarity',
  ])

  const similarityResults = [
    createSimilarityResult('low', 10, 0),
    createSimilarityResult('high', 90, 0),
  ]
  sortSimilarResults(similarityResults, 'similarity', 'ASC')
  assert.deepEqual(similarityResults.map(result => (result.image as any).id), ['low', 'high'])
  sortSimilarResults(similarityResults, 'similarity', 'DESC')
  assert.deepEqual(similarityResults.map(result => (result.image as any).id), ['high', 'low'])

  const dateResults = [
    createSimilarityResult('older', 0, 0, { first_seen_date: '2026-05-13T00:00:00.000Z' }),
    createSimilarityResult('newer', 0, 0, { upload_date: '2026-05-14T00:00:00.000Z', first_seen_date: undefined }),
  ]
  sortSimilarResults(dateResults, 'upload_date', 'DESC')
  assert.deepEqual(dateResults.map(result => (result.image as any).id), ['newer', 'older'])

  const sizeResults = [
    createSimilarityResult('small', 0, 0, { file_size: 128 }),
    createSimilarityResult('large', 0, 0, { file_size: 1024 }),
  ]
  sortSimilarResults(sizeResults, 'file_size', 'DESC')
  assert.deepEqual(sizeResults.map(result => (result.image as any).id), ['large', 'small'])
}

function verifyQueryBuilderContracts() {
  const originalGetAllTiers = RatingScoreModel.getAllTiers
  RatingScoreModel.getAllTiers = () => [{
    id: 1,
    tier_name: 'hidden',
    min_score: 80,
    max_score: 100,
    tier_order: 1,
    color: null,
    feed_visibility: 'hide',
    created_at: '2026-05-14T00:00:00.000Z',
    updated_at: '2026-05-14T00:00:00.000Z',
  }]

  try {
    const target = createRecord({ composite_hash: 'target-hash', width: 1000, height: 500 }) as ImageMetadataRecord
    const duplicate = buildDuplicateCandidateQuery(target, true)
    assert.ok(duplicate.query.includes('LEFT JOIN image_files if ON im.composite_hash = if.composite_hash'))
    assert.ok(duplicate.query.includes('WHERE im.composite_hash != ?'))
    assert.ok(duplicate.query.includes('im.perceptual_hash IS NOT NULL'))
    assert.ok(duplicate.query.includes('(im.rating_score IS NULL OR NOT ((im.rating_score >= 80 AND im.rating_score < 100)))'))
    assert.ok(duplicate.query.includes('im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?'))
    assert.deepEqual(duplicate.params, ['target-hash', 900, 1100, 450, 550])

    const duplicateWithoutMetadata = buildDuplicateCandidateQuery(target, false)
    assert.equal(duplicateWithoutMetadata.query.includes('im.width BETWEEN ? AND ?'), false)
    assert.deepEqual(duplicateWithoutMetadata.params, ['target-hash'])

    const similar = buildSimilarCandidateQuery(target, true)
    assert.ok(similar.query.includes("LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'"))
    assert.ok(similar.query.includes('(im.rating_score IS NULL OR NOT ((im.rating_score >= 80 AND im.rating_score < 100)))'))
    assert.deepEqual(similar.params, ['target-hash', 900, 1100, 450, 550])

    const color = buildColorCandidateQuery('target-hash')
    assert.ok(color.query.includes('im.color_histogram IS NOT NULL'))
    assert.ok(color.query.includes('(im.rating_score IS NULL OR NOT ((im.rating_score >= 80 AND im.rating_score < 100)))'))
    assert.deepEqual(color.params, ['target-hash'])

    const groupMetadata = buildDuplicateGroupMetadataQuery()
    assert.ok(groupMetadata.includes('SELECT DISTINCT m.*'))
    assert.ok(groupMetadata.includes('INNER JOIN image_files f ON m.composite_hash = f.composite_hash'))
    assert.ok(groupMetadata.includes("f.file_status = 'active'"))
    assert.ok(groupMetadata.includes('(m.rating_score IS NULL OR NOT ((m.rating_score >= 80 AND m.rating_score < 100)))'))

    const groupFiles = buildDuplicateGroupFilesQuery(['hash-a', 'hash-b'])
    assert.ok(groupFiles.query.includes('WHERE if.composite_hash IN (?,?)'))
    assert.ok(groupFiles.query.includes("if.file_status = 'active'"))
    assert.deepEqual(groupFiles.params, ['hash-a', 'hash-b'])
  } finally {
    RatingScoreModel.getAllTiers = originalGetAllTiers
  }
}

verifyDuplicateMatchContracts()
verifyHybridSimilarityContracts()
verifyColorSimilarityContracts()
verifyResultSortingContracts()
verifyQueryBuilderContracts()

console.log('Image similarity contracts verified')
