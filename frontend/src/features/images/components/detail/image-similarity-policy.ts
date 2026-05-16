import type { GeneralSettings, ImageSimilarityCheckMode } from '../../../../types/settings'

export const DEFAULT_IMAGE_SIMILARITY_CHECK_MODE: ImageSimilarityCheckMode = 'always'

/** Normalize persisted image-similarity policy so missing/unknown values follow the default. */
export function normalizeImageSimilarityCheckMode(mode: GeneralSettings['imageSimilarityCheckMode']): ImageSimilarityCheckMode {
  return mode === 'manual' ? 'manual' : DEFAULT_IMAGE_SIMILARITY_CHECK_MODE
}

/** Decide whether detail views should run expensive similarity checks without a user click. */
export function shouldAutoRunImageSimilarityChecks(generalSettings?: Pick<GeneralSettings, 'imageSimilarityCheckMode'> | null): boolean {
  return normalizeImageSimilarityCheckMode(generalSettings?.imageSimilarityCheckMode) === 'always'
}
