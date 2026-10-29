import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
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
    if (videoHash === hash) return
    setSearchParams((params) => {
      const copy = new URLSearchParams(params)
      if (hash) copy.set('video', hash)
      else copy.delete('video')
      return copy
    }, { replace: true })
  }, [setSearchParams, videoHash])

  // All three stay mounted so switching tabs keeps each form and result; each tab has its own layout presets. Like the
  // generation page, the row does not stick: the workspace below scrolls on its own.
  return (
    <GenerationLayoutProvider>
      <PageToolbar
        sticky={false}
        title={t('pageAccessCatalog.sprite')}
        start={(
          <SegmentedControl
            value={tab}
            onChange={setTab}
            size="sm"
            semantics="tabs"
            ariaLabel={t({ ko: '스프라이트 메뉴', en: 'Sprite sections' })}
            items={[
              { value: 'extract', label: t({ ko: '추출', en: 'Extract' }) },
              { value: 'normalize', label: t({ ko: '정규화', en: 'Normalize' }) },
              { value: 'animation', label: t({ ko: '애니메이션', en: 'Animation' }) },
            ]}
          />
        )}
        actions={(
          <>
            <div ref={setToolbarSlot} className={tab === 'extract' ? 'flex items-center gap-1' : 'hidden'} />
            <GenerationLayoutControls wide={isWide} />
          </>
        )}
      />
      <div className={tab === 'extract' ? undefined : 'hidden'}>
        <SpriteExtractTab active={tab === 'extract'} initialVideoHash={videoHash} onVideoChange={onVideoChange} toolbarSlot={toolbarSlot} />
      </div>
      <div className={tab === 'normalize' ? undefined : 'hidden'}>
        <SpriteNormalizeTab active={tab === 'normalize'} />
      </div>
      <div className={tab === 'animation' ? undefined : 'hidden'}>
        <SpriteAnimationTab active={tab === 'animation'} />
      </div>
    </GenerationLayoutProvider>
  )
}
