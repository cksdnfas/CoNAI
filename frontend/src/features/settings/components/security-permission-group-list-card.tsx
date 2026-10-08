import { KeyRound, Palette, Shield, UserPlus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { AuthPermissionGroupSummaryItem } from '@/lib/api-auth'
import { ResourceRow, ResourceRowStat } from '@/components/ui/resource-row'
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
      count={isLoading ? undefined : groups.length}
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
            <ResourceRow
              key={group.id}
              leading={<Shield />}
              name={(
                <Badge
                  className="border-0 normal-case tracking-normal"
                  style={getSecurityGroupBadgeStyle(getSecurityGroupColor(group.groupKey, groupColors))}
                >
                  {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                </Badge>
              )}
              extra={<Chip size="sm" tone="muted">{getPermissionGroupKindLabel(language, group.systemGroup)}</Chip>}
              aside={(
                <>
                  <ResourceRowStat icon={KeyRound} tip={t({ ko: '권한 {count}', en: '{count} permissions' }, { count: group.directPermissionKeys.length })}>{group.directPermissionKeys.length}</ResourceRowStat>
                  <ResourceRowStat icon={Users} tip={t({ ko: '멤버 {count}', en: '{count} members' }, { count: group.memberCount })}>{group.memberCount}</ResourceRowStat>
                </>
              )}
              onOpen={() => onEdit(group)}
            />
          ))}
        </div>
      )}
    </RowGroup>
  )
}
