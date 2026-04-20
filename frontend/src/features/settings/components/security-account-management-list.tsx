import { useMemo, useState, type ReactNode } from 'react'
import { Clock3, KeyRound, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
import { formatDateTime } from '../settings-utils'
import { SecurityAccountEditorModal, type SecurityAccountEditorSection } from './security-account-editor-modal'
import { SettingsSearchablePagedList } from './settings-searchable-paged-list'
import { getAccountStatusLabel, getPermissionGroupDisplayName } from './security-ui-text'
import { getSecurityGroupBadgeStyle, getSecurityGroupColor, type SecurityGroupColorMap } from './security-group-color-utils'

interface SecurityAccountManagementListProps {
  accounts: AuthAccountListItem[]
  availableGroups: PermissionGroupListItem[]
  groupColors: SecurityGroupColorMap
  groupLabels: Record<string, string>
  pageSize: number
  searchPlaceholder: string
  emptyMessage: ReactNode
  searchAriaLabel?: string
  isUpdatingAccountGroup: boolean
  isUpdatingAccountPassword: boolean
  isDeletingAccount: boolean
  paginationClassName?: string
  renderExtraActions?: (account: AuthAccountListItem) => ReactNode
  onAccountGroupChange: (accountId: number, groupKey: 'admin' | 'guest') => Promise<boolean>
  onAccountPasswordChange: (accountId: number, password: string) => Promise<boolean>
  onAccountDelete: (accountId: number) => Promise<boolean>
}

/** Shared searchable account list with the standard account editor actions. */
export function SecurityAccountManagementList({
  accounts,
  availableGroups,
  groupColors,
  groupLabels,
  pageSize,
  searchPlaceholder,
  emptyMessage,
  searchAriaLabel,
  isUpdatingAccountGroup,
  isUpdatingAccountPassword,
  isDeletingAccount,
  paginationClassName,
  renderExtraActions,
  onAccountGroupChange,
  onAccountPasswordChange,
  onAccountDelete,
}: SecurityAccountManagementListProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [modalSection, setModalSection] = useState<SecurityAccountEditorSection>('group')

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
      <SettingsSearchablePagedList
        items={accounts}
        pageSize={pageSize}
        searchPlaceholder={searchPlaceholder}
        searchAriaLabel={searchAriaLabel ?? searchPlaceholder}
        emptyMessage={emptyMessage}
        paginationClassName={paginationClassName}
        getItemKey={(account) => account.id}
        matchesQuery={(account, normalizedQuery) => {
          const searchableGroups = account.groupKeys
            .map((groupKey) => getPermissionGroupDisplayName(groupKey, groupLabels[groupKey] ?? groupKey).toLowerCase())
            .join(' ')

          return account.username.toLowerCase().includes(normalizedQuery)
            || searchableGroups.includes(normalizedQuery)
        }}
        renderItem={(account) => (
          <div className="flex flex-col gap-2 rounded-sm border border-border/70 bg-surface-low/35 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
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

            <div className="flex shrink-0 flex-wrap justify-end gap-1">
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
              {renderExtraActions?.(account)}
            </div>
          </div>
        )}
      />

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
