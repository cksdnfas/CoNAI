import { useMemo, useState, type ReactNode } from 'react'
import { Clock3, KeyRound, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { cn } from '@/lib/utils'
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
  const { formatDateTime, language, t } = useI18n()
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
            .map((groupKey) => getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey).toLowerCase())
            .join(' ')

          return account.username.toLowerCase().includes(normalizedQuery)
            || searchableGroups.includes(normalizedQuery)
        }}
        renderItem={(account) => (
          <ListRow
            className="flex-wrap"
            trailing={(
              <>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openAccountEditor(account.id, 'group')}
                  label={t({ ko: '그룹 설정', en: 'Group settings' })}
                >
                  <Shield className="h-4 w-4" />
                </IconButton>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openAccountEditor(account.id, 'password')}
                  label={t({ ko: '비밀번호 변경', en: 'Change password' })}
                >
                  <KeyRound className="h-4 w-4" />
                </IconButton>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openAccountEditor(account.id, 'danger')}
                  label={t({ ko: '계정 삭제', en: 'Delete account' })}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
                {renderExtraActions?.(account)}
              </>
            )}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate font-medium text-foreground">{account.username}</span>
              {account.groupKeys.map((groupKey) => (
                <Badge
                  key={groupKey}
                  className="border-0 normal-case tracking-normal"
                  style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
                >
                  {getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey)}
                </Badge>
              ))}
              {account.status !== 'active' ? <Badge variant="outline">{getAccountStatusLabel(language, account.status)}</Badge> : null}
              {account.syncedLegacyAdmin ? <Badge variant="secondary">{t({ ko: '레거시', en: 'Legacy' })}</Badge> : null}
              <span
                className={cn(
                  'inline-flex items-center text-muted-foreground',
                  account.lastLoginAt ? 'cursor-help' : 'opacity-50',
                )}
                title={account.lastLoginAt ? t({ ko: '최근 로그인 {value}', en: 'Last login {value}' }, { value: formatDateTime(account.lastLoginAt) }) : t({ ko: '로그인 기록 없음', en: 'No login history' })}
                aria-label={account.lastLoginAt ? t({ ko: '최근 로그인 있음', en: 'Has recent login' }) : t({ ko: '로그인 기록 없음', en: 'No login history' })}
              >
                <Clock3 className="h-4 w-4" />
              </span>
            </span>
          </ListRow>
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
