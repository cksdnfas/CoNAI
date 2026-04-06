import { ArrowUp, ExternalLink, RotateCcw, Save, Settings2, Sparkles } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PromptToggleField } from './prompt-toggle-field'

export interface NaiConnectionHeaderProps {
  connected: boolean
  tierName?: string
  anlasBalance?: number
  onOpenAuth: () => void
  compact?: boolean
}

/** Render the NovelAI connection header with auth status and external link. */
export function NaiConnectionHeader({ connected, tierName, anlasBalance, onOpenAuth, compact = false }: NaiConnectionHeaderProps) {
  return (
    <section className={compact ? 'space-y-0' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold text-foreground">NovelAI</div>
          {connected ? <Badge variant="secondary">연결됨</Badge> : <Badge variant="outline">미연결</Badge>}
          {connected && tierName ? <Badge variant="outline">{tierName}</Badge> : null}
          {connected && anlasBalance !== undefined ? <Badge variant="outline">Anlas {anlasBalance}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {!connected ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenAuth}>
              로그인
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="icon-sm" asChild>
            <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label="NovelAI 홈페이지 열기" title="NovelAI 홈페이지 열기">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}

export interface NaiPromptSectionProps {
  prompt: string
  negativePrompt: string
  onPromptChange: (value: string) => void
  onNegativePromptChange: (value: string) => void
}

/** Render the primary prompt section for NovelAI generation. */
export function NaiPromptSection({
  prompt,
  negativePrompt,
  onPromptChange,
  onNegativePromptChange,
}: NaiPromptSectionProps) {
  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Prompt" />
          <PromptToggleField
            tool="nai"
            positiveValue={prompt}
            negativeValue={negativePrompt}
            onPositiveChange={onPromptChange}
            onNegativeChange={onNegativePromptChange}
            positiveRows={6}
            negativeRows={6}
          />
        </CardContent>
      </Card>
    </section>
  )
}

export interface NaiActionSectionProps {
  variant?: 'card' | 'inline'
  canUpscale: boolean
  isUpscaling: boolean
  isGenerating: boolean
  canGenerate: boolean
  generateButtonLabel: string
  costErrorMessage?: string | null
  onOpenModuleSave: () => void
  onOpenSaveOptions: () => void
  onUpscale: () => void
  onReset: () => void
  onGenerate: () => void
}

/** Render the bottom action bar for module save, reset, generate, and upscale flows. */
export function NaiActionSection({
  variant = 'card',
  canUpscale,
  isUpscaling,
  isGenerating,
  canGenerate,
  generateButtonLabel,
  costErrorMessage,
  onOpenModuleSave,
  onOpenSaveOptions,
  onUpscale,
  onReset,
  onGenerate,
}: NaiActionSectionProps) {
  const actionContent = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onOpenModuleSave}
            disabled={isGenerating || isUpscaling}
            aria-label="모듈 저장"
            title="모듈 저장"
          >
            <Save className="h-4 w-4" />
          </Button>
          {canUpscale ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={onUpscale}
              disabled={isUpscaling || isGenerating}
              aria-label={isUpscaling ? '업스케일 중' : '소스 2x 업스케일'}
              title={isUpscaling ? '업스케일 중' : '소스 2x 업스케일'}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReset}
            disabled={isGenerating || isUpscaling}
            aria-label="초기화"
            title="초기화"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" onClick={onGenerate} disabled={isGenerating || !canGenerate}>
            <Sparkles className="h-4 w-4" />
            {generateButtonLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onOpenSaveOptions}
            disabled={isGenerating || isUpscaling}
            aria-label="생성 결과 저장 옵션"
            title="생성 결과 저장 옵션"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {costErrorMessage ? <div className="text-xs text-[#ffb4ab]">{costErrorMessage}</div> : null}
    </>
  )

  if (variant === 'inline') {
    return (
      <section className="space-y-3">
        {actionContent}
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          {actionContent}
        </CardContent>
      </Card>
    </section>
  )
}
