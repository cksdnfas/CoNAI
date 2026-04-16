import type { ComponentProps, RefObject } from 'react'
import { useRef, useState } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
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

function SectionTooltip({ anchorRef, title, description }: { anchorRef: RefObject<HTMLButtonElement | null>; title: string; description: string }) {
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const isOpen = isAnchorHovered || isPopupHovered

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
        aria-label={`${title} 설명 보기`}
        onMouseEnter={() => setIsAnchorHovered(true)}
        onMouseLeave={() => setIsAnchorHovered(false)}
        onFocus={() => setIsAnchorHovered(true)}
        onBlur={() => {
          setIsAnchorHovered(false)
          setIsPopupHovered(false)
        }}
      >
        <CircleQuestionMark className="h-3.5 w-3.5" />
      </button>
      <AnchoredPopup
        open={isOpen}
        anchorRef={anchorRef}
        align="center"
        side="bottom"
        className="w-[min(280px,calc(100vw-1.5rem))] px-3 py-2.5"
        surfaceProps={{
          onMouseEnter: () => setIsPopupHovered(true),
          onMouseLeave: () => setIsPopupHovered(false),
        }}
      >
        <div className="space-y-1">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</div>
          <div className="text-[12px] leading-5 text-foreground/92">{description}</div>
        </div>
      </AnchoredPopup>
    </>
  )
}

export function SectionTitleWithTooltip({ title, tooltip }: { title: string; tooltip?: string }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {tooltip ? <SectionTooltip anchorRef={anchorRef} title={title} description={tooltip} /> : null}
    </div>
  )
}
