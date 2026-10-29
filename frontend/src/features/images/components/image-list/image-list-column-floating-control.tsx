import { useRef, useState } from 'react'
import { LayoutGrid, RotateCcw } from 'lucide-react'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface ImageListColumnFloatingControlProps {
  value: number
  defaultValue: number
  min?: number
  max?: number
  title?: string
  className?: string
  aboveSelectionBar?: boolean
  onChange: (value: number) => void
  onReset?: () => void
}

export function ImageListColumnFloatingControl({
  value,
  defaultValue,
  min = 1,
  max = 8,
  title,
  className,
  aboveSelectionBar = false,
  onChange,
  onReset,
}: ImageListColumnFloatingControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { t, formatNumber } = useI18n()
  const resolvedTitle = title ?? t({ ko: '목록 한 줄 개수 설정', en: 'Set list columns' })
  const options = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index)

  return (
    // Keeps clear of a docked chat panel (--chat-dock-width) on the right edge.
    <div ref={containerRef} className={cn('pointer-events-none fixed right-[calc(1rem+var(--chat-dock-width,0px))] z-50', aboveSelectionBar ? 'bottom-[calc(var(--shell-bottom-inset)+6rem)]' : 'bottom-[calc(var(--shell-bottom-inset)+1.5rem)]', className)}>
      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="top" closeOnBack>
        <div className={`w-[220px] space-y-3 ${anchoredPopupBodyClassName}`}>
          {onReset ? (
            <div className="flex justify-end">
              <IconButton
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  onReset()
                  setIsOpen(false)
                }}
                label={t({ ko: '기본값 {count}개로 되돌리기', en: 'Reset to default {count}' }, { count: formatNumber(defaultValue) })}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ) : null}

          <div className="grid grid-cols-4 gap-2">
            {options.map((option) => {
              const isActive = option === value
              return (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={isActive ? 'default' : 'secondary'}
                  onClick={() => {
                    onChange(option)
                    setIsOpen(false)
                  }}
                >
                  {option}
                </Button>
              )
            })}
          </div>
        </div>
      </AnchoredPopup>

      <Panel treatment="floating" padding="none" className="pointer-events-auto">
        <Tip content={resolvedTitle} side="left">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsOpen((current) => !current)}
            aria-label={resolvedTitle}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="text-xs font-semibold leading-none tabular-nums">{value}</span>
          </Button>
        </Tip>
      </Panel>
    </div>
  )
}
