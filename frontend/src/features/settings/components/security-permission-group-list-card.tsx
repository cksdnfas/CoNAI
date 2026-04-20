import { Palette, Pencil, Shield, Users, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AuthPermissionGroupSummaryItem } from '@/lib/api-auth'
import { SettingsSection } from './settings-primitives'
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
  return (
    <SettingsSection
      heading="권한 그룹"
      actions={(
        <div className="flex items-center gap-2">
          <Button type="button" size="icon-sm" variant="outline" onClick={onOpenGroupColors} aria-label="그룹 색상" title="그룹 색상">
            <Palette className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" onClick={onCreate}>
            <UserPlus className="h-4 w-4" />
            그룹 추가
          </Button>
        </div>
      )}
    >
      {isLoading ? (
        <div className="min-h-[220px] rounded-sm bg-surface-low animate-pulse" />
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex flex-col gap-2 rounded-sm border border-border/70 bg-surface-low/35 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2">
                <Badge
                  className="border-0 normal-case tracking-normal"
                  style={getSecurityGroupBadgeStyle(getSecurityGroupColor(group.groupKey, groupColors))}
                >
                  {getPermissionGroupDisplayName(group.groupKey, group.name)}
                </Badge>
                <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>
                  {getPermissionGroupKindLabel(group.systemGroup)}
                </Badge>
                <Badge variant="outline" className="gap-1 px-2 tracking-normal">
                  <Shield className="h-3.5 w-3.5" />
                  {group.directPermissionKeys.length}
                </Badge>
                <Badge variant="outline" className="gap-1 px-2 tracking-normal">
                  <Users className="h-3.5 w-3.5" />
                  {group.memberCount}
                </Badge>
              </div>

              <div className="flex shrink-0 justify-end">
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => onEdit(group)} aria-label="권한 그룹 열기" title="권한 그룹 열기">
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  )
}
