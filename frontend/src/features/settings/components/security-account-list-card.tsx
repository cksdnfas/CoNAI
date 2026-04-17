import { useMemo, useState } from 'react'
import { Clock3, KeyRound, Palette, Search, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { formatDateTime } from '../settings-utils'
import { SecurityAccountEditorModal, type SecurityAccountEditorSection } from './security-account-editor-modal'
import { SettingsSection } from './settings-primitives'
import { getAccountStatusLabel, getPermissionGroupDisplayName } from './security-ui-text'
import { getSecurityGroupBadgeStyle, getSecurityGroupColor, type SecurityGroupColorMap } from './security-group-color-utils'

interface SecurityAccountListCardProps {
  accounts: AuthAccountListItem[]
  availableGroups: PermissionGroupListItem[]
  isLoading: boolean
  isUpdatingAccountGroup: boolean
  isUpdatingAccountPassword: boolean
  isDeletingAccount: boolean
  groupColors: SecurityGroupColorMap
  groupLabels: Record<string, string>
  onOpenGroupColors: () => void
  onAccountGroupChange: (accountId: number, groupKey: 'admin' | 'guest') => Promise<boolean>
  onAccountPasswordChange: (accountId: number, password: string) => Promise<boolean>
  onAccountDelete: (accountId: number) => Promise<boolean>
}

/** Render the admin-facing account review list in a denser searchable layout. */
export function SecurityAccountListCard({
  accounts,
  availableGroups,
  isLoading,
  isUpdatingAccountGroup,
  isUpdatingAccountPassword,
  isDeletingAccount,
  groupColors,
  groupLabels,
  onOpenGroupColors,
  onAccountGroupChange,
  onAccountPasswordChange,
  onAccountDelete,
}: SecurityAccountListCardProps) {
  const [query, setQuery] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [modalSection, setModalSection] = useState<SecurityAccountEditorSection>('group')

  const normalizedQuery = query.trim().toLowerCase()
  const filteredAccounts = useMemo(() => {
    if (!normalizedQuery) {
      return accounts
    }

    return accounts.filter((account) => {
      const searchableGroups = account.groupKeys
        .map((groupKey) => getPermissionGroupDisplayName(groupKey, groupLabels[groupKey] ?? groupKey).toLowerCase())
        .join(' ')

      return account.username.toLowerCase().includes(normalizedQuery)
        || searchableGroups.includes(normalizedQuery)
    })
  }, [accounts, normalizedQuery])

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )

  const openAccountEditor = (accountId: number, section: SecurityAccountEditorSection) => {
    setSelectedAccountId(accountId)
    setModalSection(section)
  }

  const closeAccountEditor = () => {
    setSelectedAccountId(null)
    setModalSection('group')
  }

  return (
    <>
      <SettingsSection
        heading="계정"
        actions={(
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={onOpenGroupColors}
            aria-label="그룹 색상"
            title="그룹 색상"
          >
            <Palette className="h-4 w-4" />
          </Button>
        )}
      >
        {isLoading ? (
          <div className="min-h-[180px] rounded-sm bg-surface-low animate-pulse" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  variant="settings"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="계정 검색"
                  className="pl-9"
                />
              </div>
              <Badge variant="secondary">{filteredAccounts.length}</Badge>
            </div>

            {filteredAccounts.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border bg-surface-container px-4 py-6 text-sm text-muted-foreground">
                맞는 계정이 없어. 검색어를 조금 바꿔봐.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex flex-col gap-2 rounded-sm border border-border/70 bg-surface-low/35 px-3 py-2.5 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 truncate text-sm font-semibold text-foreground">{account.username}</div>
                        {account.groupKeys.map((groupKey) => (
                          <Badge
                            key={groupKey}
                            className="border-0 normal-case tracking-normal"
                            style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
                          >
                            {getPermissionGroupDisplayName(groupKey, groupLabels[groupKey] ?? groupKey)}
                          </Badge>
                        ))}
                        {account.status !== 'active' ? <Badge variant="outline">{getAccountStatusLabel(account.status)}</Badge> : null}
                        {account.syncedLegacyAdmin ? <Badge variant="secondary">레거시</Badge> : null}
                        <span
                          className={cn(
                            'inline-flex items-center text-muted-foreground',
                            account.lastLoginAt ? 'cursor-help' : 'opacity-50',
                          )}
                          title={account.lastLoginAt ? `최근 로그인 ${formatDateTime(account.lastLoginAt)}` : '로그인 기록 없음'}
                          aria-label={account.lastLoginAt ? '최근 로그인 있음' : '로그인 기록 없음'}
                        >
                          <Clock3 className="h-4 w-4" />
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openAccountEditor(account.id, 'group')}
                        title="그룹 설정"
                        aria-label="그룹 설정"
                      >
                        <Shield className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openAccountEditor(account.id, 'password')}
                        title="비밀번호 변경"
                        aria-label="비밀번호 변경"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openAccountEditor(account.id, 'danger')}
                        title="계정 삭제"
                        aria-label="계정 삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SettingsSection>

      <SecurityAccountEditorModal
        open={selectedAccount !== null}
        account={selectedAccount}
        initialSection={modalSection}
        availableGroups={availableGroups}
        groupColors={groupColors}
        groupLabels={groupLabels}
        isUpdatingGroup={isUpdatingAccountGroup}
        isUpdatingPassword={isUpdatingAccountPassword}
        isDeletingAccount={isDeletingAccount}
        onClose={closeAccountEditor}
        onAccountGroupChange={onAccountGroupChange}
        onAccountPasswordChange={onAccountPasswordChange}
        onAccountDelete={onAccountDelete}
      />
    </>
  )
}
