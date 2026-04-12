import type { ComponentProps } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'

export function NumberInputWithSuffix({ suffix, ...props }: ComponentProps<typeof ScrubbableNumberInput> & { suffix: string }) {
  return (
    <div className="relative">
      <ScrubbableNumberInput {...props} className="pr-8" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

export function SectionTitleWithTooltip({ title, tooltip }: { title: string; tooltip?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {tooltip ? (
        <span className="inline-flex text-muted-foreground" title={tooltip} aria-label={tooltip}>
          <CircleQuestionMark className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </div>
  )
}
