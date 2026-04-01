import { useRef, type ComponentProps } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { Input, inputVariants } from '@/components/ui/input'

function formatScrubbedNumber(value: number, step: number) {
  const precision = Math.max(0, ((`${step}`.split('.')[1] || '').length))
  return Number(value.toFixed(precision)).toString()
}

type ScrubbableNumberInputProps = {
  value: string | number
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  scrubRatio?: number
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'> & VariantProps<typeof inputVariants>

/** Render a number input that also supports left-right drag scrubbing. */
export function ScrubbableNumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  scrubRatio = 0.3,
  className,
  variant,
  ...props
}: ScrubbableNumberInputProps) {
  const dragStateRef = useRef<{ pointerId: number; startX: number; startValue: number; dragging: boolean } | null>(null)

  const clampValue = (nextValue: number) => {
    let result = nextValue
    if (typeof min === 'number') {
      result = Math.max(min, result)
    }
    if (typeof max === 'number') {
      result = Math.min(max, result)
    }
    return result
  }

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      variant={variant}
      className={className ?? 'cursor-ew-resize'}
      title="좌우로 드래그해서 값 조절"
      onChange={(event) => onChange(event.target.value)}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }

        dragStateRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: Number.parseFloat(String(value || '0')) || 0,
          dragging: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) {
          return
        }

        const deltaX = event.clientX - dragState.startX
        if (!dragState.dragging && Math.abs(deltaX) < 6) {
          return
        }

        dragState.dragging = true
        const nextValue = clampValue(dragState.startValue + deltaX * step * scrubRatio)
        onChange(formatScrubbedNumber(nextValue, step))
      }}
      onPointerUp={(event) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) {
          return
        }
        dragStateRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={(event) => {
        dragStateRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
    />
  )
}
