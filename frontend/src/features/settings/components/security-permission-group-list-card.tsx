import { Palette, Pencil, Shield, Users, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { AuthPermissionGroupSummaryItem } from '@/lib/api-auth'
import { ListRow } from '@/components/ui/list-row'
import { RowGroup } from '@/components/ui/row-group'
import { SettingsRowsSkeleton } from './settings-rows'
import { getPermissionGroupDisplayName, getPermissionGroupKindLabel } from './security-ui-text'
import { getSecurityGroupBadgeStyle, getSecurityGroupColor, type SecurityGroupColorMap } from './security-group-color-utils'

interface SecurityPermissionGroupListCardProps {
  groups: AuthPermissionGroupSummaryItem[]
  isLoading: boolean
  groupColors: SecurityGroupColorMap
  onCreate: () => void
  onEdit: (group: AuthPermissionGroupSummaryItem) => void
  onOpenGroupColors: () => void
}

/** Render the group-centered permission management overview in a denser one-line layout. */
export function SecurityPermissionGroupListCard({
  groups,
  isLoading,
  groupColors,
  onCreate,
  onEdit,
  onOpenGroupColors,
}: SecurityPermissionGroupListCardProps) {
  const { language, t } = useI18n()

  return (
    <RowGroup
      heading={t({ ko: '권한 그룹', en: 'Permission groups' })}
      actions={(
        <>
          <IconButton size="icon-sm" variant="ghost" onClick={onOpenGroupColors} label={t('securityGroupColorEditorModal.permissionGroupColors')}>
            <Palette className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="ghost" onClick={onCreate} label={t({ ko: '그룹 추가', en: 'Add group' })}>
            <UserPlus className="h-4 w-4" />
          </IconButton>
        </>
      )}
    >
      {isLoading ? (
        <SettingsRowsSkeleton rows={3} />
      ) : (
        <div>
          {groups.map((group) => (
            <ListRow
              key={group.id}
              className="flex-wrap"
              trailing={(
                <>
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums" title={t({ ko: '권한 수', en: 'Permissions' })}>
                    <Shield className="h-3.5 w-3.5" aria-hidden />
                    {group.directPermissionKeys.length}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums" title={t({ ko: '멤버 수', en: 'Members' })}>
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {group.memberCount}
                  </span>
                  <IconButton size="icon-sm" variant="ghost" onClick={() => onEdit(group)} label={t({ ko: '권한 그룹 열기', en: 'Open permission group' })}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                </>
              )}
            >
              <Badge
                className="border-0 normal-case tracking-normal"
                style={getSecurityGroupBadgeStyle(getSecurityGroupColor(group.groupKey, groupColors))}
              >
                {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
              </Badge>
              <span className="text-xs text-muted-foreground">{getPermissionGroupKindLabel(language, group.systemGroup)}</span>
            </ListRow>
          ))}
        </div>
      )}
    </RowGroup>
  )
}
