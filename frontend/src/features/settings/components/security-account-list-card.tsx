import { Users } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { SettingsField } from './settings-primitives'
import { getAccountTypeLabel, getPermissionGroupDisplayName } from './security-ui-text'

interface SecurityAccountListCardProps {
  accounts: AuthAccountListItem[]
  availableGroups: PermissionGroupListItem[]
  isLoading: boolean
  isUpdatingAccountGroup: boolean
  onAccountGroupChange: (accountId: number, groupKey: 'admin' | 'guest') => void
}

/** Render the admin-facing account review list and built-in group selector. */
export function SecurityAccountListCard({
  accounts,
  availableGroups,
  isLoading,
  isUpdatingAccountGroup,
  onAccountGroupChange,
}: SecurityAccountListCardProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          heading="계정"
          actions={
            <div className="rounded-sm bg-primary/10 p-2 text-primary">
              <Users className="h-4 w-4" />
            </div>
          }
        />

        {isLoading ? (
          <div className="min-h-[180px] rounded-sm bg-surface-low animate-pulse" />
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const groupValue = account.accountType

              return (
                <div
                  key={account.id}
                  className="grid gap-3 rounded-sm border border-border bg-surface-container p-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">{account.username}</div>
                      <Badge variant={account.accountType === 'admin' ? 'secondary' : 'outline'}>
                        {getAccountTypeLabel(account.accountType)}
                      </Badge>
                      {account.syncedLegacyAdmin ? <Badge variant="outline">레거시</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {account.lastLoginAt
                        ? `최근 로그인 ${new Date(account.lastLoginAt).toLocaleString('ko-KR')}`
                        : '로그인 기록 없음'}
                    </div>
                    {account.groupKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {account.groupKeys.map((groupKey) => (
                          <Badge key={groupKey} variant="outline">
                            {getPermissionGroupDisplayName(groupKey, groupKey)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <SettingsField label="그룹">
                    <Select
                      variant="settings"
                      value={groupValue}
                      disabled={isUpdatingAccountGroup}
                      onChange={(event) => {
                        const nextGroupKey = event.target.value as 'admin' | 'guest'
                        if (nextGroupKey === groupValue) {
                          return
                        }
                        onAccountGroupChange(account.id, nextGroupKey)
                      }}
                    >
                      {availableGroups.map((group) => (
                        <option key={group.groupKey} value={group.groupKey}>
                          {getPermissionGroupDisplayName(group.groupKey, group.name)}
                        </option>
                      ))}
                    </Select>
                  </SettingsField>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
