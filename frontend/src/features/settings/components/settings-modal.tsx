import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'

interface SettingsModalProps extends PropsWithChildren {
  open: boolean
  title: ReactNode
  description?: ReactNode
  headerContent?: ReactNode
  onClose: () => void
  widthClassName?: string
}

export function SettingsModal({ open, title, description, headerContent, onClose, widthClassName = 'max-w-4xl', children }: SettingsModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useOverlayBackClose({ open, onClose })

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
    <div className="fixed inset-0 z-[6000] bg-black/78 p-3 sm:p-4 md:p-6" onMouseDown={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : '설정 모달'}
        className={`mx-auto flex max-h-full w-full flex-col overflow-y-auto rounded-sm border border-border/85 bg-background shadow-[0_24px_80px_rgba(0,0,0,0.48)] ${widthClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border/70 bg-background/96 px-4 py-3 backdrop-blur md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h2>
              {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
            </div>

            <Button type="button" size="icon-sm" variant="secondary" className="shrink-0" onClick={onClose} aria-label="닫기" title="닫기">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {headerContent ? <div className="mt-3 border-t border-border/70 pt-3">{headerContent}</div> : null}
        </div>

        <div className="px-4 py-4 md:px-5 md:py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
