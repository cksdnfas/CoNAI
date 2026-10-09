import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { FieldInfo } from './field'
import { IconButton } from './icon-button'

export interface EditorNavItem {
  id: string
  label: ReactNode
  /** On/off dot before the label; an off item reads muted. Left out: no dot (a plain section). */
  state?: 'on' | 'off'
  /** Small text or a count after the label. */
  trailing?: ReactNode
}

export interface EditorNavGroup {
  id: string
  /** Overline above the group's rows. */
  label?: ReactNode
  /** Icon buttons at the overline's right (add…). */
  actions?: ReactNode
  items: EditorNavItem[]
}

/**
 * A wide editor's body: a list of sections on the left and the picked one on the right. On a phone the list shows
 * first and a pick replaces it with the section (a back button returns), so the caller keeps `showingList`.
 */
export function EditorSplit({ groups, current, onSelect, showingList, onShowList, navLabel, children }: {
  groups: EditorNavGroup[]
  current: string
  onSelect: (id: string) => void
  showingList: boolean
  onShowList: () => void
  navLabel: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const offLabel = t({ ko: '꺼짐', en: 'Off' })
  return (
    <div className="grid gap-x-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label={navLabel} className={cn('self-start md:sticky md:top-0', !showingList && 'max-md:hidden')}>
        {groups.map((group) => (
          <div key={group.id} className="mt-4 first:mt-0">
            {group.label || group.actions ? (
              <div className="flex min-h-8 items-center gap-2 pl-2.5">
                <span className="min-w-0 flex-1 truncate text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{group.label}</span>
                {group.actions}
              </div>
            ) : null}
            <ul className="space-y-0.5 max-md:divide-y max-md:divide-line">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={item.id === current ? 'page' : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 max-md:min-h-12 md:min-h-9 [&_svg]:size-4',
                      item.id === current ? 'md:bg-fill md:font-semibold md:text-foreground' : 'text-muted-foreground hover:bg-fill hover:text-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', item.state === 'on' && 'bg-primary', item.state === 'off' && 'ring-1 ring-muted-foreground/60 ring-inset')}
                    />
                    <span className={cn('min-w-0 flex-1 truncate', item.state === 'off' && 'opacity-70')}>{item.label}</span>
                    {item.state === 'off' ? <span className="sr-only">{offLabel}</span> : null}
                    {item.trailing ? <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground">{item.trailing}</span> : null}
                    <ChevronRight className="shrink-0 text-muted-foreground md:hidden" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('min-w-0', showingList && 'max-md:hidden')}>
        <div className="mb-1 md:hidden">
          <IconButton size="icon-sm" variant="ghost" onClick={onShowList} label={t({ ko: '목록', en: 'List' })}><ChevronLeft /></IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

/** The title row of the section shown in an `EditorSplit`, with its own controls (on switch, delete…) at the right. */
export function EditorPaneHeader({ title, info, actions }: { title: ReactNode; info?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-9 items-center gap-2">
      <h3 className="flex min-w-0 flex-1 items-center gap-1 text-base font-semibold tracking-tight">
        <span className="truncate">{title}</span>
        {info ? <FieldInfo>{info}</FieldInfo> : null}
      </h3>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}
