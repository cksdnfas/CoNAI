import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { SpriteAnimationTab } from './sprite-animation-tab'
import { SpriteExtractTab } from './sprite-extract-tab'
import { SpriteNormalizeTab } from './sprite-normalize-tab'
import { TEXT_TAB_LIST_CLASS, TEXT_TAB_TRIGGER_CLASS } from './sprite-ui'

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

  // All three stay mounted so switching tabs keeps each form and result.
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-5">
      <div data-slot="page-toolbar" className="flex min-h-14 items-end gap-3 border-b border-line pt-2">
        <TabsList className={`${TEXT_TAB_LIST_CLASS} w-auto flex-1 border-b-0`} aria-label={t({ ko: '스프라이트 메뉴', en: 'Sprite sections' })}>
          <TabsTrigger value="extract" className={TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '추출', en: 'Extract' })}</TabsTrigger>
          <TabsTrigger value="normalize" className={TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '정규화', en: 'Normalize' })}</TabsTrigger>
          <TabsTrigger value="animation" className={TEXT_TAB_TRIGGER_CLASS}>{t({ ko: '애니메이션', en: 'Animation' })}</TabsTrigger>
        </TabsList>
        <div ref={setToolbarSlot} className={tab === 'extract' ? 'flex items-center gap-1 pb-1.5' : 'hidden'} />
      </div>
      <TabsContent value="extract" forceMount className="data-[state=inactive]:hidden">
        <SpriteExtractTab initialVideoHash={videoHash} onVideoChange={onVideoChange} toolbarSlot={toolbarSlot} />
      </TabsContent>
      <TabsContent value="normalize" forceMount className="data-[state=inactive]:hidden">
        <SpriteNormalizeTab />
      </TabsContent>
      <TabsContent value="animation" forceMount className="data-[state=inactive]:hidden">
        <SpriteAnimationTab />
      </TabsContent>
    </Tabs>
  )
}
