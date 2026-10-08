import { ImageMetadataRecord } from '../../types/image'
import type { ColorDescriptor } from '../../types/similarity'
import { ImageSafetyService } from '../../services/imageSafetyService'
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService'
import { MAX_RGB_DISTANCE } from '../../services/imageSimilarity'
import { MediaImageFeaturesModel } from './MediaImageFeaturesModel'
import {
  bandCandidateCte,
  bandCandidateParams,
  bandProbeRadius,
  type Hash64,
  hammingSql,
  hashParams,
  MAX_BAND_PROBE_RADIUS,
} from './similarityIndexSql'

export type SimilarityCandidateRecord = ImageMetadataRecord & {
  file_id?: number;
  original_file_path?: string;
  file_size?: number;
  mime_type?: string;
  file_status?: string;
}

const BASE_CANDIDATE_COLUMNS = [
  'im.composite_hash',
  'im.perceptual_hash',
  'im.dhash',
  'im.ahash',
  'im.width',
  'im.height',
  'im.thumbnail_path',
  'im.rating_score',
  'im.first_seen_date',
  'im.metadata_updated_date',
  'if.id as file_id',
  'if.original_file_path',
  'if.file_type',
  'if.file_size',
  'if.mime_type',
  'if.file_status',
  'if.folder_id',
]

function getReadySimilarityCondition(alias: string) {
  return MediaPostprocessVisibilityService.buildReadyCondition(alias)
}

/** Select only fields needed for scoring/sorting; hydrate final rows after pruning. */
function buildCandidateSelect(includeColorHistogram: boolean) {
  const columns = includeColorHistogram
    ? [...BASE_CANDIDATE_COLUMNS, 'mf.color_histogram']
    : BASE_CANDIDATE_COLUMNS

  return columns.map((column) => `      ${column}`).join(',\n')
}

/** Build the shared +/-10% width and height filter when metadata is present. */
function getMetadataBounds(targetImage: ImageMetadataRecord) {
  if (!targetImage.width || !targetImage.height) {
    return null
  }

  return {
    widthMin: targetImage.width * 0.9,
    widthMax: targetImage.width * 1.1,
    heightMin: targetImage.height * 0.9,
    heightMax: targetImage.height * 1.1,
  }
}

/** Build the duplicate-search candidate query with the existing metadata filter. */
export function buildDuplicateCandidateQuery(targetImage: ImageMetadataRecord, includeMetadata: boolean) {
  let query = `
    SELECT
${buildCandidateSelect(false)}
    FROM media_metadata im
    LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
    WHERE im.composite_hash != ?
      AND im.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
      AND ${getReadySimilarityCondition('im')}
  `
  const params: any[] = [targetImage.composite_hash]
  const metadataBounds = includeMetadata ? getMetadataBounds(targetImage) : null

  if (metadataBounds) {
    query += ' AND im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?'
    params.push(
      metadataBounds.widthMin,
      metadataBounds.widthMax,
      metadataBounds.heightMin,
      metadataBounds.heightMax,
    )
  }

  return { query, params }
}

/** Build the hybrid similarity candidate query with the existing metadata filter. */
export function buildSimilarCandidateQuery(targetImage: ImageMetadataRecord, useMetadataFilter: boolean, includeColorHistogram: boolean = false) {
  let query = `
    SELECT
${buildCandidateSelect(includeColorHistogram)}
    FROM media_metadata im
    LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
    ${includeColorHistogram ? MediaImageFeaturesModel.join('im') : ''}
    WHERE im.composite_hash != ?
      AND im.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
      AND ${getReadySimilarityCondition('im')}
  `
  const params: any[] = [targetImage.composite_hash]
  const metadataBounds = useMetadataFilter ? getMetadataBounds(targetImage) : null

  if (metadataBounds) {
    query += ' AND im.width BETWEEN ? AND ? AND im.height BETWEEN ? AND ?'
    params.push(
      metadataBounds.widthMin,
      metadataBounds.widthMax,
      metadataBounds.heightMin,
      metadataBounds.heightMax,
    )
  }

  return { query, params }
}

