import { useRef, useState } from 'react'
import { LayoutGrid, RotateCcw } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ImageListColumnFloatingControlProps {
  value: number
  defaultValue: number
  min?: number
  max?: number
  title?: string
  className?: string
  onChange: (value: number) => void
  onReset?: () => void
}

export function ImageListColumnFloatingControl({
  value,
  defaultValue,
  min = 1,
  max = 8,
  title = '한 줄 카드 수',
  className,
  onChange,
  onReset,
}: ImageListColumnFloatingControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const options = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index)

  return (
    <div ref={containerRef} className={cn('pointer-events-none fixed bottom-6 right-4 z-50', className)}>
      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="top" closeOnBack>
        <div className="w-[220px] space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-foreground">{title}</div>
              <div className="text-[11px] text-muted-foreground">현재 {value}개</div>
            </div>
            {onReset ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  onReset()
                  setIsOpen(false)
                }}
                aria-label="기본값으로 되돌리기"
                title={`기본값 ${defaultValue}개로 되돌리기`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {options.map((option) => {
              const isActive = option === value
              return (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                  className="h-8 px-0"
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

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="theme-floating-panel pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/92 px-3 py-2 text-sm text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm transition hover:bg-surface-high"
        aria-label="목록 한 줄 개수 설정"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="목록 한 줄 개수 설정"
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="text-xs font-semibold leading-none">{value}</span>
      </button>
    </div>
  )
}
