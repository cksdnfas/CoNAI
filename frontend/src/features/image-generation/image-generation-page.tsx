import { useMemo } from 'react'
import { GitBranch, Sparkles, Tags } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import NAITab from './tabs/nai-tab'
import ComfyUITab from './tabs/comfyui-tab'
import WildcardTab from './tabs/wildcard-tab'

type GenerationTab = 'nai' | 'comfyui' | 'wildcards'

function normalizeTab(tabParam: string | null): GenerationTab {
  if (tabParam === 'comfyui' || tabParam === 'workflows' || tabParam === 'servers') {
    return 'comfyui'
  }
  if (tabParam === 'wildcards') {
    return 'wildcards'
  }
  return 'nai'
}

export function ImageGenerationPage() {
  const { t } = useTranslation(['imageGeneration'])
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = useMemo<GenerationTab>(() => {
    return normalizeTab(searchParams.get('tab'))
  }, [searchParams])

  const handleTabChange = (value: string) => {
    const next = normalizeTab(value)
    setSearchParams({ tab: next })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('imageGeneration:page.title')}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="nai">
            <Sparkles className="h-4 w-4" />
            {t('imageGeneration:tabs.novelai')}
          </TabsTrigger>
          <TabsTrigger value="comfyui">
            <GitBranch className="h-4 w-4" />
            {t('imageGeneration:tabs.comfyui')}
          </TabsTrigger>
          <TabsTrigger value="wildcards">
            <Tags className="h-4 w-4" />
            {t('imageGeneration:tabs.wildcards')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nai">
          <NAITab />
        </TabsContent>
        <TabsContent value="comfyui">
          <ComfyUITab />
        </TabsContent>
        <TabsContent value="wildcards">
          <WildcardTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
