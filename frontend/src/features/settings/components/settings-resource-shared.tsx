import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { Check, FolderCheck, FolderPlus, LoaderCircle, Minus, Save, Settings2, Trash2 } from 'lucide-react'
import { SegmentedControl, type SegmentedControlItem } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

type SettingsBadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>
export type SettingsStatusTone = 'default' | 'muted' | 'danger'

export interface SettingsResourceBadge {
  label: ReactNode
  variant?: SettingsBadgeVariant
}

export interface SettingsResourceAction {
  label: string
  title: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}

/** Return a consistent badge variant for watcher status surfaces. */
export function getWatcherBadgeVariant(watcherState?: string | null): SettingsBadgeVariant {
  if (!watcherState) {
    return 'secondary'
  }

  const normalized = watcherState.toLowerCase()
  if (normalized === 'watching') {
    return 'default'
  }
  if (normalized === 'error') {
    return 'destructive'
  }
  return 'outline'
}

type TranslateFn = ReturnType<typeof useI18n>['t']

/** Turn a raw watcher runtime state into a user-facing status label. */
export function getWatcherStateLabel(watcherState: string | null | undefined, t: TranslateFn): string {
  switch ((watcherState || 'stopped').toLowerCase()) {
    case 'watching':
      return t({ ko: '실시간 감시 중', en: 'Watching for changes' })
    case 'initializing':
      return t({ ko: '감시 준비 중', en: 'Starting watcher' })
    case 'error':
      return t({ ko: '감시 오류', en: 'Watcher error' })
    default:
      return t({ ko: '실시간 감시 꺼짐', en: 'Not watching' })
  }
}

/** Turn a raw scan log status into a user-facing label. */
export function getScanStatusLabel(status: string | null | undefined, t: TranslateFn): string {
  switch ((status || '').toLowerCase()) {
    case 'success':
      return t({ ko: '완료', en: 'Completed' })
    case 'error':
      return t({ ko: '오류 있음', en: 'Completed with errors' })
    case 'in_progress':
      return t({ ko: '진행 중', en: 'In progress' })
    case '':
      return '—'
    default:
      return status || '—'
  }
}

/** Map watcher states to a compact icon tone for table cells. */
export function getWatcherStatusTone(watcherState?: string | null): SettingsStatusTone {
  if (!watcherState) {
    return 'muted'
  }

  const normalized = watcherState.toLowerCase()
  if (normalized === 'watching') {
    return 'default'
  }
  if (normalized === 'error') {
    return 'danger'
  }
  return 'muted'
}

interface SettingsStatusIconProps {
  checked?: boolean
  tone?: SettingsStatusTone
  title?: string
}

/** Render a dense boolean/status cell for settings tables. */
export function SettingsStatusIcon({ checked = false, tone = 'muted', title }: SettingsStatusIconProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-sm',
        tone === 'danger'
          ? 'bg-destructive-soft text-destructive-soft-foreground'
          : checked
            ? 'bg-primary/12 text-primary'
            : 'bg-foreground/5 text-muted-foreground',
      )}
      title={title}
      aria-label={title}
    >
      {checked ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
    </span>
  )
}

/** Container width below which a stackable table turns each row into a card. */
export type SettingsResourceStackBreakpoint = '3xl' | '4xl'

// Literal class strings per breakpoint so Tailwind can see them.
const STACK_CLASSES: Record<SettingsResourceStackBreakpoint, { header: string; row: string; wide: string; hideWide: string; centerWide: string }> = {
  '3xl': { header: 'hidden @3xl:grid', row: '@3xl:grid @3xl:gap-3', wide: '@3xl:basis-auto', hideWide: '@3xl:hidden', centerWide: '@3xl:justify-center' },
  '4xl': { header: 'hidden @4xl:grid', row: '@4xl:grid @4xl:gap-3', wide: '@4xl:basis-auto', hideWide: '@4xl:hidden', centerWide: '@4xl:justify-center' },
}

interface ResourceTableLayout {
  headers: ReactNode[]
  stackBelow: SettingsResourceStackBreakpoint
}

const ResourceTableLayoutContext = createContext<ResourceTableLayout | null>(null)

