import { useId, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ModalFooter, useModalRequestClose } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Quick picks for the group colour; the last swatch opens the system colour picker for any other one. */
export const GROUP_COLOR_PRESETS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#7c3aed', '#ec4899']

const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/i
const CUSTOM_SWATCH_GRADIENT = 'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #7c3aed, #ef4444)'

/** One soft block of settings rows in a group modal; the rows' hairlines touch, the last has none. */
export function GroupModalSection({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-lg bg-field px-3.5', className)} {...props} />
}

/** A settings row inside `GroupModalSection`: label on the left, the control on the right. */
export function GroupModalRow({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children?: ReactNode; className?: string }) {
  const LabelElement = htmlFor ? 'label' : 'span'
  return (
    <div className={cn('flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 last:border-b-0', className)}>
      <LabelElement htmlFor={htmlFor} className={cn('min-w-0 flex-1 text-sm font-medium text-foreground', htmlFor && 'cursor-pointer')}>{label}</LabelElement>
      {children ? <div className="flex min-w-0 max-w-full items-center justify-end gap-2">{children}</div> : null}
    </div>
  )
}

/** An on/off row; the label toggles it too. */
export function GroupModalSwitchRow({ label, checked, onCheckedChange, disabled = false, className }: {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <GroupModalRow label={label} htmlFor={id} className={className}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </GroupModalRow>
  )
}

/** Colour swatches: none, the presets, and a last one that opens the system picker for any other colour. */
export function GroupColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useI18n()
  const normalized = value.trim().toLowerCase()
  const isCustom = normalized !== '' && !GROUP_COLOR_PRESETS.includes(normalized)
  const swatchClass = 'size-5.5 shrink-0 cursor-pointer rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60'
  const pickedClass = 'ring-2 ring-foreground ring-offset-2 ring-offset-surface-low'

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t({ ko: '색 없음', en: 'No color' })}
        aria-pressed={!normalized}
        onClick={() => onChange('')}
        className={cn(swatchClass, 'border-[1.5px] border-dashed border-muted-foreground/50', !normalized && pickedClass)}
      />
      {GROUP_COLOR_PRESETS.map((preset) => (
        <Button
          key={preset}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={preset}
          aria-pressed={normalized === preset}
          onClick={() => onChange(preset)}
          className={cn(swatchClass, normalized === preset && pickedClass)}
          style={{ backgroundColor: preset }}
        />
      ))}
      <label
        title={t({ ko: '직접 고르기', en: 'Pick a color' })}
        className={cn(swatchClass, 'relative focus-within:ring-2 focus-within:ring-ring/60', isCustom && pickedClass)}
        style={isCustom ? { backgroundColor: normalized } : { backgroundImage: CUSTOM_SWATCH_GRADIENT }}
      >
        <input
          type="color"
          className="sr-only"
          aria-label={t({ ko: '직접 고르기', en: 'Pick a color' })}
          value={SIX_DIGIT_HEX.test(normalized) ? normalized : '#7c3aed'}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  )
}

/** Footer of a group modal: an optional left action, then Cancel (asks first when there are unsaved edits) and the main actions. */
export function GroupModalFooter({ start, busy = false, children }: { start?: ReactNode; busy?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  const requestClose = useModalRequestClose()
  return (
    <ModalFooter className="mt-5 flex-nowrap gap-1.5 border-t border-line pt-3">
      {start}
      <span className="flex-1" />
      <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>
        {t({ ko: '취소', en: 'Cancel' })}
      </Button>
      {children}
    </ModalFooter>
  )
}