/** Build the color-search candidate query without changing existing joins. */
export function buildColorCandidateQuery(compositeHash: string) {
  return {
    query: `
      SELECT
${buildCandidateSelect(true)}
      FROM media_metadata im
      JOIN media_image_features mf ON mf.media_id = im.media_id
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash != ?
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
        AND ${getReadySimilarityCondition('im')}
    `,
    params: [compositeHash],
  }
}

/** A hash gate: candidates whose hash is present must lie within `threshold` bits of the target hash. */
export type IndexedHashGate = { hash: Hash64; threshold: number }

/** A colour gate: candidates with a descriptor must score at least `minimum` (0-100) against the target descriptor. */
export type IndexedColorGate = { descriptor: ColorDescriptor; minimum: number }

export type IndexedCandidateOptions = {
  targetImage: ImageMetadataRecord
  /** pHash gate. Every candidate must pass it, so it drives the candidate search. */
  perceptual: IndexedHashGate
  dHash?: IndexedHashGate | null
  aHash?: IndexedHashGate | null
  color?: IndexedColorGate | null
  /** 'any' keeps every file row (duplicate search), 'active' joins active files only (similar search). */
  fileJoin: 'any' | 'active'
  includeColorHistogram: boolean
  metadataBounds: boolean
}

/**
 * Rounding slack for SQL colour prefilters. The JS score rounds to two decimals and compares with `>=`, so a raw score
 * this far under the threshold can still pass; the SQL filter keeps it and JS decides.
 */
const COLOR_SCORE_SLACK = 0.01

/**
 * SQL for calculateColorSimilarity's unrounded score (0-100) between descriptor columns on `alias` and the target
 * descriptor in the `@c_*` parameters. Same formula and weights as ImageSimilarityService.calculateColorSimilarity.
 */
function colorScoreSql(alias: string): string {
  const rgbDistance = (prefix: 'avg' | 'dom', param: 'ca' | 'cd') => `min(1.0, sqrt(
        (${alias}.${prefix}_r - @${param}_r) * (${alias}.${prefix}_r - @${param}_r)
      + (${alias}.${prefix}_g - @${param}_g) * (${alias}.${prefix}_g - @${param}_g)
      + (${alias}.${prefix}_b - @${param}_b) * (${alias}.${prefix}_b - @${param}_b)) / @c_max_rgb)`
  return `(100.0 * (1.0 - min(1.0,
      ${rgbDistance('avg', 'ca')} * 0.55
    + ${rgbDistance('dom', 'cd')} * 0.3
    + abs(${alias}.luminance - @c_lum) * 0.25
    + abs(${alias}.saturation - @c_sat) * 0.1)))`
}

function colorParams(gate: IndexedColorGate): Record<string, number> {
  const { descriptor } = gate
  return {
    ca_r: descriptor.averageRgb[0], ca_g: descriptor.averageRgb[1], ca_b: descriptor.averageRgb[2],
    cd_r: descriptor.dominantRgb[0], cd_g: descriptor.dominantRgb[1], cd_b: descriptor.dominantRgb[2],
    c_lum: descriptor.luminance, c_sat: descriptor.saturation,
    c_max_rgb: MAX_RGB_DISTANCE,
    c_min: gate.minimum - COLOR_SCORE_SLACK,
  }
}

/**
 * Candidate query driven by media_similarity_index (migration 042). The pHash gate selects candidates — band probes
 * for thresholds up to 15, a narrow scan of the index table above that — and the dHash/aHash/colour gates filter in
 * SQL. Every SQL filter only drops rows the JS match builders would drop too; rows whose index columns are NULL
 * (missing or unparsable values) are kept for JS. Rows come back in (media_id, file id) order.
 */
