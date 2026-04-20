import { PageHeader } from '@/components/common/page-header'
import { WildcardGenerationPanel } from './components/wildcard-generation-panel'

export function WildcardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Wildcard"
      />

      <WildcardGenerationPanel refreshNonce={0} />
    </div>
  )
}
