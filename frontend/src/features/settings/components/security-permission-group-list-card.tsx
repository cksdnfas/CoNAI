import { Pencil, Shield, Users, UserPlus } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AuthPermissionGroupSummaryItem } from '@/lib/api-auth'
import { getPermissionGroupDisplayName, getPermissionGroupKindLabel } from './security-ui-text'

interface SecurityPermissionGroupListCardProps {
  groups: AuthPermissionGroupSummaryItem[]
  isLoading: boolean
  onCreate: () => void
  onEdit: (group: AuthPermissionGroupSummaryItem) => void
}

/** Render the group-centered permission management overview. */
export function SecurityPermissionGroupListCard({
  groups,
  isLoading,
  onCreate,
  onEdit,
}: SecurityPermissionGroupListCardProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          heading="권한 그룹"
          actions={
            <Button type="button" size="sm" onClick={onCreate}>
              <UserPlus className="h-4 w-4" />
              그룹 추가
            </Button>
          }
        />

        {isLoading ? (
          <div className="min-h-[220px] rounded-sm bg-surface-low animate-pulse" />
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div
                key={group.id}
                className="grid gap-3 rounded-sm border border-border bg-surface-container p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {getPermissionGroupDisplayName(group.groupKey, group.name)}
                    </div>
                    <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>
                      {getPermissionGroupKindLabel(group.systemGroup)}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-sm bg-surface-high px-2 py-1">
                      <Shield className="h-3.5 w-3.5" />
                      직접 권한 {group.directPermissionKeys.length}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-sm bg-surface-high px-2 py-1">
                      <Users className="h-3.5 w-3.5" />
                      멤버 {group.memberCount}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(group)}>
                    <Pencil className="h-4 w-4" />
                    열기
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
