import { PageHeader } from '@/components/common/page-header'
import { useI18n } from '@/i18n'
import { WildcardGenerationPanel } from './components/wildcard-generation-panel'

export function WildcardPage() {
  const { t } = useI18n()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t({ ko: '라이브러리', en: 'Library' })}
        title={t({ ko: '와일드카드', en: 'Wildcard' })}
      />

      <WildcardGenerationPanel refreshNonce={0} />
    </div>
  )
}
