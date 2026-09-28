import type { ComponentProps, RefObject } from 'react'
import { useRef, useState } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'

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

function SectionTooltip({ anchorRef, title, description }: { anchorRef: RefObject<HTMLButtonElement | null>; title: string; description: string }) {
  const { t } = useI18n()
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const isOpen = isAnchorHovered || isPopupHovered

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t({ ko: '{title} 설명 보기', en: 'View {title} description' }, { title })}
        onMouseEnter={() => setIsAnchorHovered(true)}
        onMouseLeave={() => setIsAnchorHovered(false)}
        onFocus={() => setIsAnchorHovered(true)}
        onBlur={() => {
          setIsAnchorHovered(false)
          setIsPopupHovered(false)
        }}
      >
        <CircleQuestionMark className="h-3.5 w-3.5" />
      </Button>
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
          <Text as="div" variant="overline" className="font-semibold">{title}</Text>
          <div className="text-xs leading-5 text-foreground">{description}</div>
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
