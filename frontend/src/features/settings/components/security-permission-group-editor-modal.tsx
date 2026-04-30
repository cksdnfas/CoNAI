import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type {
  AuthAccountListItem,
  AuthPermissionGroupMemberItem,
  AuthPermissionGroupSummaryItem,
  PageAccessPermissionItem,
  PermissionGroupListItem,
} from '@/lib/api-auth'
import { SettingsField } from './settings-primitives'
import { SettingsModal } from './settings-modal'
import { SecurityAccountManagementList } from './security-account-management-list'
import {
  getAccountTypeLabel,
  getPagePermissionLabel,
  getPermissionGroupDisplayName,
  getPermissionGroupKindLabel,
} from './security-ui-text'
import type { SecurityGroupColorMap } from './security-group-color-utils'

interface PermissionGroupDraft {
  name: string
  description: string
  permissionKeys: string[]
}

interface SecurityPermissionGroupEditorModalProps {
  open: boolean
  mode: 'create' | 'edit' | null
  group: AuthPermissionGroupSummaryItem | null
  members: AuthPermissionGroupMemberItem[]
  allAccounts: AuthAccountListItem[]
  addableAccounts: AuthAccountListItem[]
  availableGroups: PermissionGroupListItem[]
  selectedAddMemberAccountId: number | null
  permissionCatalog: PageAccessPermissionItem[]
  draft: PermissionGroupDraft
  isLoadingDetail: boolean
  isSaving: boolean
  isDeleting: boolean
  isAddingMember: boolean
  isRemovingMember: boolean
  isUpdatingAccountGroup: boolean
  isUpdatingAccountPassword: boolean
  isDeletingAccount: boolean
  canEditFields: boolean
  canEditPermissions: boolean
  canManageMembers: boolean
  canDelete: boolean
  groupColors: SecurityGroupColorMap
  groupLabels: Record<string, string>
  onClose: () => void
  onDraftChange: (patch: Partial<PermissionGroupDraft>) => void
  onTogglePermission: (permissionKey: string, enabled: boolean) => void
  onSelectedAddMemberAccountIdChange: (accountId: number | null) => void
  onSave: () => void
  onDelete: (groupId: number) => void
  onAddMember: () => void
  onRemoveMember: (accountId: number) => void
  onAccountGroupChange: (accountId: number, groupKey: 'admin' | 'guest') => Promise<boolean>
  onAccountPasswordChange: (accountId: number, password: string) => Promise<boolean>
  onAccountDelete: (accountId: number) => Promise<boolean>
}

