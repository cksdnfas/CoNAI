import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { FeaturePermissionNotice } from '@/features/auth/feature-permission-notice'
import { WildcardGenerationPanel } from './components/wildcard-generation-panel'

/** /wildcards (also where the old /prompts?tab=wildcards link lands). The panel is the whole page. */
export function WildcardPage() {
  const { canViewWildcards } = useFeaturePermissions()
  return canViewWildcards ? <WildcardGenerationPanel refreshNonce={0} /> : <FeaturePermissionNotice permission="wildcards.view" />
}
