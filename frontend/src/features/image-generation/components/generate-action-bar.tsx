import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, MoreHorizontal, RotateCcw, Wand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Tip } from '@/components/ui/tooltip'
import { GenerationTargetGroupControl } from '@/features/groups/components/generation-target-group-control'
import { PluginGenerationActions, usePluginGenerationButtons } from '@/features/plugins/plugin-generation-actions'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GenerateActionBarIconButton, GenerateActionBarMenuContext, GenerateActionBarVariantContext, type GenerateActionBarVariant } from './generate-action-bar-icon-button'

export { GenerateActionBarIconButton, type GenerateActionBarVariant }

export type GenerateActionBarRepeat = {
  /** Queue jobs to create per click (not images per request). */
  value: string
  min?: number
  max: number
  onChange: (value: string) => void
  disabled?: boolean
}

export type GenerateActionBarProps = {
  /** `inline` sits inside the controller panel; `sticky` is the bottom-docked surface used with the controller drawer. */
  variant?: GenerateActionBarVariant
  /** Accessible Generate label and tooltip chosen by the provider ("생성", "로그인 후 생성"…). */
  generateLabel: string
  /** Cost next to Generate, such as NAI "(무료)" or "12 Anlas"; shown in the tooltip on narrow sticky bars. */
  generateSuffix?: ReactNode
  /** Tooltip on the cost suffix (also appended to the Generate tooltip), e.g. what the estimate leaves out. */
  generateSuffixHint?: string
  onGenerate: () => void
  /** Blocks both the button and the Ctrl/Cmd+Enter shortcut. */
  generateDisabled?: boolean
  /** Shows a spinner and blocks Generate plus the secondary actions. */
  isGenerating?: boolean
  /** Label while `isGenerating` ("큐 등록 중…"). Defaults to `generateLabel`. */
  generatingLabel?: string
  /** Queue repeat stepper (no visible caption; the meaning lives in its tooltip). Omit to hide it. */
  repeat?: GenerateActionBarRepeat
  onReset?: () => void
  resetLabel?: string
  /** Extra secondary actions before Reset; use `GenerateActionBarIconButton` for matching sizes. */
  secondaryActions?: ReactNode
  /** Control placed before the group picker (e.g. the ComfyUI server target). */
  leading?: ReactNode
  /** Result-group picker storage key; null/undefined hides the picker. */
  targetGroupStorageKey?: string | null
  /** Warning/status line shown with the bar. */
  message?: ReactNode
  messageTone?: 'warning' | 'error' | 'info'
  /** Register Ctrl/Cmd+Enter for this bar (default true). */
  shortcut?: boolean
  className?: string
}

type ShortcutEntry = { token: symbol }
const shortcutStack: ShortcutEntry[] = []

/** True when a modal, confirm or popover is open. The generation controller drawer does not count. */
function isBlockingOverlayOpen() {
  if (typeof document === 'undefined') {
    return false
  }

  const overlays = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
  for (const overlay of overlays) {
    if (overlay.closest('.theme-bottom-drawer')) {
      continue
    }
    if (overlay.getAttribute('data-state') === 'closed') {
      continue
    }
    return true
  }
  return false
}

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
}

/**
 * Ctrl/Cmd+Enter → Generate while this bar is mounted. Only the most recently mounted bar reacts,
 * and nothing happens while a modal is open or Generate is disabled.
 */
function useGenerateShortcut(enabled: boolean, trigger: () => void) {
  const triggerRef = useRef(trigger)
  useLayoutEffect(() => {
    triggerRef.current = trigger
  })

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    const entry: ShortcutEntry = { token: Symbol('generate-shortcut') }
    shortcutStack.push(entry)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shortcutStack[shortcutStack.length - 1] !== entry) return
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.repeat || event.isComposing) return

      // Number steppers commit their draft on Enter (and preventDefault); run after that commit lands.
      const target = event.target instanceof Element ? event.target : null
      const inStepper = Boolean(target?.closest('[data-slot="number-stepper-input"]'))
      if (event.defaultPrevented && !inStepper) return
      if (isBlockingOverlayOpen()) return

      event.preventDefault()
      if (inStepper) {
        window.setTimeout(() => triggerRef.current(), 0)
      } else {
        triggerRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      const index = shortcutStack.indexOf(entry)
      if (index >= 0) shortcutStack.splice(index, 1)
    }
  }, [enabled])
}

