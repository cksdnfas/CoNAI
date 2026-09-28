import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'

interface SettingsLabelTipProps {
  label: ReactNode
  /** Kept for the few settings where a wrong value can hurt; everything else goes without. */
  tip: string
}

/** A field label with a small info icon whose tooltip carries the one caveat worth knowing. */
export function SettingsLabelTip({ label, tip }: SettingsLabelTipProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{label}</span>
      <Tip content={tip}>
        <span tabIndex={0} aria-label={tip} className="inline-flex shrink-0 cursor-help text-muted-foreground normal-case">
          <Info className="h-3.5 w-3.5" aria-hidden />
        </span>
      </Tip>
    </span>
  )
}
