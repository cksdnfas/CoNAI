import type { ReactNode } from 'react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getImageExtractedPromptCards } from '@/lib/image-extracted-prompts'
import type { AutoTestKaloscopeResult, AutoTestMediaRecord, AutoTestTaggerResult } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import { formatFileSize } from '../settings-utils'
import { EnhancedVideoPlayer } from '@/features/images/components/detail/enhanced-video-player'
import { SettingsField, SettingsInsetBlock, SettingsSection, SettingsValueTile } from './settings-primitives'

interface AutoTestCardProps {
  heading: ReactNode
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
  const extractedPromptCards = autoTestImage ? getImageExtractedPromptCards(autoTestImage) : []

  return (
    <SettingsSection heading={heading} actions={actions}>
      <SettingsField label="Composite hash">
        <Input
          variant="settings"
          className="font-mono"
          value={autoTestHashInput}
          onChange={(event) => onAutoTestHashInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            if (!autoTestHashInput.trim()) return
            event.preventDefault()
            onResolveAutoTestMedia()
          }}
          placeholder="image hash"
        />
      </SettingsField>

      {autoTestMedia ? (
        <div className="pt-2">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-sm border border-border/70 bg-surface-low/45">
              {autoTestMedia.fileType === 'video' && autoTestMedia.imageUrl ? (
                <EnhancedVideoPlayer renderUrl={autoTestMedia.imageUrl} preload="metadata" className="aspect-square w-full" />
              ) : autoTestMedia.thumbnailUrl || autoTestMedia.imageUrl ? (
                <img
                  src={autoTestMedia.thumbnailUrl ?? autoTestMedia.imageUrl ?? undefined}
                  alt={autoTestMedia.fileName ?? autoTestMedia.compositeHash}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center px-4 text-sm text-muted-foreground">미리보기를 준비하지 못했어.</div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SettingsValueTile label="type" value={autoTestMedia.fileType ?? '—'} />
              <SettingsValueTile label="file" value={autoTestMedia.fileName ?? '—'} valueClassName="break-all" />
              <SettingsValueTile label="exists" value={autoTestMedia.existsOnDisk ? 'yes' : 'no'} />
              <SettingsValueTile label="size" value={formatFileSize(autoTestMedia.fileSize)} />
              <SettingsValueTile
                label="hash"
                value={autoTestMedia.compositeHash}
                className="md:col-span-2"
                valueClassName="break-all font-mono text-xs"
              />
              <SettingsValueTile
                label="path"
                value={autoTestMedia.originalFilePath ?? '—'}
                className="md:col-span-2"
                valueClassName="break-all font-mono text-xs"
              />
            </div>
          </div>
        </div>
      ) : (
        <SettingsInsetBlock className="text-sm text-muted-foreground">
          해시를 확인하거나 랜덤으로 하나 골라줘. 파일이 실제로 확인된 대상만 테스트 버튼이 열려.
        </SettingsInsetBlock>
      )}

      {isLoadingAutoTestImage ? (
        <SettingsInsetBlock className="text-sm text-muted-foreground">
          추출 프롬프트를 불러오는 중이야…
        </SettingsInsetBlock>
      ) : null}

      {extractedPromptCards.length > 0 ? (
        <SettingsInsetBlock>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Extracted prompt</div>
          <div className="mt-3">
            <ExtractedPromptSections items={extractedPromptCards} />
          </div>
        </SettingsInsetBlock>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRunTaggerAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningTaggerAutoTest}>
          {isRunningTaggerAutoTest ? '태거 테스트 중…' : '태거 테스트'}
        </Button>
        <Button size="sm" variant="outline" onClick={onRunKaloscopeAutoTest} disabled={!autoTestMedia?.existsOnDisk || isRunningKaloscopeAutoTest}>
          {isRunningKaloscopeAutoTest ? 'Kaloscope 테스트 중…' : 'Kaloscope 테스트'}
        </Button>
      </div>

      {kaloscopeTestResult ? <KaloscopeResultBlock result={kaloscopeTestResult} /> : null}
      {taggerTestResult ? <WDTaggerResultBlock result={taggerTestResult} /> : null}
    </SettingsSection>
  )
}
