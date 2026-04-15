import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { WildcardGenerationPanel } from './components/wildcard-generation-panel'

export function WildcardPage() {
  const [refreshNonce, setRefreshNonce] = useState(0)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Wildcard"
        actions={(
          <Button type="button" size="icon-sm" variant="outline" onClick={() => setRefreshNonce((current) => current + 1)} aria-label="새로고침" title="새로고침">
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
      />

      <WildcardGenerationPanel refreshNonce={refreshNonce} />
    </div>
  )
}
