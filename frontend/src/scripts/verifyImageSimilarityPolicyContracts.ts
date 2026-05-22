import { equal, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldAutoRunImageSimilarityChecks } from '../features/images/components/detail/image-similarity-policy'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function verifyPolicyHelper() {
  equal(shouldAutoRunImageSimilarityChecks({ imageSimilarityCheckMode: 'always' }), true)
  equal(shouldAutoRunImageSimilarityChecks({ imageSimilarityCheckMode: 'manual' }), false)
  equal(shouldAutoRunImageSimilarityChecks({}), false)
  equal(shouldAutoRunImageSimilarityChecks(null), false)
}

function verifyStaticContracts() {
  const generalTab = source('src/features/settings/components/general-tab.tsx')
  const imageDetailView = source('src/features/images/image-detail-view.tsx')
  const relatedImageGallerySection = source('src/features/images/components/detail/related-image-gallery-section.tsx')
  const apiImages = source('src/lib/api-images.ts')
  const apiSettings = source('src/lib/api-settings.ts')
  const scoreOverlay = source('src/features/images/components/detail/similarity-score-overlay.tsx')
  const settingsTypes = source('src/types/settings.ts')
  const backendSettingsTypes = source('../backend/src/types/settings.ts')
  const backendDefaults = source('../backend/src/services/settingsServiceStorage.ts')
  const backendSettingsRoutes = source('../backend/src/routes/settings.ts')


  match(settingsTypes, /export type ImageSimilarityCheckMode = 'manual' \| 'always'/, 'frontend settings type should expose manual/always modes')
  match(backendSettingsTypes, /export type ImageSimilarityCheckMode = 'manual' \| 'always'/, 'backend settings type should expose manual/always modes')
  match(backendDefaults, /imageSimilarityCheckMode: 'manual'/, 'default settings should keep expensive checks manual')
  match(backendSettingsRoutes, /validImageSimilarityCheckModes[\s\S]*\['manual', 'always'\]/, 'settings route should validate policy modes')
  match(generalTab, /유사\/중복 검사/, 'general settings tab should label the policy in Korean')
  match(generalTab, /Similar\/duplicate check/, 'general settings tab should label the policy in English')
  match(generalTab, /value="manual"/, 'general settings tab should expose manual mode')
  match(generalTab, /value="always"/, 'general settings tab should expose auto mode')
  match(imageDetailView, /shouldAutoRunImageSimilarityChecks\(appSettingsQuery\.data\?\.general\)/, 'detail view should use the centralized policy helper')
  match(imageDetailView, /SIMILARITY_INSPECTION_STABLE_DELAY_MS\s*=\s*350/, 'detail view should debounce expensive similarity checks during rapid image navigation')
  match(imageDetailView, /stableSimilarityInspectionCompositeHash === compositeHash/, 'detail view should only query similarity for the stable current image')
  match(imageDetailView, /enabled: canRunStabilizedSimilarityInspection/, 'runtime similarity settings lookup should wait for the stable run decision')
  match(imageDetailView, /queryFn: \(\{ signal \}\) => getImageDuplicates\(compositeHash, 5, \{ signal \}\)/, 'duplicate query should consume React Query abort signals')
  match(imageDetailView, /queryFn: \(\{ signal \}\) =>[\s\S]*getSimilarImages\([\s\S]*\{ signal \},\s*\)/, 'similar query should consume React Query abort signals')
  match(imageDetailView, /queryFn: \(\{ signal \}\) => getPromptSimilarImages\(compositeHash, promptSimilarLimit, \{ signal \}\)/, 'prompt similarity query should consume React Query abort signals')
  match(imageDetailView, /isSimilarityInspectionRequested \? \(/, 'detail view should hide heavy result sections until requested or auto policy allows')
  match(relatedImageGallerySection, /const handleActivate = useCallback\(\(_image: ImageRecord, imageId: string, href\?: string\) => \{[\s\S]*?imageViewModal\.openImageView[\s\S]*?navigate\(href\)[\s\S]*?\}, \[activationMode, imageViewModal, itemCompositeHashes, navigate\]\)/, 'related image gallery should keep one stable activation callback for modal and route launches')
  match(relatedImageGallerySection, /const gridStyle = useMemo\([\s\S]*?--related-image-grid-columns-base[\s\S]*?\[resolvedMobileCardColumns, resolvedDesktopCardColumns\]/, 'related image gallery should memoize responsive grid style objects for large result lists')
  match(relatedImageGallerySection, /onActivate=\{handleActivate\}/, 'related image cards should reuse the stable activation callback instead of per-card wrapper functions')
  match(apiImages, /getImageDuplicates\(compositeHash: string, threshold = 5, init\?: RequestInit\)/, 'duplicate API helper should accept request init for cancellation')
  match(apiImages, /getSimilarImages\([\s\S]*init\?: RequestInit[\s\S]*fetchJson[\s\S]*, init\)/, 'similar API helper should forward request init for cancellation')
  match(apiImages, /getPromptSimilarImages\(compositeHash: string, limit\?: number, init\?: RequestInit\)/, 'prompt similarity API helper should accept request init for cancellation')
  match(apiSettings, /getRuntimeSimilaritySettings\(init\?: RequestInit\)/, 'runtime similarity settings API helper should accept request init for cancellation')
  match(scoreOverlay, /\{ ko: '\{similarity\}\s+거리 \{distance\} \(≤\{threshold\}\)\s+비중 \{weight\}'/, 'hash score overlay should use compact distance, threshold, and weight copy')
  match(scoreOverlay, /\{ ko: '\{similarity\} \(≥\{threshold\}\)\s+비중 \{weight\}'/, 'threshold-only score overlay should use compact threshold and weight copy')
  match(scoreOverlay, /en: '\{similarity\}\s+dist \{distance\} \(≤\{threshold\}\)\s+w \{weight\}'/, 'English hash score overlay should keep compact weight copy')
  equal(scoreOverlay.includes('비중 {weight}'), true, 'score overlay should keep weight visible in compact rows')
}

verifyPolicyHelper()
verifyStaticContracts()
console.log('Image similarity policy contracts verified')
