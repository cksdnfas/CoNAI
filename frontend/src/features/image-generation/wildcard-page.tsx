import { WildcardGenerationPanel } from './components/wildcard-generation-panel'

/** /wildcards (also where the old /prompts?tab=wildcards link lands). The panel is the whole page. */
export function WildcardPage() {
  return <WildcardGenerationPanel refreshNonce={0} />
}