/** Render the permission-group create/edit modal with page-permission and membership controls. */
export function SecurityPermissionGroupEditorModal({
  open,
  mode,
  group,
  members,
  allAccounts,
  addableAccounts,
  availableGroups,
  selectedAddMemberAccountId,
  permissionCatalog,
  draft,
  isLoadingDetail,
  isSaving,
  isDeleting,
  isAddingMember,
  isRemovingMember,
  isUpdatingAccountGroup,
  isUpdatingAccountPassword,
  isDeletingAccount,
  canEditFields,
  canEditPermissions,
  canManageMembers,
  canDelete,
  groupColors,
  groupLabels,
  onClose,
  onDraftChange,
  onTogglePermission,
  onSelectedAddMemberAccountIdChange,
  onSave,
  onDelete,
  onAddMember,
  onRemoveMember,
  onAccountGroupChange,
  onAccountPasswordChange,
  onAccountDelete,
}: SecurityPermissionGroupEditorModalProps) {
  const { language, t } = useI18n()
  const isCreateMode = mode === 'create'
  const memberAccounts = useMemo(() => {
    const accountMap = new Map(allAccounts.map((account) => [account.id, account]))
    return members
      .map((member) => accountMap.get(member.id) ?? null)
      .filter((account): account is AuthAccountListItem => account !== null)
  }, [allAccounts, members])

  const title = isCreateMode
    ? t({ ko: '새 권한 그룹', en: 'New permission group' })
    : group
      ? getPermissionGroupDisplayName(language, group.groupKey, group.name)
      : t({ ko: '권한 그룹', en: 'Permission group' })
  const isBusy = isSaving || isDeleting

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={title}
      widthClassName="max-w-5xl"
      headerContent={
        !isCreateMode && group ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>{getPermissionGroupKindLabel(language, group.systemGroup)}</Badge>
            <Badge variant="outline">{t({ ko: '권한 {count}', en: 'Permissions {count}' }, { count: draft.permissionKeys.length })}</Badge>
            <Badge variant="outline">{t({ ko: '멤버 {count}', en: 'Members {count}' }, { count: members.length })}</Badge>
          </div>
        ) : null
      }
    >
      {mode === 'edit' && isLoadingDetail ? (
        <div className="min-h-[360px] rounded-sm bg-surface-low animate-pulse" />
      ) : (
        <div className="space-y-6">
          {canEditFields ? (
            <>
              <SettingsField label={t({ ko: '그룹 이름', en: 'Group name' })}>
                <Input
                  variant="settings"
                  value={draft.name}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                  placeholder={t({ ko: '예: 편집팀', en: 'Example: Editors' })}
                />
              </SettingsField>

              <SettingsField label={t({ ko: '설명', en: 'Description' })}>
                <Textarea
                  variant="settings"
                  rows={3}
                  value={draft.description}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ description: event.target.value })}
                  placeholder={t({ ko: '필요하면만 적어', en: 'Add this only if needed' })}
                />
              </SettingsField>
            </>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{t({ ko: '페이지 권한', en: 'Page permissions' })}</h3>
              {!canEditPermissions ? <Badge variant="secondary">{t({ ko: '읽기 전용', en: 'Read only' })}</Badge> : null}
            </div>

            <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
              {permissionCatalog.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t({ ko: '표시할 페이지 권한이 아직 없어.', en: 'There are no page permissions to show yet.' })}</div>
              ) : (
                permissionCatalog.map((permission) => {
                  const checked = draft.permissionKeys.includes(permission.permissionKey)
                  return (
                    <label
                      key={permission.permissionKey}
                      className="flex items-start justify-between gap-4 rounded-sm border border-border/60 bg-background/40 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {getPagePermissionLabel(language, permission.permissionKey, permission.label)}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                        checked={checked}
                        disabled={!canEditPermissions || isBusy}
                        onChange={(event) => onTogglePermission(permission.permissionKey, event.target.checked)}
                      />
                    </label>
                  )
                })
              )}
            </div>
          </section>

          {!isCreateMode ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{t({ ko: '그룹 멤버', en: 'Group members' })}</h3>
                {!canManageMembers ? <Badge variant="secondary">{t({ ko: '읽기 전용', en: 'Read only' })}</Badge> : null}
              </div>

              {canManageMembers ? (
                <div className="grid gap-3 rounded-sm border border-border bg-surface-container p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <SettingsField label={t({ ko: '계정', en: 'Account' })}>
                    <Select
                      variant="settings"
                      value={selectedAddMemberAccountId === null ? '' : String(selectedAddMemberAccountId)}
                      disabled={isAddingMember || isBusy}
                      onChange={(event) => onSelectedAddMemberAccountIdChange(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">{t({ ko: '계정 선택', en: 'Select account' })}</option>
                      {addableAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.username} ({getAccountTypeLabel(language, account.accountType)})
                        </option>
                      ))}
                    </Select>
                  </SettingsField>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={onAddMember}
                      disabled={selectedAddMemberAccountId === null || isAddingMember || isBusy}
                    >
                      {t({ ko: '추가', en: 'Add' })}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-sm border border-border bg-surface-container p-3">
                <SecurityAccountManagementList
                  accounts={memberAccounts}
                  availableGroups={availableGroups}
                  groupColors={groupColors}
                  groupLabels={groupLabels}
                  pageSize={10}
                  searchPlaceholder={t({ ko: '멤버 검색', en: 'Search members' })}
                  searchAriaLabel={t({ ko: '그룹 멤버 검색', en: 'Search group members' })}
                  emptyMessage={members.length === 0 ? t({ ko: '멤버가 없어.', en: 'There are no members.' }) : t({ ko: '멤버 계정 정보를 불러오는 중이야.', en: 'Loading member account details.' })}
                  paginationClassName="pt-4"
                  isUpdatingAccountGroup={isUpdatingAccountGroup}
                  isUpdatingAccountPassword={isUpdatingAccountPassword}
                  isDeletingAccount={isDeletingAccount}
                  renderExtraActions={(account) => canManageMembers ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isRemovingMember || isBusy}
                      onClick={() => onRemoveMember(account.id)}
                    >
                      {t({ ko: '멤버 제거', en: 'Remove member' })}
                    </Button>
                  ) : null}
                  onAccountGroupChange={onAccountGroupChange}
                  onAccountPasswordChange={onAccountPasswordChange}
                  onAccountDelete={onAccountDelete}
                />
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              {canDelete && group ? (
                <Button type="button" variant="destructive" onClick={() => onDelete(group.id)} disabled={isBusy}>
                  {t({ ko: '삭제', en: 'Delete' })}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isBusy}>
                {t({ ko: '닫기', en: 'Close' })}
              </Button>
              <Button type="button" onClick={onSave} disabled={!canEditPermissions || isBusy}>
                {isSaving ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsModal>
  )
}
