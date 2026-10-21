import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TextTabs } from '@/components/common/text-tabs'
import { TabsContent } from '@/components/ui/tabs'
import { GenerationLayoutControls } from '@/features/image-generation/layout/generation-layout-controls'
import { GenerationLayoutProvider } from '@/features/image-generation/layout/generation-layout-context'
import { useI18n } from '@/i18n'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { SpriteAnimationTab } from './sprite-animation-tab'
import { SpriteExtractTab } from './sprite-extract-tab'
import { SpriteNormalizeTab } from './sprite-normalize-tab'

type SpriteTab = 'extract' | 'normalize' | 'animation'

function parseTab(value: string | null): SpriteTab {
  return value === 'normalize' || value === 'animation' ? value : 'extract'
}

/** /sprite — sprite sheets from library videos, sheet normalisation and sheet → animation. `?video=<hash>` preselects. */
export function SpritePage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const videoHash = searchParams.get('video')
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const isWide = useDesktopPageLayout()

  const setTab = (next: string) => setSearchParams((params) => {
    const copy = new URLSearchParams(params)
    if (next === 'extract') copy.delete('tab')
    else copy.set('tab', next)
    return copy
  }, { replace: true })

  const onVideoChange = useCallback((hash: string | null) => {
    setSearchParams((params) => {
      if ((params.get('video') ?? null) === hash) return params
      const copy = new URLSearchParams(params)
      if (hash) copy.set('video', hash)
      else copy.delete('video')
      return copy
    }, { replace: true })
  }, [setSearchParams])

  // All three stay mounted so switching tabs keeps each form and result; each tab has its own layout presets.
  return (
    <GenerationLayoutProvider>
      <TextTabs
        value={tab}
        onChange={setTab}
        ariaLabel={t({ ko: '스프라이트 메뉴', en: 'Sprite sections' })}
        stripClassName="min-h-14 pt-2"
        actions={(
          <div className="flex items-center gap-1">
            <div ref={setToolbarSlot} className={tab === 'extract' ? 'flex items-center gap-1' : 'hidden'} />
            <GenerationLayoutControls wide={isWide} />
          </div>
        )}
        items={[
          { value: 'extract', label: t({ ko: '추출', en: 'Extract' }) },
          { value: 'normalize', label: t({ ko: '정규화', en: 'Normalize' }) },
          { value: 'animation', label: t({ ko: '애니메이션', en: 'Animation' }) },
        ]}
      >
        <TabsContent value="extract" forceMount className="data-[state=inactive]:hidden">
          <SpriteExtractTab active={tab === 'extract'} initialVideoHash={videoHash} onVideoChange={onVideoChange} toolbarSlot={toolbarSlot} />
        </TabsContent>
        <TabsContent value="normalize" forceMount className="data-[state=inactive]:hidden">
          <SpriteNormalizeTab active={tab === 'normalize'} />
        </TabsContent>
        <TabsContent value="animation" forceMount className="data-[state=inactive]:hidden">
          <SpriteAnimationTab active={tab === 'animation'} />
        </TabsContent>
      </TextTabs>
    </GenerationLayoutProvider>
  )
}
