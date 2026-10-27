import { useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { SidebarItem } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import { hasOpenDialog } from '@/lib/keyboard-shortcut'
import { cn } from '@/lib/utils'
import { PageToolbar } from './page-toolbar'
import { PageWithSidebar } from './page-with-sidebar'
import { PathBreadcrumbs, type PathCrumb } from './path-breadcrumbs'

/** One entry of an editor's section list: its icon and name. */
export type EditorSectionEntry<T extends string> = {
  value: T
  label: string
  icon: ComponentType<{ className?: string }>
  /** A dot or mark at the right (input needed, filled by the assistant). */
  mark?: ReactNode
  disabled?: boolean
}

/** The page heading as a field: the name is edited in place (a new item starts empty, showing its placeholder). */
export function EditorTitleInput({ value, onChange, label, placeholder, maxLength, readOnly = false, invalid = false }: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  maxLength?: number
  readOnly?: boolean
  invalid?: boolean
}) {
  return (
    <h1 className="flex min-w-0 flex-1 basis-56">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={readOnly}
        className={cn(
          '-mx-1.5 w-full min-w-0 rounded-sm bg-transparent px-1.5 py-0.5 text-xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60',
          !readOnly && 'hover:bg-fill focus-visible:bg-fill focus-visible:ring-2 focus-visible:ring-ring/40',
          'aria-invalid:ring-2 aria-invalid:ring-destructive/40',
        )}
      />
    </h1>
  )
}

/** The section list of an editor page: icon and name, with a mark where input is needed. */
export function EditorSectionNav<T extends string>({ sections, value, onChange, label, header }: {
  sections: Array<EditorSectionEntry<T>>
  value: T
  onChange: (value: T) => void
  label: string
  /** Above the list (the item's avatar and name). */
  header?: ReactNode
}) {
  return (
    <nav aria-label={label} className="space-y-3">
      {header}
      <ul className="space-y-0.5">
        {sections.map((entry) => (
          <li key={entry.value}>
            <SidebarItem
              active={entry.value === value}
              disabled={entry.disabled}
              onClick={() => onChange(entry.value)}
              icon={entry.icon}
              label={entry.label}
              trailing={entry.mark}
            />
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * A page that edits one thing (a popup grown too big): the way back as a path, the title row with its state chips and
 * actions, the editor itself, and the save bar that floats up while there are changes. With `nav` the editor's
 * sections sit in the page's left column (a drawer on a phone). Ctrl/⌘ S saves while no dialog is open over it.
 * Leaving with unsaved changes is guarded by the caller (useUnsavedSettingsGuard), which knows its own address.
 */
export function EditorPage({ crumbs, title, status, actions, nav, navLabel, storageKey, onSave, saveBar, children }: {
  /** The places above this one, top first; the back arrow returns to the last. */
  crumbs: PathCrumb[]
  /** Text becomes the page heading; a node (an editable name) brings its own. */
  title: ReactNode
  status?: ReactNode
  actions?: ReactNode
  nav?: ReactNode
  navLabel?: string
  /** Remembers the section column's collapsed state (with `nav`). */
  storageKey?: string
  onSave?: () => void
  saveBar?: ReactNode
  children: ReactNode
}) {
  const { t } = useI18n()
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const canSave = Boolean(onSave)
  useEffect(() => {
    if (!canSave) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.key.toLowerCase() !== 's' && event.code !== 'KeyS')) return
      // A dialog over the page saves (or ignores) the shortcut itself.
      if (event.defaultPrevented || hasOpenDialog()) return
      event.preventDefault()
      if (!event.repeat) saveRef.current?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canSave])

  const back = crumbs[crumbs.length - 1]
  const toolbar = (
    <PageToolbar
      start={(
        <div className="flex min-w-0 items-center gap-1">
          {back ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '{place}(으)로 돌아가기', en: 'Back to {place}' }, { place: back.label })} onClick={back.onClick}><ArrowLeft /></IconButton> : null}
          <PathBreadcrumbs items={crumbs} ariaLabel={t({ ko: '경로', en: 'Path' })} />
        </div>
      )}
    />
  )
  const body = (
    <div className={cn('w-full space-y-6', nav ? 'max-w-4xl' : 'mx-auto max-w-6xl')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          {typeof title === 'string' ? <h1 className="min-w-0 text-xl font-bold tracking-tight text-foreground">{title}</h1> : title}
          {status}
        </div>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
      {saveBar}
    </div>
  )
  if (nav) {
    return (
      <PageWithSidebar storageKey={storageKey ?? 'editor'} sidebarLabel={navLabel ?? t({ ko: '편집 항목', en: 'Sections' })} sidebar={nav} toolbar={toolbar}>
        {body}
      </PageWithSidebar>
    )
  }
  return <div>{toolbar}{body}</div>
}
