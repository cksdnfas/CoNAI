import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import WildcardPage from '@/features/image-generation/bridges/wildcard-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type WildcardSubTab = 'manual' | 'chain' | 'auto'

function normalizeSubTab(value: string | null): WildcardSubTab {
  if (value === 'chain') {
    return 'chain'
  }
  if (value === 'auto' || value === 'auto-collected') {
    return 'auto'
  }
  return 'manual'
}

export default function WildcardTab() {
  const { t } = useTranslation(['wildcards'])
  const [searchParams, setSearchParams] = useSearchParams()

  const activeSubTab = useMemo<WildcardSubTab>(() => {
    return normalizeSubTab(searchParams.get('wildcardMode'))
  }, [searchParams])

  const handleSubTabChange = (value: string) => {
    const nextMode = normalizeSubTab(value)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('tab', 'wildcards')
    nextParams.set('wildcardMode', nextMode)
    setSearchParams(nextParams)
  }

  return (
    <Tabs value={activeSubTab} onValueChange={handleSubTabChange}>
      <TabsList>
        <TabsTrigger value="manual">{t('wildcards:tabs.manual', { defaultValue: 'Wildcard' })}</TabsTrigger>
        <TabsTrigger value="chain">{t('wildcards:tabs.chain', { defaultValue: 'Preprocessing' })}</TabsTrigger>
        <TabsTrigger value="auto">{t('wildcards:tabs.autoCollected', { defaultValue: 'Auto-Collected (LORA)' })}</TabsTrigger>
      </TabsList>

      <TabsContent value="manual" className="mt-4">
        <WildcardPage mode="manual" />
      </TabsContent>
      <TabsContent value="chain" className="mt-4">
        <WildcardPage mode="chain" />
      </TabsContent>
      <TabsContent value="auto" className="mt-4">
        <WildcardPage mode="auto" />
      </TabsContent>
    </Tabs>
  )
}
