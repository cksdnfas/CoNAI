import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { buildPermissionSections } from './security-permission-catalog'
import { getPermissionGroupDisplayName } from './security-ui-text'

interface SecurityPermissionChecklistProps {
  permissionCatalog: PageAccessPermissionItem[]
  selectedKeys: string[]
  /** Permission key → ancestor group key it's inherited from; shown checked and locked. */
  inheritedSources: Record<string, string>
  disabled: boolean
  onToggle: (permissionKey: string, enabled: boolean) => void
}

/** Grantable permissions in labeled sections, with each page's actions indented under it and locked while the page is off. */
export function SecurityPermissionChecklist({ permissionCatalog, selectedKeys, inheritedSources, disabled, onToggle }: SecurityPermissionChecklistProps) {
  const { language, t } = useI18n()
  const sections = useMemo(() => buildPermissionSections(permissionCatalog), [permissionCatalog])
  const selected = new Set(selectedKeys)
  const isOn = (permissionKey: string) => selected.has(permissionKey) || permissionKey in inheritedSources

  if (sections.length === 0) {
    return <div className="text-sm text-muted-foreground">{t({ ko: '표시할 권한이 아직 없어.', en: 'There are no permissions to show yet.' })}</div>
  }

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <div key={section.id}>
          <h4 className="pb-1 text-xs font-semibold text-muted-foreground">{t(section.label)}</h4>
          {section.rows.map((row) => {
            const inheritedFrom = inheritedSources[row.key]
            const checked = isOn(row.key)
            const parentOff = row.parentKey !== null && !isOn(row.parentKey)
            // A stale action left on without its page stays unlockable so it can still be cleared.
            const rowDisabled = disabled || inheritedFrom !== undefined || (parentOff && !checked)
            return (
              <label
                key={row.key}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-4 border-b border-line py-2 last:border-b-0',
                  row.parentKey !== null && 'pl-6',
                  rowDisabled ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                <span className={cn('min-w-0 text-sm', parentOff ? 'text-muted-foreground' : 'text-foreground')}>{t(row.label)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {inheritedFrom !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      {t({ ko: '{group}에서 상속', en: 'From {group}' }, { group: getPermissionGroupDisplayName(language, inheritedFrom) })}
                    </span>
                  ) : null}
                  <Checkbox
                    checked={checked}
                    disabled={rowDisabled}
                    onCheckedChange={(nextChecked) => onToggle(row.key, nextChecked === true)}
                  />
                </span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
