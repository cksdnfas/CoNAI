import { useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
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

/** Tag chip look shared by the menu trigger and the plain (no-action) fallback. */
const tagChipClassName = 'h-auto min-h-6 py-1 whitespace-normal break-words text-left font-normal text-foreground'

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
    return <span className={cn('inline-flex rounded-sm bg-foreground/5 px-2 text-xs', tagChipClassName, className)}>{children ?? tag}</span>
  }

  const handleAddSearchFilter = () => {
    setOpen(false)
    onAddSearchFilter?.(tag)
  }

  const handleOpenHref = () => {
    if (!resolvedHref) {
      return
    }

    setOpen(false)

    if (onOpenHref) {
      onOpenHref(tag, resolvedHref)
    } else if (typeof window !== 'undefined') {
      window.open(resolvedHref, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <>
      <Tip content={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}>
        <Button
          ref={anchorRef}
          type="button"
          variant="subtle"
          size="xs"
          className={cn(tagChipClassName, className)}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((current) => !current)
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}
        >
          {children ?? tag}
        </Button>
      </Tip>

      <AnchoredPopup open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align="start" side="bottom" className="w-[min(15rem,calc(100vw-1.5rem))] p-0">
        <div className={cn(anchoredPopupBodyClassName, 'space-y-1 p-1.5')} role="menu" aria-label={t({ ko: '{tag} 태그 작업', en: '{tag} tag actions' }, { tag })}>
          {onAddSearchFilter ? (
            <Button
              type="button"
              variant="nav"
              size="sm"
              className="text-xs"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                handleAddSearchFilter()
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t({ ko: '검색에 {tag} 추가', en: 'Add {tag} to search' }, { tag })}</span>
            </Button>
          ) : null}

          {resolvedHref ? (
            <Button
              type="button"
              variant="nav"
              size="sm"
              className="text-xs"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenHref()
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span>{t({ ko: '웹서치', en: 'Web search' })}</span>
            </Button>
          ) : null}
        </div>
      </AnchoredPopup>
    </>
  )
}