export function buildIndexedCandidateQuery(options: IndexedCandidateOptions) {
  const { targetImage, perceptual } = options
  const params: Record<string, unknown> = {
    target_hash: targetImage.composite_hash,
    ...hashParams('tp', perceptual.hash),
    tp_max: perceptual.threshold,
  }
  const radius = bandProbeRadius(perceptual.threshold)
  const useBands = radius <= MAX_BAND_PROBE_RADIUS
  if (useBands) {
    Object.assign(params, bandCandidateParams(perceptual.hash, radius))
  }

  const conditions = [
    's.p_hi IS NOT NULL',
    `${hammingSql('s', 'p', 'tp')} <= @tp_max`,
  ]
  for (const [gate, prefix, param] of [[options.dHash, 'd', 'td'], [options.aHash, 'a', 'ta']] as const) {
    if (!gate) continue
    Object.assign(params, hashParams(param, gate.hash), { [`${param}_max`]: gate.threshold })
    conditions.push(`(s.${prefix}_hi IS NULL OR ${hammingSql('s', prefix, param)} <= @${param}_max)`)
  }
  if (options.color) {
    Object.assign(params, colorParams(options.color))
    conditions.push(`(s.luminance IS NULL OR ${colorScoreSql('s')} >= @c_min)`)
  }

  const metadataBounds = options.metadataBounds ? getMetadataBounds(targetImage) : null
  if (metadataBounds) {
    Object.assign(params, {
      w_min: metadataBounds.widthMin, w_max: metadataBounds.widthMax,
      h_min: metadataBounds.heightMin, h_max: metadataBounds.heightMax,
    })
  }

  const fileJoin = options.fileJoin === 'active'
    ? "LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'"
    : 'LEFT JOIN image_files if ON im.composite_hash = if.composite_hash'

  const query = `
    ${useBands ? `WITH ${bandCandidateCte()}` : ''}
    SELECT
${buildCandidateSelect(options.includeColorHistogram)}
    FROM ${useBands
      ? 'cand JOIN media_similarity_index s ON s.media_id = cand.media_id\n    JOIN media_metadata im ON im.media_id = s.media_id'
      // CROSS JOIN pins the narrow index table as the scanned side; the wide metadata row is read only for matches.
      : 'media_similarity_index s\n    CROSS JOIN media_metadata im ON im.media_id = s.media_id'}
    ${fileJoin}
    ${options.includeColorHistogram ? MediaImageFeaturesModel.join('im') : ''}
    WHERE ${conditions.join('\n      AND ')}
      AND im.composite_hash != @target_hash
      AND im.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
      AND ${getReadySimilarityCondition('im')}
      ${metadataBounds ? 'AND im.width BETWEEN @w_min AND @w_max AND im.height BETWEEN @h_min AND @h_max' : ''}
    ORDER BY s.media_id, if.id
  `

  return { query, params }
}

/**
 * Colour descriptors of every media row whose luminance is within the window, read from the covering colour index
 * only (luminance alone can cost at most 0.25 of the colour distance, so a score >= m needs
 * |dLuminance| <= 4 * (1 - m / 100)). Raw rows: [media_id, avg_r, avg_g, avg_b, dom_r, dom_g, dom_b, luminance, saturation].
 */
export function buildColorDescriptorScanQuery(targetLuminance: number, minimumScore: number) {
  const window = Math.max(0, 4 * (1 - (minimumScore - COLOR_SCORE_SLACK) / 100))
  return {
    query: `
      SELECT media_id, avg_r, avg_g, avg_b, dom_r, dom_g, dom_b, luminance, saturation
      FROM media_similarity_index
      WHERE luminance BETWEEN ? AND ?
    `,
    params: [targetLuminance - window, targetLuminance + window],
  }
}

/** Colour-search candidate rows (same columns and joins as buildColorCandidateQuery) for some media ids. */
export function buildColorCandidateRowsQuery(compositeHash: string, mediaIds: number[]) {
  return {
    query: `
      SELECT
${buildCandidateSelect(true)},
        im.media_id
      FROM media_metadata im
      JOIN media_image_features mf ON mf.media_id = im.media_id
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.media_id IN (${mediaIds.map(() => '?').join(',')})
        AND im.composite_hash != ?
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
        AND ${getReadySimilarityCondition('im')}
      ORDER BY im.media_id, if.id
    `,
    params: [...mediaIds, compositeHash],
  }
}

