import type { ComponentProps, ReactNode } from 'react'
import { FolderPlus, LoaderCircle, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type SettingsBadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

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

interface SettingsResourceListItemProps {
  title: ReactNode
  path: ReactNode
  badges: SettingsResourceBadge[]
  selected?: boolean
  onOpenOptions: () => void
}

/** Render a shared settings resource row with status badges and options button. */
export function SettingsResourceListItem({ title, path, badges, selected = false, onOpenOptions }: SettingsResourceListItemProps) {
  return (
    <div
      className={cn(
        'grid gap-3 rounded-sm border px-4 py-4 transition-colors md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_minmax(220px,0.9fr)_auto] md:items-center',
        selected
          ? 'border-primary/40 bg-surface-high shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]'
          : 'border-border bg-surface-low hover:bg-surface-high',
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
      </div>

      <div className="min-w-0 font-mono text-xs text-muted-foreground md:pr-4">
        <div className="break-all">{path}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {badges.map((badge, index) => (
          <Badge key={index} variant={badge.variant ?? 'outline'}>
            {badge.label}
          </Badge>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="icon-sm"
          variant={selected ? 'default' : 'outline'}
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

      <Button size="sm" disabled={primaryDisabled} onClick={onPrimary}>
        {primaryLabel}
      </Button>
    </div>
  )
}
