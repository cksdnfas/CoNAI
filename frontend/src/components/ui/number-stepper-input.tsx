import * as React from 'react'
import { Minus, Plus } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'
import { Button } from '@/components/ui/button'
import { Input, inputVariants } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type NumberStepperInputProps = {
  value: string | number | null | undefined
  min?: number | string
  max?: number | string
  step?: number | string
  precision?: number
  allowEmpty?: boolean
  onValueCommit?: (value: string) => void
  onValidPreview?: (value: number) => void
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'>
  & VariantProps<typeof inputVariants>

function toFiniteNumber(value: number | string | undefined) {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function decimalPlaces(value: number) {
  const [, fraction = ''] = String(value).toLowerCase().split('e')
  const exponent = Number(fraction || 0)
  const decimalLength = (String(value).split('.')[1] || '').length
  return Math.max(0, decimalLength - exponent)
}

/** A mobile-safe numeric input that commits only after editing finishes. */
export function NumberStepperInput({
  value,
  min,
  max,
  step = 1,
  precision,
  allowEmpty = false,
  onValueCommit,
  onValidPreview,
  className,
  variant,
  disabled,
  inputMode,
  onBlur,
  onFocus,
  onKeyDown,
  'aria-label': ariaLabel,
  ...props
}: NumberStepperInputProps) {
  const { t } = useI18n()
  const externalValue = value == null ? '' : String(value)
  const [draft, setDraft] = React.useState(externalValue)
  const [invalid, setInvalid] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const focusedRef = React.useRef(false)
  const lastCommittedRef = React.useRef(externalValue)
  const minValue = toFiniteNumber(min)
  const maxValue = toFiniteNumber(max)
  const parsedStep = toFiniteNumber(step)
  const stepValue = parsedStep && parsedStep > 0 ? parsedStep : 1
  const stepPrecision = precision ?? decimalPlaces(stepValue)

  React.useEffect(() => {
    lastCommittedRef.current = externalValue
    if (!focusedRef.current) {
      setDraft(externalValue)
      setInvalid(false)
    }
  }, [externalValue])

  const clamp = React.useCallback((nextValue: number) => {
    let result = nextValue
    if (minValue !== undefined) result = Math.max(minValue, result)
    if (maxValue !== undefined) result = Math.min(maxValue, result)
    return result
  }, [maxValue, minValue])

  const format = React.useCallback((nextValue: number, useStepPrecision = false) => {
    const digits = useStepPrecision ? stepPrecision : precision
    return digits === undefined
      ? String(nextValue)
      : Number(nextValue.toFixed(Math.max(0, digits))).toString()
  }, [precision, stepPrecision])

  const emitCommit = React.useCallback((nextValue: string) => {
    lastCommittedRef.current = nextValue
    onValueCommit?.(nextValue)
  }, [onValueCommit])

  const commitDraft = React.useCallback((candidate = draft) => {
    const trimmed = candidate.trim()
    if (trimmed === '' && allowEmpty) {
      setDraft('')
      setInvalid(false)
      emitCommit('')
      return
    }

    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isFinite(parsed)) {
      setDraft(lastCommittedRef.current)
      setInvalid(trimmed !== '')
      return
    }

    const normalized = format(clamp(parsed))
    setDraft(normalized)
    setInvalid(false)
    emitCommit(normalized)
  }, [allowEmpty, clamp, draft, emitCommit, format])

  const stepBy = React.useCallback((direction: -1 | 1) => {
    const draftValue = Number(draft)
    const committedValue = Number(lastCommittedRef.current)
    const base = Number.isFinite(draftValue) && draft.trim() !== ''
      ? draftValue
      : Number.isFinite(committedValue) && lastCommittedRef.current.trim() !== ''
        ? committedValue
        : minValue ?? 0
    const normalized = format(clamp(base + direction * stepValue), true)
    setDraft(normalized)
    setInvalid(false)
    emitCommit(normalized)
    inputRef.current?.focus({ preventScroll: true })
  }, [clamp, draft, emitCommit, format, minValue, stepValue])

  const currentNumber = draft.trim() === '' ? Number.NaN : Number(draft)
  const decreaseDisabled = disabled || (Number.isFinite(currentNumber) && minValue !== undefined && currentNumber <= minValue)
  const increaseDisabled = disabled || (Number.isFinite(currentNumber) && maxValue !== undefined && currentNumber >= maxValue)
  const fieldLabel = ariaLabel || props.name || t({ ko: '숫자 값', en: 'Numeric value' })

  return (
    <div
      data-slot="number-stepper-input"
      className={cn('inline-flex min-h-11 min-w-32 w-full items-stretch sm:min-h-9', className, 'p-0')}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-auto min-h-11 min-w-11 rounded-r-none border-r-0 p-0 sm:min-h-9 sm:min-w-9"
        aria-label={t({ ko: `${fieldLabel} 감소`, en: `Decrease ${fieldLabel}` })}
        disabled={decreaseDisabled}
        onClick={() => stepBy(-1)}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Input
        {...props}
        ref={inputRef}
        type="text"
        inputMode={inputMode ?? (stepPrecision === 0 && minValue !== undefined && minValue >= 0 ? 'numeric' : 'decimal')}
        value={draft}
        variant={variant}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || props['aria-invalid']}
        className="h-auto min-h-11 min-w-0 flex-1 rounded-none text-center tabular-nums sm:min-h-9"
        onChange={(event) => {
          const nextDraft = event.target.value
          setDraft(nextDraft)
          setInvalid(false)
          const preview = Number(nextDraft)
          if (nextDraft.trim() !== '' && Number.isFinite(preview)) onValidPreview?.(preview)
        }}
        onFocus={(event) => {
          focusedRef.current = true
          onFocus?.(event)
        }}
        onBlur={(event) => {
          focusedRef.current = false
          commitDraft(event.currentTarget.value)
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(lastCommittedRef.current)
            setInvalid(false)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            stepBy(-1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            stepBy(1)
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-auto min-h-11 min-w-11 rounded-l-none border-l-0 p-0 sm:min-h-9 sm:min-w-9"
        aria-label={t({ ko: `${fieldLabel} 증가`, en: `Increase ${fieldLabel}` })}
        disabled={increaseDisabled}
        onClick={() => stepBy(1)}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
}
