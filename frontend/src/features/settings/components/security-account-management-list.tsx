import { useMemo, useState, type ReactNode } from 'react'
import { User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Chip } from '@/components/ui/chip'
import { ResourceRow, ResourceRowStatus } from '@/components/ui/resource-row'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { SecurityAccountEditorModal } from './security-account-editor-modal'
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

/** Shared searchable account list; a row opens the account editor (group, password, delete). */
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
  const { formatDateTime, language, t } = useI18n()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )

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
            .map((groupKey) => getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey).toLowerCase())
            .join(' ')

          return account.username.toLowerCase().includes(normalizedQuery)
            || searchableGroups.includes(normalizedQuery)
        }}
        renderItem={(account) => (
          <ResourceRow
            leading={<User />}
            name={account.username}
            extra={(
              <>
                {account.groupKeys.map((groupKey) => (
                  <Badge
                    key={groupKey}
                    className="shrink-0 border-0 normal-case tracking-normal"
                    style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
                  >
                    {getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey)}
                  </Badge>
                ))}
                {account.syncedLegacyAdmin ? <Chip size="sm" tone="muted">{t({ ko: '레거시', en: 'Legacy' })}</Chip> : null}
              </>
            )}
            meta={(
              <>
                {account.status !== 'active' ? <><ResourceRowStatus>{getAccountStatusLabel(language, account.status)}</ResourceRowStatus>{' · '}</> : null}
                {account.lastLoginAt
                  ? t({ ko: '최근 로그인 {value}', en: 'Last login {value}' }, { value: formatDateTime(account.lastLoginAt) })
                  : t({ ko: '로그인 기록 없음', en: 'No login history' })}
              </>
            )}
            trailing={renderExtraActions?.(account)}
            onOpen={() => setSelectedAccountId(account.id)}
          />
        )}
      />

      <SecurityAccountEditorModal
        open={selectedAccount !== null}
        account={selectedAccount}
        initialSection="group"
        availableGroups={availableGroups}
        groupColors={groupColors}
        groupLabels={groupLabels}
        isUpdatingGroup={isUpdatingAccountGroup}
        isUpdatingPassword={isUpdatingAccountPassword}
        isDeletingAccount={isDeletingAccount}
        onClose={() => setSelectedAccountId(null)}
        onAccountGroupChange={onAccountGroupChange}
        onAccountPasswordChange={onAccountPasswordChange}
        onAccountDelete={onAccountDelete}
      />
    </>
  )
}
