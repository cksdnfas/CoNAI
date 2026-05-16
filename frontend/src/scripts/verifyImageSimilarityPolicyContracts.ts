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
  equal(shouldAutoRunImageSimilarityChecks({}), true)
  equal(shouldAutoRunImageSimilarityChecks(null), true)
}

function verifyStaticContracts() {
  const generalTab = source('src/features/settings/components/general-tab.tsx')
  const imageDetailView = source('src/features/images/image-detail-view.tsx')
  const settingsTypes = source('src/types/settings.ts')
  const backendSettingsTypes = source('../backend/src/types/settings.ts')
  const backendDefaults = source('../backend/src/services/settingsServiceStorage.ts')
  const backendSettingsRoutes = source('../backend/src/routes/settings.ts')

  match(settingsTypes, /export type ImageSimilarityCheckMode = 'manual' \| 'always'/, 'frontend settings type should expose manual/always modes')
  match(backendSettingsTypes, /export type ImageSimilarityCheckMode = 'manual' \| 'always'/, 'backend settings type should expose manual/always modes')
  match(backendDefaults, /imageSimilarityCheckMode: 'always'/, 'default settings should auto-run similarity checks')
  match(backendSettingsRoutes, /validImageSimilarityCheckModes[\s\S]*\['manual', 'always'\]/, 'settings route should validate policy modes')
  match(generalTab, /유사\/중복 검사/, 'general settings tab should label the policy in Korean')
  match(generalTab, /Similar\/duplicate check/, 'general settings tab should label the policy in English')
  match(generalTab, /value="manual"/, 'general settings tab should expose manual mode')
  match(generalTab, /value="always"/, 'general settings tab should expose auto mode')
  match(imageDetailView, /shouldAutoRunImageSimilarityChecks\(appSettingsQuery\.data\?\.general\)/, 'detail view should use the centralized policy helper')
  match(imageDetailView, /enabled: canRunSimilarityInspection/, 'runtime similarity settings lookup should be gated by the same run decision')
  match(imageDetailView, /isSimilarityInspectionRequested \? \(/, 'detail view should hide heavy result sections until requested or auto policy allows')
}

verifyPolicyHelper()
verifyStaticContracts()
console.log('Image similarity policy contracts verified')