/** The one Generate action bar shared by NAI, Codex, ComfyUI and the public workflow page. */
export function GenerateActionBar({
  variant = 'inline',
  generateLabel,
  generateSuffix,
  generateSuffixHint,
  onGenerate,
  generateDisabled = false,
  isGenerating = false,
  generatingLabel,
  repeat,
  onReset,
  resetLabel,
  secondaryActions,
  leading,
  targetGroupStorageKey,
  message,
  messageTone = 'warning',
  shortcut = true,
  className,
}: GenerateActionBarProps) {
  const { t } = useI18n()
  const isSticky = variant === 'sticky'
  const [menuOpen, setMenuOpen] = useState(false)
  const [pluginBusy, setPluginBusy] = useState(false)
  const { canExecuteGeneration } = useFeaturePermissions()
  const canGenerate = canExecuteGeneration && !generateDisabled && !isGenerating
  const shortcutHint = isMacPlatform() ? '⌘ Enter' : 'Ctrl+Enter'

  useGenerateShortcut(shortcut, () => {
    if (canGenerate) onGenerate()
  })

  const actionLabel = !canExecuteGeneration ? t({ ko: '생성 권한 필요', en: 'Generation permission required' }) : isGenerating ? (generatingLabel ?? generateLabel) : generateLabel
  const repeatHint = t({ ko: '반복: 한 번 누를 때 큐에 넣을 작업 수', en: 'Repeat: jobs to queue per click' })
  const resolvedResetLabel = resetLabel ?? t({ ko: '초기화', en: 'Reset' })
  const messageClassName = messageTone === 'error'
    ? 'text-destructive-soft-foreground'
    : messageTone === 'info'
      ? 'text-muted-foreground'
      : 'text-warning'

  const generateButton = (
      <Tip content={<>{`${actionLabel} (${shortcutHint})`}{generateSuffix && !isGenerating ? <> · {generateSuffix}{generateSuffixHint ? <> · {generateSuffixHint}</> : null}</> : null}</>}>
        <Button
          variant="default"
          size={isSticky ? 'touch' : 'default'}
          onClick={onGenerate}
          disabled={!canGenerate}
          aria-busy={isGenerating || undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          {isGenerating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand aria-hidden="true" />}
          {actionLabel}{generateSuffix && !isGenerating ? <> · {generateSuffix}</> : null}
        </Button>
      </Tip>
  )

  const repeatStepper = repeat ? (
    <Tip content={repeatHint}>
      <div className="flex shrink-0 items-center">
        <NumberStepperInput
          min={repeat.min ?? 1}
          max={repeat.max}
          step={1}
          variant="detail"
          className="w-32 min-w-32 shrink-0 sm:w-28 sm:min-w-28"
          value={repeat.value}
          onValueCommit={repeat.onChange}
          disabled={isGenerating || repeat.disabled}
          aria-label={repeatHint}
          inputMode="numeric"
        />
      </div>
    </Tip>
  ) : null

  const resetButton = onReset ? (
    <GenerateActionBarIconButton label={resolvedResetLabel} onClick={onReset} disabled={isGenerating}>
      <RotateCcw />
    </GenerateActionBarIconButton>
  ) : null

  // Buttons enabled plugins add for this screen's layout surface.
  const pluginActions = <PluginGenerationActions disabled={isGenerating} />
  const hasPluginActions = usePluginGenerationButtons().shown.length > 0
  const moreActions = secondaryActions || onReset || hasPluginActions ? (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={(open) => { if (open || !pluginBusy) setMenuOpen(open) }}>
      <DropdownMenuTrigger asChild>
        <IconButton size={isSticky ? 'icon-touch' : 'icon'} variant="ghost" label={t({ ko: '생성 작업 더 보기', en: 'More generation actions' })}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <GenerateActionBarMenuContext.Provider value={{ kind: 'menu' }}>
          {secondaryActions}
          {/* Keep the plugin mounted while its async action is running, so it cannot be started twice. */}
          <GenerateActionBarMenuContext.Provider value={{ kind: 'plugin', reportBusy: setPluginBusy }}>{pluginActions}</GenerateActionBarMenuContext.Provider>
          {resetButton}
        </GenerateActionBarMenuContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  const groupPicker = targetGroupStorageKey ? (
    <GenerationTargetGroupControl
      storageKey={targetGroupStorageKey}
      disabled={isGenerating}
      size={isSticky ? 'icon-touch' : 'icon'}
    />
  ) : null

  if (isSticky) {
    return (
      <GenerateActionBarVariantContext.Provider value="sticky">
        <div
          data-slot="generate-action-bar"
          data-variant="sticky"
          className={cn(
            // The shared floating glass (appearance glass preset), not a local translucent fill.
            'theme-floating-panel flex max-w-full flex-col items-end gap-1 rounded-md p-1 shadow-elevation-3',
            className,
          )}
        >
          {message ? (
            <div role="status" className={cn('flex max-w-[min(24rem,calc(100vw-5rem))] items-start gap-1.5 px-2 pt-1 text-xs', messageClassName)}>
              {messageTone !== 'info' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}
              <span>{message}</span>
            </div>
          ) : null}
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
            {moreActions}
            {leading}
            {groupPicker}
            {repeatStepper}
            {generateButton}
          </div>
        </div>
      </GenerateActionBarVariantContext.Provider>
    )
  }

  return (
    <GenerateActionBarVariantContext.Provider value="inline">
      <section data-slot="generate-action-bar" data-variant="inline" className={cn('space-y-2', className)}>
        <div className="flex flex-wrap items-center gap-2">
          {moreActions}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {leading}
            {groupPicker}
            {repeatStepper}
            {generateButton}
          </div>
        </div>
        {message ? (
          <div role="status" className={cn('flex items-start gap-1.5 text-xs', messageClassName)}>
            {messageTone !== 'info' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}
            <span>{message}</span>
          </div>
        ) : null}
      </section>
    </GenerateActionBarVariantContext.Provider>
  )
}

/** Bottom dock for the inline bar in the split-pane layout: stays put while the controls above it scroll. */
export function GenerateActionDock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="generate-action-dock" className={cn('sticky bottom-(--shell-bottom-inset) z-sticky shrink-0 rounded-md bg-surface-container p-3 shadow-elevation-1', className)}>
      {children}
    </div>
  )
}
