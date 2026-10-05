import type { ReactNode } from 'react'
import { ArrowUp, ExternalLink, LogIn } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GenerateActionBar, GenerateActionBarIconButton, type GenerateActionBarVariant } from './generate-action-bar'
import { IMAGE_GENERATION_TARGET_GROUP_KEY } from '@/features/groups/generation-target-group-store'
import { GenerationToolbarStatus } from './generation-toolbar-status'
import { PromptToggleField } from './prompt-toggle-field'
import type { PromptWildcardTool } from './wildcard-inline-picker-helpers'

interface NaiConnectionHeaderProps {
  connected: boolean
  tierName?: string
  anlasBalance?: number
  opusRemainingPercent?: number | null
  onOpenAuth: () => void
  compact?: boolean
}

function NaiOpusUsage({ percent }: { percent: number }) {
  const { t, formatNumber } = useI18n()
  const label = `Opus ${formatNumber(percent, { maximumFractionDigits: 1 })}%`

  return (
    <Badge variant="outline" className="gap-2 tabular-nums" asChild>
      <div>
        <span>{label}</span>
        <Progress
          size="sm"
          value={percent}
          className="w-10"
          aria-label={t({ ko: 'Opus 잔여량', en: 'Opus remaining' })}
          aria-valuetext={label}
        />
      </div>
    </Badge>
  )
}

/** Render the NovelAI connection header with auth status and external link. */
export function NaiConnectionHeader({ connected, tierName, anlasBalance, opusRemainingPercent, onOpenAuth, compact = false }: NaiConnectionHeaderProps) {
  const { t, formatNumber } = useI18n()
  const novelAiHomeLabel = t('image-generation.components.nai.generation.panel.sections.open.novelai.homepage')

  return (
    <section className={compact ? 'space-y-0' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Heading level={3} as="div" className="truncate">NovelAI</Heading>
          {connected
            ? <Badge variant="secondary" className="bg-success-soft text-success-soft-foreground">{t('image-generation.components.nai.generation.panel.sections.connected')}</Badge>
            : <Badge variant="outline">{t('image-generation.components.nai.generation.panel.sections.disconnected')}</Badge>}
          {connected && tierName ? <Badge variant="outline">{tierName}</Badge> : null}
          {connected && anlasBalance !== undefined ? <Badge variant="outline">Anlas {formatNumber(anlasBalance)}</Badge> : null}
          {connected && tierName === 'Opus' && opusRemainingPercent != null ? <NaiOpusUsage percent={opusRemainingPercent} /> : null}
        </div>
        <div className="flex items-center gap-2">
          {!connected ? (
            <Button type="button" variant="secondary" size="sm" onClick={onOpenAuth}>
              {t('image-generation.components.nai.auth.modal.log.in')}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="icon-sm" asChild>
            <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label={novelAiHomeLabel} title={novelAiHomeLabel}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}

/** NovelAI connection state for the page toolbar: dot + tier, Anlas chip, and login/home icon actions. */
export function NaiToolbarStatus({ connected, tierName, anlasBalance, opusRemainingPercent, onOpenAuth }: Omit<NaiConnectionHeaderProps, 'compact'>) {
  const { t, formatNumber } = useI18n()
  const novelAiHomeLabel = t('image-generation.components.nai.generation.panel.sections.open.novelai.homepage')
  const statusLabel = connected
    ? tierName || t('image-generation.components.nai.generation.panel.sections.connected')
    : t('image-generation.components.nai.generation.panel.sections.disconnected')

  return (
    <GenerationToolbarStatus tone={connected ? 'ready' : 'off'} label={statusLabel}>
      {connected && anlasBalance !== undefined ? <Badge variant="outline" className="shrink-0 tabular-nums">Anlas {formatNumber(anlasBalance)}</Badge> : null}
      {connected && tierName === 'Opus' && opusRemainingPercent != null ? <NaiOpusUsage percent={opusRemainingPercent} /> : null}
      {!connected ? (
        <IconButton size="icon-sm" variant="ghost" onClick={onOpenAuth} label={t('image-generation.components.nai.auth.modal.log.in')}>
          <LogIn />
        </IconButton>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" asChild>
        <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label={novelAiHomeLabel} title={novelAiHomeLabel}>
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    </GenerationToolbarStatus>
  )
}

type NaiControllerInsetBlockProps = {
  children: ReactNode
  className?: string
}

/** Render one dense inset block inside the NAI controller surface. */
export function NaiControllerInsetBlock({ children, className }: NaiControllerInsetBlockProps) {
  return <div className={cn('pt-2', className)}>{children}</div>
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
    />
  )
}

interface NaiActionSectionProps {
  variant?: GenerateActionBarVariant
  canUpscale: boolean
  isUpscaling: boolean
  isGenerating: boolean
  canGenerate: boolean
  generateButtonLabel: string
  generateButtonSuffix?: string
  costErrorMessage?: string | null
  onUpscale: () => void
  onReset: () => void
  onGenerate: () => void
}

/** NAI wiring for the shared GenerateActionBar: upscale + reset secondary actions and the Anlas cost suffix. */
export function NaiActionSection({
  variant = 'inline',
  canUpscale,
  isUpscaling,
  isGenerating,
  canGenerate,
  generateButtonLabel,
  generateButtonSuffix,
  costErrorMessage,
  onUpscale,
  onReset,
  onGenerate,
}: NaiActionSectionProps) {
  const { t } = useI18n()
  const upscaleLabel = isUpscaling
    ? t('image-generation.components.nai.generation.panel.sections.upscaling')
    : t('image-generation.components.nai.generation.panel.sections.source.2x.upscale')

  return (
    <GenerateActionBar
      variant={variant}
      generateLabel={generateButtonLabel}
      generateSuffix={generateButtonSuffix}
      onGenerate={onGenerate}
      generateDisabled={!canGenerate}
      isGenerating={isGenerating}
      onReset={onReset}
      resetLabel={t('image-generation.components.nai.generation.panel.sections.reset')}
      secondaryActions={canUpscale ? (
        <GenerateActionBarIconButton label={upscaleLabel} onClick={onUpscale} disabled={isUpscaling || isGenerating}>
          <ArrowUp />
        </GenerateActionBarIconButton>
      ) : null}
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
      message={costErrorMessage}
    />
  )
}
