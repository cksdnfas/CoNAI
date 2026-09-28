import { useCallback, useMemo, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useHomeSearch, type TextSearchScope } from '@/features/home/home-search-context'
import { getImageExtractedPromptCards, type ExtractedPromptActionScope } from '@/lib/image-extracted-prompts'
import type { AutoTestMediaRecord } from '@/lib/api-settings'
import type { AutoTestTaggerResult } from '@/lib/api-settings-tagger'
import type { AutoTestKaloscopeResult } from '@/lib/api-settings-kaloscope'
import type { ImageRecord } from '@/types/image'
import { formatFileSize } from '../settings-utils'
import { EnhancedVideoPlayer } from '@/features/images/components/detail/enhanced-video-player'
import { SettingRow } from '@/components/ui/setting-row'
import { SETTINGS_WIDE_CONTROL_CLASS } from './settings-rows'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'

function getTextSearchScopeForExtractedPrompt(scope: ExtractedPromptActionScope): TextSearchScope {
  if (scope === 'negative') {
    return 'negative'
  }

  if (scope === 'lora') {
    return 'lora'
  }

  return 'positive'
}

interface AutoTestCardProps {
  heading: ReactNode
  /** Rendered next to the hash input so the controls stay hidden while the section is collapsed. */
  actions?: ReactNode
  autoTestHashInput: string
  autoTestMedia: AutoTestMediaRecord | null
  autoTestImage: ImageRecord | null
  isLoadingAutoTestImage: boolean
  taggerTestResult: AutoTestTaggerResult | null
  kaloscopeTestResult: AutoTestKaloscopeResult | null
  onAutoTestHashInputChange: (value: string) => void
  onResolveAutoTestMedia: () => void
  onRunTaggerAutoTest: () => void
  onRunKaloscopeAutoTest: () => void
  isRunningTaggerAutoTest: boolean
  isRunningKaloscopeAutoTest: boolean
}

export function AutoTestCard({
  heading,
  actions,
  autoTestHashInput,
  autoTestMedia,
  autoTestImage,
  isLoadingAutoTestImage,
  taggerTestResult,
  kaloscopeTestResult,
  onAutoTestHashInputChange,
  onResolveAutoTestMedia,
  onRunTaggerAutoTest,
  onRunKaloscopeAutoTest,
  isRunningTaggerAutoTest,
  isRunningKaloscopeAutoTest,
}: AutoTestCardProps) {
  const { t } = useI18n()
  const { addScopedTextChip } = useHomeSearch()
  const extractedPromptCards = useMemo(() => (autoTestImage ? getImageExtractedPromptCards(autoTestImage, t) : []), [autoTestImage, t])

  const handleAddExtractedPromptSearchFilter = useCallback((scope: ExtractedPromptActionScope, tag: string) => {
    addScopedTextChip(getTextSearchScopeForExtractedPrompt(scope), tag, { apply: true })
  }, [addScopedTextChip])

  const handleAddAutoPromptSearchFilter = useCallback((tag: string) => {
    addScopedTextChip('auto', tag, { apply: true })
  }, [addScopedTextChip])

  const handleHashInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onAutoTestHashInputChange(event.target.value)
  }, [onAutoTestHashInputChange])

  const handleHashInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    if (!autoTestHashInput.trim()) return
    event.preventDefault()
    onResolveAutoTestMedia()
  }, [autoTestHashInput, onResolveAutoTestMedia])

  return (
    <Section variant="settings" heading={heading} collapsible defaultOpen={false}>
      <SettingRow label={t({ ko: '이미지 해시', en: 'Image hash' })} controlClassName={SETTINGS_WIDE_CONTROL_CLASS}>
        <Input
          variant="settings"
          className="min-w-0 flex-1 font-mono"
          aria-label={t({ ko: '이미지 해시', en: 'Image hash' })}
          value={autoTestHashInput}
          onChange={handleHashInputChange}
          onKeyDown={handleHashInputKeyDown}
          placeholder={t({ ko: '이미지 상세의 해시 값', en: 'Hash from image details' })}
        />
        {actions}
      </SettingRow>

      {autoTestMedia ? (
        <div className="pt-2">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-sm bg-fill">
              {autoTestMedia.fileType === 'video' && autoTestMedia.imageUrl ? (
                <EnhancedVideoPlayer renderUrl={autoTestMedia.imageUrl} preload="metadata" className="aspect-square w-full" />
              ) : autoTestMedia.thumbnailUrl || autoTestMedia.imageUrl ? (
                <img
                  src={autoTestMedia.thumbnailUrl ?? autoTestMedia.imageUrl ?? undefined}
                  alt={autoTestMedia.fileName ?? autoTestMedia.compositeHash}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center px-4 text-sm text-muted-foreground">{t({ ko: '미리보기를 준비하지 못했어.', en: 'Could not prepare a preview.' })}</div>
              )}
            </div>

            <div className="min-w-0">
              {[
                { label: t({ ko: '타입', en: 'Type' }), value: autoTestMedia.fileType ?? '—' },
                { label: t({ ko: '파일', en: 'File' }), value: autoTestMedia.fileName ?? '—' },
                { label: t({ ko: '존재 여부', en: 'Exists' }), value: autoTestMedia.existsOnDisk ? t({ ko: '예', en: 'yes' }) : t({ ko: '아니오', en: 'no' }) },
                { label: t({ ko: '크기', en: 'Size' }), value: formatFileSize(autoTestMedia.fileSize) },
                { label: t({ ko: '해시', en: 'Hash' }), value: autoTestMedia.compositeHash, mono: true },
                { label: t({ ko: '경로', en: 'Path' }), value: autoTestMedia.originalFilePath ?? '—', mono: true },
              ].map((item) => (
                <div key={item.label} className="flex min-h-10 items-baseline gap-4 border-b border-line py-2 text-sm last:border-b-0">
                  <span className="w-20 shrink-0 text-muted-foreground">{item.label}</span>
                  <span className={item.mono ? 'min-w-0 break-all font-mono text-xs text-foreground' : 'min-w-0 break-all text-foreground'}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isLoadingAutoTestImage ? (
        <p className="text-sm text-muted-foreground">
          {t({ ko: '추출 프롬프트를 불러오는 중이야…', en: 'Loading extracted prompts…' })}
        </p>
      ) : null}

      {extractedPromptCards.length > 0 ? (
        <div>
          <div className="text-2xs font-semibold uppercase tracking-overline text-muted-foreground">{t({ ko: '추출 프롬프트', en: 'Extracted prompt' })}</div>
          <div className="mt-3">
            <ExtractedPromptSections items={extractedPromptCards} onAddSearchFilter={handleAddExtractedPromptSearchFilter} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRunTaggerAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningTaggerAutoTest}>
          {isRunningTaggerAutoTest ? t({ ko: '태거 테스트 중…', en: 'Running tagger test…' }) : t({ ko: '태거 테스트', en: 'Tagger test' })}
        </Button>
        <Button size="sm" variant="secondary" onClick={onRunKaloscopeAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningKaloscopeAutoTest}>
          {isRunningKaloscopeAutoTest ? t({ ko: 'Kaloscope 테스트 중…', en: 'Running Kaloscope test…' }) : t({ ko: 'Kaloscope 테스트', en: 'Kaloscope test' })}
        </Button>
      </div>

      {kaloscopeTestResult ? <KaloscopeResultBlock result={kaloscopeTestResult} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
      {taggerTestResult ? <WDTaggerResultBlock result={taggerTestResult} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
    </Section>
  )
}
