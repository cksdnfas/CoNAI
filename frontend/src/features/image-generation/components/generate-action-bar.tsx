import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Tip } from '@/components/ui/tooltip'
import { GenerationTargetGroupControl } from '@/features/groups/components/generation-target-group-control'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type GenerateActionBarVariant = 'inline' | 'sticky'

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
  /** Visible Generate label chosen by the provider ("생성", "로그인 후 생성"…). */
  generateLabel: string
  /** Short trailing text such as NAI "(무료)" or "12 Anlas"; hidden on narrow sticky bars. */
  generateSuffix?: ReactNode
  onGenerate: () => void
  /** Blocks both the button and the Ctrl/Cmd+Enter shortcut. */
  generateDisabled?: boolean
  /** Shows a spinner and blocks Generate plus the secondary actions. */
  isGenerating?: boolean
  /** Label while `isGenerating` ("큐 등록 중…"). Defaults to `generateLabel`. */
  generatingLabel?: string
  /** Queue repeat stepper ("반복 / Repeat"). Omit to hide it. */
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

const GenerateActionBarVariantContext = createContext<GenerateActionBarVariant>('inline')

const STICKY_CONTROL_HEIGHT = 'h-11 sm:h-9'
const STICKY_ICON_SIZE = 'size-11 sm:size-9'

/** One secondary icon action sized for the surrounding GenerateActionBar variant. */
export function GenerateActionBarIconButton({ className, ...props }: Omit<ComponentProps<typeof IconButton>, 'size' | 'variant'>) {
  const variant = useContext(GenerateActionBarVariantContext)
  return (
    <IconButton
      variant="ghost"
      size="icon"
      className={cn(variant === 'sticky' && STICKY_ICON_SIZE, className)}
      {...props}
    />
  )
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
  const canGenerate = !generateDisabled && !isGenerating
  const shortcutHint = isMacPlatform() ? '⌘ Enter' : 'Ctrl+Enter'

  useGenerateShortcut(shortcut, () => {
    if (canGenerate) onGenerate()
  })

  const visibleLabel = isGenerating ? (generatingLabel ?? generateLabel) : generateLabel
  const repeatLabel = t({ ko: '반복', en: 'Repeat' })
  const repeatHint = t({ ko: '큐에 넣을 작업 수', en: 'Jobs to add to the queue' })
  const resolvedResetLabel = resetLabel ?? t({ ko: '초기화', en: 'Reset' })
  const messageClassName = messageTone === 'error'
    ? 'text-destructive-soft-foreground'
    : messageTone === 'info'
      ? 'text-muted-foreground'
      : 'text-warning'

  const generateButton = (
    <Tip content={`${visibleLabel} (${shortcutHint})`}>
      <Button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        aria-busy={isGenerating || undefined}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        className={cn('min-w-0', isSticky ? cn(STICKY_CONTROL_HEIGHT, 'max-w-[11rem] sm:max-w-none') : 'max-w-full')}
      >
        {isGenerating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        <span className="truncate">{visibleLabel}</span>
        {generateSuffix && !isGenerating ? (
          <span className={cn('shrink-0 font-normal opacity-85', isSticky && 'hidden sm:inline')}>{generateSuffix}</span>
        ) : null}
      </Button>
    </Tip>
  )

  const repeatStepper = repeat ? (
    <div className="flex shrink-0 items-center gap-1.5">
      {!isSticky ? (
        <Tip content={repeatHint}>
          <span className="text-xs text-muted-foreground">{repeatLabel}</span>
        </Tip>
      ) : null}
      <NumberStepperInput
        min={repeat.min ?? 1}
        max={repeat.max}
        step={1}
        variant="detail"
        className={cn('shrink-0', isSticky ? 'w-28 min-w-28' : 'w-32')}
        value={repeat.value}
        onValueCommit={repeat.onChange}
        disabled={isGenerating || repeat.disabled}
        aria-label={t({ ko: '반복 (큐 작업 수)', en: 'Repeat (queue jobs)' })}
        inputMode="numeric"
      />
    </div>
  ) : null

  const resetButton = onReset ? (
    <GenerateActionBarIconButton label={resolvedResetLabel} onClick={onReset} disabled={isGenerating}>
      <RotateCcw />
    </GenerateActionBarIconButton>
  ) : null

  const groupPicker = targetGroupStorageKey ? (
    isSticky ? (
      <GenerationTargetGroupControl
        storageKey={targetGroupStorageKey}
        variant="icon"
        disabled={isGenerating}
        className={cn('rounded-sm border-0', STICKY_ICON_SIZE)}
      />
    ) : (
      <GenerationTargetGroupControl
        storageKey={targetGroupStorageKey}
        disabled={isGenerating}
        className="max-w-full [&_[data-size=icon-sm]]:size-9 [&_[data-size=sm]]:h-9"
      />
    )
  ) : null

  if (isSticky) {
    return (
      <GenerateActionBarVariantContext.Provider value="sticky">
        <div
          data-slot="generate-action-bar"
          data-variant="sticky"
          className={cn(
            'flex max-w-full flex-col items-end gap-1 rounded-md bg-surface-container/95 p-1 shadow-elevation-3 backdrop-blur-md',
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
            {secondaryActions}
            {resetButton}
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
          {secondaryActions || resetButton ? (
            <div className="flex items-center gap-1">
              {secondaryActions}
              {resetButton}
            </div>
          ) : null}
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
    <div data-slot="generate-action-dock" className={cn('sticky bottom-0 z-sticky shrink-0 rounded-md bg-surface-container p-3 shadow-elevation-1', className)}>
      {children}
    </div>
  )
}
