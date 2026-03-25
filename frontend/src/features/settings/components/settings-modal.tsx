import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SettingsModalProps extends PropsWithChildren {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  widthClassName?: string
}

export function SettingsModal({ open, title, description, onClose, widthClassName = 'max-w-4xl', children }: SettingsModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      return
    }

    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [open])

  if (!open) {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/72 p-4 md:p-6" onMouseDown={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : '설정 모달'}
        className={`mx-auto flex max-h-full w-full flex-col overflow-y-auto rounded-sm border border-border bg-background shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${widthClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border/70 bg-background/95 px-5 py-4 backdrop-blur md:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>

          <Button type="button" size="icon-sm" variant="secondary" onClick={onClose} aria-label="닫기" title="닫기">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-5 md:px-6 md:py-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