/**
 * One page of duplicate-group candidates in composite_hash order (the order the greedy grouping walks), after
 * `@after`: pHash halves from the index and the number of active files, so groups can be judged without loading
 * metadata rows.
 */
export function buildDuplicateGroupIndexQuery() {
  return `
    SELECT
      m.media_id,
      m.composite_hash,
      s.p_hi,
      s.p_lo,
      (SELECT COUNT(*) FROM image_files f WHERE f.composite_hash = m.composite_hash AND f.file_status = 'active') AS active_files
    FROM media_metadata m
    JOIN media_similarity_index s ON s.media_id = m.media_id
    WHERE m.composite_hash > @after
      AND m.perceptual_hash IS NOT NULL
      AND s.p_hi IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('m.rating_score')}
      AND ${getReadySimilarityCondition('m')}
      AND EXISTS (
        SELECT 1 FROM image_files f
        WHERE f.composite_hash = m.composite_hash AND f.file_status = 'active'
      )
    ORDER BY m.composite_hash
    LIMIT @limit
  `
}

/** Active file ids of many duplicate-group members at once, in the order the group file query returns them. */
export function buildDuplicateGroupFileIdsQuery(mediaIds: number[]) {
  return {
    query: `
      SELECT im.media_id, if.id as file_id, im.composite_hash
      FROM image_files if
      JOIN media_metadata im ON if.composite_hash = im.composite_hash
      WHERE im.media_id IN (${mediaIds.map(() => '?').join(',')})
        AND if.file_status = 'active'
        AND ${getReadySimilarityCondition('im')}
      ORDER BY if.composite_hash, if.id
    `,
    params: mediaIds,
  }
}

/** Duplicate-group file rows by file id; same columns and conditions as buildDuplicateGroupFilesQuery. */
export function buildDuplicateGroupFilesByIdQuery(fileIds: number[]) {
  return {
    query: `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM image_files if
      JOIN media_metadata im ON if.composite_hash = im.composite_hash
      WHERE if.id IN (${fileIds.map(() => '?').join(',')})
        AND if.file_status = 'active'
        AND ${getReadySimilarityCondition('im')}
    `,
    params: fileIds,
  }
}

/** Build the visible metadata query used before duplicate-group clustering. */
export function buildDuplicateGroupMetadataQuery() {
  return `
    SELECT DISTINCT m.*
    FROM media_metadata m
    INNER JOIN image_files f ON m.composite_hash = f.composite_hash
    WHERE f.file_status = 'active'
      AND m.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('m.rating_score')}
      AND ${getReadySimilarityCondition('m')}
    ORDER BY m.composite_hash
  `
}

/** Count visible metadata rows before duplicate-group clustering. */
export function buildDuplicateGroupMetadataCountQuery() {
  return `
    SELECT COUNT(DISTINCT m.composite_hash) as count
    FROM media_metadata m
    INNER JOIN image_files f ON m.composite_hash = f.composite_hash
    WHERE f.file_status = 'active'
      AND m.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('m.rating_score')}
      AND ${getReadySimilarityCondition('m')}
  `
}

/** Build the active-file lookup query for one duplicate metadata group. */
export function buildDuplicateGroupFilesQuery(compositeHashes: string[]) {
  const placeholders = compositeHashes.map(() => '?').join(',')

  return {
    query: `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM image_files if
      JOIN media_metadata im ON if.composite_hash = im.composite_hash
      WHERE if.composite_hash IN (${placeholders})
        AND if.file_status = 'active'
        AND ${getReadySimilarityCondition('im')}
      ORDER BY if.composite_hash, if.id
    `,
    params: compositeHashes,
  }
}