interface SettingsResourceTableProps {
  gridClassName: string
  minWidthClassName?: string
  headers: ReactNode[]
  children: ReactNode
  /**
   * Stack rows as labelled cards when the table's own width is below this container breakpoint.
   * `gridClassName` must then carry the same container prefix (e.g. `@3xl:grid-cols-[…]`).
   */
  stackBelow?: SettingsResourceStackBreakpoint
}

interface SettingsSegmentedTableProps {
  value: string
  items: SegmentedControlItem[]
  onChange: (value: string) => void
  gridClassName: string
  headers: ReactNode[]
  children: ReactNode
  count?: ReactNode
  actions?: ReactNode
  minWidthClassName?: string
  className?: string
  size?: 'xs' | 'sm' | 'md'
}

/** Render a horizontally-scrollable DB-like settings table shell. */
export function SettingsResourceTable({
  gridClassName,
  minWidthClassName = 'min-w-[880px]',
  headers,
  children,
  stackBelow,
}: SettingsResourceTableProps) {
  if (stackBelow) {
    const stack = STACK_CLASSES[stackBelow]
    return (
      <ResourceTableLayoutContext.Provider value={{ headers, stackBelow }}>
        <div className="@container">
          <div
            className={cn(
              stack.header,
              'gap-3 border-b border-outline-subtle px-4 py-2.5 text-2xs font-semibold uppercase tracking-overline text-muted-foreground',
              gridClassName,
            )}
          >
            {headers.map((header, index) => (
              <div key={index} className={cn(index >= headers.length - 3 ? 'text-center' : 'min-w-0')}>
                {header}
              </div>
            ))}
          </div>
          <div className="divide-y divide-outline-subtle">{children}</div>
        </div>
      </ResourceTableLayoutContext.Provider>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className={cn(minWidthClassName, 'w-full')}>
        <div
          className={cn(
            'grid border-b border-outline-subtle px-4 py-2.5 text-2xs font-semibold uppercase tracking-overline text-muted-foreground',
            gridClassName,
          )}
        >
          {headers.map((header, index) => (
            <div key={index} className={cn(index >= headers.length - 3 ? 'text-center' : 'min-w-0')}>
              {header}
            </div>
          ))}
        </div>
        <div className="divide-y divide-outline-subtle">{children}</div>
      </div>
    </div>
  )
}

/** Render one shared settings-style segmented table shell with a tab header and DB-like body. */
export function SettingsSegmentedTable({
  value,
  items,
  onChange,
  gridClassName,
  headers,
  children,
  count,
  actions,
  minWidthClassName = 'min-w-[880px]',
  className,
  size = 'xs',
}: SettingsSegmentedTableProps) {
  return (
    <div className={cn('overflow-hidden rounded-sm bg-surface-lowest', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <SegmentedControl value={value} items={items} onChange={onChange} size={size} />
        {count || actions ? (
          <div className="flex items-center gap-2">
            {count}
            {actions}
          </div>
        ) : null}
      </div>

      <SettingsResourceTable gridClassName={gridClassName} minWidthClassName={minWidthClassName} headers={headers}>
        {children}
      </SettingsResourceTable>
    </div>
  )
}

interface SettingsResourceStackedCellsProps {
  gridClassName: string
  cells: ReactNode[]
  /** Cells from this index on are short values: labelled with their header and laid out inline when stacked. */
  labelledFrom: number
  className?: string
  trailing?: ReactNode
}

/**
 * Render one table row that becomes a card inside a stackable SettingsResourceTable:
 * leading cells take full width, later cells show their column header as a label.
 */
export function SettingsResourceStackedCells({ gridClassName, cells, labelledFrom, className, trailing }: SettingsResourceStackedCellsProps) {
  const layout = useContext(ResourceTableLayoutContext)

  if (!layout) {
    return (
      <div className={cn('grid items-center px-4 py-3', gridClassName, className)}>
        {cells.map((cell, index) => (
          <div key={index} className={cn(index >= labelledFrom ? 'flex justify-center' : 'min-w-0')}>
            {cell}
          </div>
        ))}
        {trailing}
      </div>
    )
  }

  const stack = STACK_CLASSES[layout.stackBelow]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', stack.row, 'items-center', gridClassName, className)}>
      {cells.map((cell, index) => (
        index >= labelledFrom ? (
          <div key={index} className={cn('flex items-center gap-2', stack.centerWide)}>
            <span className={cn('text-xs text-muted-foreground', stack.hideWide)}>{layout.headers[index]}</span>
            {cell}
          </div>
        ) : (
          <div key={index} className={cn('min-w-0 basis-full', stack.wide)}>
            {cell}
          </div>
        )
      ))}
      {trailing}
    </div>
  )
}

interface SettingsResourceTableRowProps {
  gridClassName: string
  cells: ReactNode[]
  selected?: boolean
  onOpenOptions: () => void
}

/** Render a shared row for settings resource tables. */
export function SettingsResourceTableRow({
  gridClassName,
  cells,
  selected = false,
  onOpenOptions,
}: SettingsResourceTableRowProps) {
  const { t } = useI18n()

  return (
    <SettingsResourceStackedCells
      gridClassName={gridClassName}
      cells={cells}
      labelledFrom={cells.length - 2}
      className={cn(
        'transition-colors',
        selected
          ? 'bg-primary/8 ring-1 ring-inset ring-primary/20'
          : 'bg-transparent hover:bg-surface-high/60',
      )}
      trailing={(
        <div className="ml-auto flex justify-end">
          <IconButton
            size="icon-sm"
            variant={selected ? 'default' : 'ghost'}
            label={t({ ko: '상세 정보와 수정 열기', en: 'Open details and editing' })}
            onClick={onOpenOptions}
          >
            <Settings2 className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    />
  )
}

interface SettingsResourceCreateActionRowProps {
  validationMessage?: ReactNode | null
  canValidate: boolean
  isValidating: boolean
  validateLabel: string
  onValidate: () => void
  canSubmit: boolean
  isSubmitting: boolean
  submitLabel: ReactNode
  onSubmit: () => void
}

/** Render shared create-form actions for validation and submit flows. */
export function SettingsResourceCreateActionRow({
  validationMessage,
  canValidate,
  isValidating,
  validateLabel,
  onValidate,
  canSubmit,
  isSubmitting,
  submitLabel,
  onSubmit,
}: SettingsResourceCreateActionRowProps) {
  return (
    <>
      {validationMessage ? <p className="text-sm text-primary">{validationMessage}</p> : null}

      <div className="flex flex-wrap justify-between gap-2">
        <IconButton size="icon-sm" variant="secondary" disabled={!canValidate || isValidating} onClick={onValidate} label={validateLabel}>
          {isValidating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderCheck className="h-4 w-4" />}
        </IconButton>

        <Button type="button" size="sm" disabled={!canSubmit || isSubmitting} onClick={onSubmit}>
          {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>
    </>
  )
}

interface SettingsResourceMetaListProps {
  items: Array<{ label: ReactNode; value: ReactNode }>
}

/** Render shared metadata rows for settings resource detail cards. */
export function SettingsResourceMetaList({ items }: SettingsResourceMetaListProps) {
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={index}>
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  )
}

interface SettingsResourceFooterActionsProps {
  dangerLabel: string
  onDanger: () => void
  dangerDisabled?: boolean
  primaryLabel: ReactNode
  onPrimary: () => void
  primaryDisabled?: boolean
}

/** Render shared footer actions for destructive and primary settings card actions. */
export function SettingsResourceFooterActions({
  dangerLabel,
  onDanger,
  dangerDisabled = false,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
}: SettingsResourceFooterActionsProps) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap justify-between gap-2">
      <IconButton size="icon-sm" variant="secondary" className="text-destructive" disabled={dangerDisabled} onClick={onDanger} label={dangerLabel}>
        <Trash2 className="h-4 w-4" />
      </IconButton>

      <Button size="sm" disabled={primaryDisabled} onClick={onPrimary}>
        {primaryDisabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {primaryLabel ?? t({ ko: '저장', en: 'Save' })}
      </Button>
    </div>
  )
}
