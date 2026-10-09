import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { buildPermissionSections, type PermissionSectionRow } from './security-permission-catalog'
import { getPermissionGroupDisplayName } from './security-ui-text'
import { CollapsibleRow } from '@/components/ui/collapsible-row'

interface SecurityPermissionChecklistProps {
  permissionCatalog: PageAccessPermissionItem[]
  /** The group being edited; the anonymous group only lists what signed-out visitors can use. */
  groupKey: string | null
  selectedKeys: string[]
  /** Permission key → ancestor group key it's inherited from; shown checked and locked. */
  inheritedSources: Record<string, string>
  disabled: boolean
  onToggle: (permissionKey: string, enabled: boolean) => void
}

/** Pages follow these features, so there is no separate page list; only inherited grants are locked. */
export function SecurityPermissionChecklist({ permissionCatalog, groupKey, selectedKeys, inheritedSources, disabled, onToggle }: SecurityPermissionChecklistProps) {
  const { language, t } = useI18n()
  const sections = useMemo(() => buildPermissionSections(permissionCatalog, groupKey), [permissionCatalog, groupKey])
  const selected = new Set(selectedKeys)
  const isOn = (permissionKey: string) => selected.has(permissionKey) || permissionKey in inheritedSources
  const renderRow = (row: PermissionSectionRow) => {
    const inheritedFrom = inheritedSources[row.key]
    const rowDisabled = disabled || inheritedFrom !== undefined
    return (
      <label key={row.key} className={cn('flex min-h-11 items-center justify-between gap-3 border-b border-line py-2', rowDisabled ? 'cursor-default' : 'cursor-pointer')}>
        <span className="min-w-0 text-sm text-foreground">{t(row.label)}</span>
        <span className="flex shrink-0 items-center gap-2">
          {inheritedFrom !== undefined ? <span className="text-xs text-muted-foreground">{t({ ko: '{group}에서 상속', en: 'From {group}' }, { group: getPermissionGroupDisplayName(language, inheritedFrom) })}</span> : null}
          <Checkbox checked={isOn(row.key)} disabled={rowDisabled} onCheckedChange={(checked) => onToggle(row.key, checked === true)} />
        </span>
      </label>
    )
  }

  if (sections.length === 0) {
    return <div className="text-sm text-muted-foreground">{t({ ko: '표시할 권한이 아직 없어.', en: 'There are no permissions to show yet.' })}</div>
  }

  return (
    <div>
      {sections.map((section) => (
        <CollapsibleRow key={section.id} title={t(section.label)} meta={t({ ko: '{enabled}/{total} 허용', en: '{enabled}/{total} allowed' }, { enabled: section.rows.filter((row) => isOn(row.key)).length, total: section.rows.length })}>
          <div className="grid gap-x-6 sm:grid-cols-2">{section.rows.map(renderRow)}</div>
        </CollapsibleRow>
      ))}
    </div>
  )
}
