import type { ReactNode } from 'react'
import { ArrowUp, ExternalLink, RotateCcw, Save, Sparkles } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { CompactGenerationActionSurface } from './shared-generation-controller'
import { PromptToggleField } from './prompt-toggle-field'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'

interface NaiConnectionHeaderProps {
  connected: boolean
  tierName?: string
  anlasBalance?: number
  onOpenAuth: () => void
  compact?: boolean
}

/** Render the NovelAI connection header with auth status and external link. */
export function NaiConnectionHeader({ connected, tierName, anlasBalance, onOpenAuth, compact = false }: NaiConnectionHeaderProps) {
  const { t } = useI18n()
  const novelAiHomeLabel = t('image-generation.components.nai.generation.panel.sections.open.novelai.homepage')

  return (
    <section className={compact ? 'space-y-0' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold text-foreground">NovelAI</div>
          {connected
            ? <Badge variant="secondary">{t('image-generation.components.nai.generation.panel.sections.connected')}</Badge>
            : <Badge variant="outline">{t('image-generation.components.nai.generation.panel.sections.disconnected')}</Badge>}
          {connected && tierName ? <Badge variant="outline">{tierName}</Badge> : null}
          {connected && anlasBalance !== undefined ? <Badge variant="outline">Anlas {anlasBalance}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {!connected ? (
            <Button type="button" variant="outline" size="sm" onClick={onOpenAuth}>
              {t('image-generation.components.nai.auth.modal.log.in')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="icon-sm" asChild>
            <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label={novelAiHomeLabel} title={novelAiHomeLabel}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}

type NaiControllerSectionProps = {
  heading: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** Render one minimal NAI controller section with stronger borders and less card-heavy chrome. */
export function NaiControllerSection({ heading, actions, children, className, contentClassName }: NaiControllerSectionProps) {
  return (
    <section className={cn('overflow-hidden rounded-sm border border-border/85 bg-surface-container/30', className)}>
      <div className="px-4 py-3 border-b border-border/85">
        <SectionHeading variant="inside" className="border-b-0 pb-0" heading={heading} actions={actions} />
      </div>
      <div className={cn('space-y-4 px-4 py-4', contentClassName)}>
        {children}
      </div>
    </section>
  )
}

type NaiControllerInsetBlockProps = {
  children: ReactNode
  className?: string
}

/** Render one dense inset block inside the NAI controller surface. */
export function NaiControllerInsetBlock({ children, className }: NaiControllerInsetBlockProps) {
  return <div className={cn('border-t border-border/70 pt-4', className)}>{children}</div>
}

interface NaiPromptSectionProps {
  prompt: string
  negativePrompt: string
  tool?: PromptWildcardTool
  onPromptChange: (value: string) => void
  onNegativePromptChange: (value: string) => void
}

/** Render the primary prompt section for NovelAI generation. */
export function NaiPromptSection({
  prompt,
  negativePrompt,
  tool = 'nai',
  onPromptChange,
  onNegativePromptChange,
}: NaiPromptSectionProps) {
  return (
    <PromptToggleField
      tool={tool}
      positiveValue={prompt}
      negativeValue={negativePrompt}
      onPositiveChange={onPromptChange}
      onNegativeChange={onNegativePromptChange}
      positiveRows={6}
      negativeRows={6}
    />
  )
}

interface NaiActionSectionProps {
  variant?: 'card' | 'inline' | 'compact'
  canUpscale: boolean
  isUpscaling: boolean
  isGenerating: boolean
  canGenerate: boolean
  generateButtonLabel: string
  costErrorMessage?: string | null
  onOpenModuleSave?: () => void
  onUpscale: () => void
  onReset: () => void
  onGenerate: () => void
}

/** Render the bottom action bar for reset, generate, and upscale flows. */
export function NaiActionSection({
  variant = 'card',
  canUpscale,
  isUpscaling,
  isGenerating,
  canGenerate,
  generateButtonLabel,
  costErrorMessage,
  onOpenModuleSave,
  onUpscale,
  onReset,
  onGenerate,
}: NaiActionSectionProps) {
  const { t } = useI18n()
  const saveModuleLabel = t('image-generation.components.nai.generation.panel.sections.save.module')
  const canSaveModule = Boolean(onOpenModuleSave)
  const upscaleLabel = isUpscaling
    ? t('image-generation.components.nai.generation.panel.sections.upscaling')
    : t('image-generation.components.nai.generation.panel.sections.source.2x.upscale')
  const resetLabel = t('image-generation.components.nai.generation.panel.sections.reset')

  const actionContent = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canSaveModule ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={onOpenModuleSave}
              disabled={isGenerating || isUpscaling}
              aria-label={saveModuleLabel}
              title={saveModuleLabel}
            >
              <Save className="h-4 w-4" />
            </Button>
          ) : null}
          {canUpscale ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={onUpscale}
              disabled={isUpscaling || isGenerating}
              aria-label={upscaleLabel}
              title={upscaleLabel}
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
            aria-label={resetLabel}
            title={resetLabel}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" onClick={onGenerate} disabled={isGenerating || !canGenerate}>
            <Sparkles className="h-4 w-4" />
            {generateButtonLabel}
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

  if (variant === 'compact') {
    return (
      <CompactGenerationActionSurface className="max-w-full">
        {canSaveModule ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenModuleSave}
            disabled={isGenerating || isUpscaling}
            aria-label={saveModuleLabel}
            title={saveModuleLabel}
            className="rounded-none border-r border-border/70 shadow-none"
          >
            <Save className="h-4 w-4" />
          </Button>
        ) : null}

        {canUpscale ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onUpscale}
            disabled={isUpscaling || isGenerating}
            aria-label={upscaleLabel}
            title={upscaleLabel}
            className="rounded-none border-r border-border/70 shadow-none"
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
          aria-label={resetLabel}
          title={resetLabel}
          className="rounded-none shadow-none"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating || !canGenerate}
          className="rounded-none border-l border-border/70 shadow-none"
          aria-label={generateButtonLabel}
          title={generateButtonLabel}
        >
          <Sparkles className="h-4 w-4" />
          {generateButtonLabel}
        </Button>

      </CompactGenerationActionSurface>
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
