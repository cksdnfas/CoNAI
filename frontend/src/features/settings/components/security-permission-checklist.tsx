import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { buildPermissionSections, type PermissionSectionRow } from './security-permission-catalog'
import { getPermissionGroupDisplayName } from './security-ui-text'
import { CollapsibleRow } from './chat-profile-sections'

interface SecurityPermissionChecklistProps {
  permissionCatalog: PageAccessPermissionItem[]
  selectedKeys: string[]
  /** Permission key → ancestor group key it's inherited from; shown checked and locked. */
  inheritedSources: Record<string, string>
  disabled: boolean
  onToggle: (permissionKey: string, enabled: boolean) => void
}

/** Page access and feature grants are independent; only inherited grants are locked. */
export function SecurityPermissionChecklist({ permissionCatalog, selectedKeys, inheritedSources, disabled, onToggle }: SecurityPermissionChecklistProps) {
  const { language, t } = useI18n()
  const sections = useMemo(() => buildPermissionSections(permissionCatalog), [permissionCatalog])
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
    <div className="space-y-5">
      {sections.filter((section) => section.kind === 'page').map((section) => (
        <div key={section.id}>
          <h3 className="pb-2 text-sm font-semibold">{t({ ko: '페이지 접근', en: 'Page access' })}</h3>
          <div className="grid gap-x-6 sm:grid-cols-2">{section.rows.map(renderRow)}</div>
        </div>
      ))}
      <div>
        <h3 className="pb-1 text-sm font-semibold">{t({ ko: '기능 사용', en: 'Feature usage' })}</h3>
        <p className="pb-2 text-xs text-muted-foreground">{t({ ko: '페이지 접근과 별개로 적용돼. 필요한 기능만 펼쳐서 설정해.', en: 'These apply independently of page access. Expand the features you need.' })}</p>
        {sections.filter((section) => section.kind === 'feature').map((section) => (
          <CollapsibleRow key={section.id} title={t(section.label)} meta={t({ ko: '{enabled}/{total} 허용', en: '{enabled}/{total} allowed' }, { enabled: section.rows.filter((row) => isOn(row.key)).length, total: section.rows.length })}>
            <div className="grid gap-x-6 sm:grid-cols-2">{section.rows.map(renderRow)}</div>
          </CollapsibleRow>
        ))}
      </div>
    </div>
  )
}
