import { ImageMetadataRecord } from '../../types/image'
import { ImageSafetyService } from '../../services/imageSafetyService'

export type SimilarityCandidateRecord = ImageMetadataRecord & {
  file_id?: number;
  original_file_path?: string;
  file_size?: number;
  mime_type?: string;
  file_status?: string;
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
      im.*,
      if.id as file_id,
      if.original_file_path,
      if.file_size,
      if.mime_type,
      if.file_status
    FROM media_metadata im
    LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
    WHERE im.composite_hash != ?
      AND im.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
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
export function buildSimilarCandidateQuery(targetImage: ImageMetadataRecord, useMetadataFilter: boolean) {
  let query = `
    SELECT
      im.*,
      if.id as file_id,
      if.original_file_path,
      if.file_size,
      if.mime_type,
      if.file_status
    FROM media_metadata im
    LEFT JOIN image_files if ON im.composite_hash = if.composite_hash AND if.file_status = 'active'
    WHERE im.composite_hash != ?
      AND im.perceptual_hash IS NOT NULL
      AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
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
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_size,
        if.mime_type,
        if.file_status
      FROM media_metadata im
      LEFT JOIN image_files if ON im.composite_hash = if.composite_hash
      WHERE im.composite_hash != ?
        AND im.color_histogram IS NOT NULL
        AND ${ImageSafetyService.buildVisibleScoreCondition('im.rating_score')}
    `,
    params: [compositeHash],
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
    ORDER BY m.composite_hash
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
      ORDER BY if.composite_hash, if.id
    `,
    params: compositeHashes,
  }
}
