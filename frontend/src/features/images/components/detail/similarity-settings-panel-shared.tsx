import type { ComponentProps } from 'react'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

export function NumberInputWithSuffix({ suffix, ...props }: ComponentProps<typeof NumberStepperInput> & { suffix: string }) {
  return (
    <div className="flex items-center gap-2">
      <NumberStepperInput {...props} className="min-w-0 flex-1" />
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

export function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold text-foreground">{title}</h3>
}
