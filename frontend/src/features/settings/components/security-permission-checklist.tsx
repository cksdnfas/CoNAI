import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { RowGroup } from '@/components/ui/row-group'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { useI18n } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { buildPermissionLayout, type PermissionRow } from './security-permission-catalog'
import { getPermissionGroupDisplayName } from './security-ui-text'

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

/** Basic rights as switches, then the menu pages as checkboxes; only inherited grants are locked. */
export function SecurityPermissionChecklist({ permissionCatalog, groupKey, selectedKeys, inheritedSources, disabled, onToggle }: SecurityPermissionChecklistProps) {
  const { language, t } = useI18n()
  const { rights, pages } = useMemo(() => buildPermissionLayout(permissionCatalog, groupKey), [permissionCatalog, groupKey])
  const selected = new Set(selectedKeys)
  const isOn = (permissionKey: string) => selected.has(permissionKey) || permissionKey in inheritedSources
  const inheritedNote = (row: PermissionRow) => {
    const inheritedFrom = inheritedSources[row.key]
    return inheritedFrom === undefined ? null
      : <span className="text-xs text-muted-foreground">{t({ ko: '{group}에서 상속', en: 'From {group}' }, { group: getPermissionGroupDisplayName(language, inheritedFrom) })}</span>
  }

  if (rights.length === 0 && pages.length === 0) {
    return <EmptyState size="compact" title={t({ ko: '표시할 권한이 아직 없어', en: 'There are no permissions to show yet' })} />
  }

  return (
    <div className="space-y-6">
      {rights.length > 0 ? (
        <RowGroup heading={t({ ko: '기본 권한', en: 'Basic rights' })}>
          {rights.map((row) => (
            <SettingsSwitchRow
              key={row.key}
              label={<span className="flex items-center gap-2">{t(row.label)}{inheritedNote(row)}</span>}
              info={row.info ? t(row.info) : undefined}
              checked={isOn(row.key)}
              disabled={disabled || row.key in inheritedSources}
              onCheckedChange={(checked) => onToggle(row.key, checked)}
            />
          ))}
        </RowGroup>
      ) : null}
      {pages.length > 0 ? (
        <RowGroup heading={t({ ko: '페이지', en: 'Pages' })} count={`${pages.filter((row) => isOn(row.key)).length}/${pages.length}`}>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {pages.map((row) => {
              const rowDisabled = disabled || row.key in inheritedSources
              return (
                <label key={row.key} className={cn('flex min-h-11 items-center justify-between gap-3 border-b border-line py-2', rowDisabled ? 'cursor-default' : 'cursor-pointer')}>
                  <span className="min-w-0 text-sm text-foreground">{t(row.label)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {inheritedNote(row)}
                    <Checkbox checked={isOn(row.key)} disabled={rowDisabled} onCheckedChange={(checked) => onToggle(row.key, checked === true)} />
                  </span>
                </label>
              )
            })}
          </div>
        </RowGroup>
      ) : null}
    </div>
  )
}
