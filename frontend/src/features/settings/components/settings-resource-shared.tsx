import type { ComponentProps, ReactNode } from 'react'
import { Check, FolderPlus, LoaderCircle, Minus, Save, Settings2 } from 'lucide-react'
import { SegmentedControl, type SegmentedControlItem } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
        'inline-flex h-7 w-7 items-center justify-center rounded-sm border',
        tone === 'danger'
          ? 'border-destructive/35 bg-destructive/10 text-destructive'
          : checked
            ? 'border-primary/35 bg-primary/10 text-primary'
            : 'border-border/70 bg-surface-low/60 text-muted-foreground',
      )}
      title={title}
      aria-label={title}
    >
      {checked ? <Check className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
    </span>
  )
}

interface SettingsResourceTableProps {
  gridClassName: string
  minWidthClassName?: string
  headers: ReactNode[]
  children: ReactNode
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
}: SettingsResourceTableProps) {
  return (
    <div className="overflow-x-auto">
      <div className={cn(minWidthClassName, 'w-full')}>
        <div
          className={cn(
            'grid border-b border-border/70 bg-surface-low/55 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground',
            gridClassName,
          )}
        >
          {headers.map((header, index) => (
            <div key={index} className={cn(index >= headers.length - 3 ? 'text-center' : 'min-w-0')}>
              {header}
            </div>
          ))}
        </div>
        <div className="divide-y divide-border/60">{children}</div>
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
    <div className={cn('overflow-hidden rounded-sm border border-border/85 bg-surface-container/30', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/85 px-4 py-3">
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
  return (
    <div
      className={cn(
        'grid items-center px-4 py-3 transition-colors',
        gridClassName,
        selected
          ? 'bg-primary/6 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]'
          : 'bg-transparent hover:bg-surface-high/60',
      )}
    >
      {cells.map((cell, index) => (
        <div key={index} className={cn(index >= cells.length - 2 ? 'flex justify-center' : 'min-w-0')}>
          {cell}
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          type="button"
          size="icon-sm"
          variant={selected ? 'default' : 'ghost'}
          title="상세 정보와 수정 열기"
          aria-label="상세 정보와 수정 열기"
          onClick={onOpenOptions}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

interface SettingsResourceCreateActionRowProps {
  validationMessage?: ReactNode | null
  canValidate: boolean
  isValidating: boolean
  validateLabel: ReactNode
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
        <Button type="button" size="sm" variant="outline" disabled={!canValidate || isValidating} onClick={onValidate}>
          {isValidating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {validateLabel}
        </Button>

        <Button type="button" size="sm" disabled={!canSubmit || isSubmitting} onClick={onSubmit}>
          {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
          {submitLabel}
        </Button>
      </div>
    </>
  )
}

interface SettingsResourceCardHeaderProps {
  title: ReactNode
  badges: SettingsResourceBadge[]
  details: ReactNode[]
  actions: SettingsResourceAction[]
}

/** Render a shared settings card header with badges, path lines, and icon actions. */
export function SettingsResourceCardHeader({ title, badges, details, actions }: SettingsResourceCardHeaderProps) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{title}</CardTitle>
          {badges.map((badge, index) => (
            <Badge key={index} variant={badge.variant ?? 'outline'}>
              {badge.label}
            </Badge>
          ))}
        </div>
        {details.map((detail, index) => (
          <div key={index} className="break-all font-mono text-xs text-muted-foreground">
            {detail}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            size="icon-sm"
            variant="outline"
            disabled={action.disabled}
            onClick={action.onClick}
            aria-label={action.label}
            title={action.title}
          >
            {action.icon}
          </Button>
        ))}
      </div>
    </div>
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
  dangerLabel: ReactNode
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
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <Button size="sm" variant="secondary" disabled={dangerDisabled} onClick={onDanger}>
        {dangerLabel}
      </Button>

      <Button
        size="icon-sm"
        disabled={primaryDisabled}
        onClick={onPrimary}
        aria-label={typeof primaryLabel === 'string' ? primaryLabel : '저장'}
        title={typeof primaryLabel === 'string' ? primaryLabel : '저장'}
      >
        {primaryDisabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      </Button>
    </div>
  )
}
