import { Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { SecurityAccountManagementList } from './security-account-management-list'
import { SettingsSection } from './settings-primitives'
import type { SecurityGroupColorMap } from './security-group-color-utils'

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
  const { t } = useI18n()

  return (
    <SettingsSection
        heading={t({ ko: '계정', en: 'Accounts' })}
        actions={(
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={onOpenGroupColors}
            aria-label={t('securityGroupColorEditorModal.permissionGroupColors')}
            title={t('securityGroupColorEditorModal.permissionGroupColors')}
          >
            <Palette className="h-4 w-4" />
          </Button>
        )}
      >
        {isLoading ? (
          <div className="min-h-[180px] rounded-sm bg-surface-low animate-pulse" />
        ) : (
          <SecurityAccountManagementList
            accounts={accounts}
            availableGroups={availableGroups}
            groupColors={groupColors}
            groupLabels={groupLabels}
            pageSize={20}
            searchPlaceholder={t({ ko: '계정 검색', en: 'Search accounts' })}
            searchAriaLabel={t({ ko: '계정 검색', en: 'Search accounts' })}
            emptyMessage={t({ ko: '맞는 계정이 없어. 검색어를 조금 바꿔봐.', en: 'No matching accounts. Try a different search.' })}
            isUpdatingAccountGroup={isUpdatingAccountGroup}
            isUpdatingAccountPassword={isUpdatingAccountPassword}
            isDeletingAccount={isDeletingAccount}
            onAccountGroupChange={onAccountGroupChange}
            onAccountPasswordChange={onAccountPasswordChange}
            onAccountDelete={onAccountDelete}
          />
        )}
    </SettingsSection>
  )
}
