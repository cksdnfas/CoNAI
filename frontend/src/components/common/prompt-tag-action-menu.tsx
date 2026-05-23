import { useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { useI18n } from '@/i18n'
import { buildDanbooruTagUrl } from '@/lib/danbooru-tag-links'
import { cn } from '@/lib/utils'

interface PromptTagActionMenuProps {
  tag: string
  href?: string | null
  className?: string
  children?: ReactNode
  onAddSearchFilter?: (tag: string) => void
  onOpenHref?: (tag: string, href: string) => void
}

const tagActionItemClassName = 'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs font-medium text-foreground transition hover:bg-surface-high hover:text-primary'

/** Render a compact action menu for prompt-like tags. */
export function PromptTagActionMenu({
  tag,
  href,
  className,
  children,
  onAddSearchFilter,
  onOpenHref,
}: PromptTagActionMenuProps) {
  const { t } = useI18n()
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const resolvedHref = href === undefined ? buildDanbooruTagUrl(tag) : href
  const hasActions = Boolean(onAddSearchFilter || resolvedHref)

  if (!hasActions) {
    return <span className={className}>{children ?? tag}</span>
  }

  const handleAddSearchFilter = () => {
    onAddSearchFilter?.(tag)
    setOpen(false)
  }

  const handleOpenHref = () => {
    if (!resolvedHref) {
      return
    }

    if (onOpenHref) {
      onOpenHref(tag, resolvedHref)
    } else if (typeof window !== 'undefined') {
      window.open(resolvedHref, '_blank', 'noopener,noreferrer')
    }

    setOpen(false)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={className}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}
        title={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}
      >
        {children ?? tag}
      </button>

      <AnchoredPopup open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align="start" side="bottom" className="w-[min(15rem,calc(100vw-1.5rem))] p-0">
        <div className={cn(anchoredPopupBodyClassName, 'space-y-1 p-1.5')} role="menu" aria-label={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}>
          {onAddSearchFilter ? (
            <button
              type="button"
              className={tagActionItemClassName}
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                handleAddSearchFilter()
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t({ ko: 'add tag {tag}', en: 'add tag {tag}' }, { tag })}</span>
            </button>
          ) : null}

          {resolvedHref ? (
            <button
              type="button"
              className={tagActionItemClassName}
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenHref()
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span>{t({ ko: '웹서치', en: 'Web search' })}</span>
            </button>
          ) : null}
        </div>
      </AnchoredPopup>
    </>
  )
}
