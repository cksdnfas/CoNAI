import type { ComponentProps, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

interface SectionTooltipPosition {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
}

function SectionTooltip({ anchorRef, title, description }: { anchorRef: RefObject<HTMLButtonElement | null>; title: string; description: string }) {
  const [isAnchorHovered, setIsAnchorHovered] = useState(false)
  const [isPopupHovered, setIsPopupHovered] = useState(false)
  const [position, setPosition] = useState<SectionTooltipPosition | null>(null)
  const isOpen = isAnchorHovered || isPopupHovered

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }

      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const popupGap = 8
      const popupWidth = Math.min(280, window.innerWidth - viewportPadding * 2)
      const estimatedPopupHeight = 88
      const shouldOpenAbove = rect.bottom + popupGap + estimatedPopupHeight > window.innerHeight - viewportPadding && rect.top > estimatedPopupHeight + popupGap

      let left = rect.left + rect.width / 2 - popupWidth / 2
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding - popupWidth))

      setPosition({
        top: shouldOpenAbove ? rect.top - popupGap : rect.bottom + popupGap,
        left,
        width: popupWidth,
        placement: shouldOpenAbove ? 'top' : 'bottom',
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, isOpen])

  const popup = isOpen && position && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="z-[140] rounded-sm border border-border bg-background/97 px-3 py-2.5 shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-sm"
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          width: position.width,
          transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
        }}
        onMouseEnter={() => setIsPopupHovered(true)}
        onMouseLeave={() => setIsPopupHovered(false)}
      >
        <div className="space-y-1">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</div>
          <div className="text-[12px] leading-5 text-foreground/92">{description}</div>
        </div>
      </div>,
      document.body,
    )
    : null

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
      {popup}
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
