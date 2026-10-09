import { useMemo } from 'react'
import { UserMinus, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
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
import { Field } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { SecurityAccountManagementList } from './security-account-management-list'
import { SecurityPermissionChecklist } from './security-permission-checklist'
import {
  getAccountTypeLabel,
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
  inheritedPermissionSources: Record<string, string>
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
  inheritedPermissionSources,
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
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      widthClassName="max-w-5xl"
      headerContent={
        !isCreateMode && group ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>{getPermissionGroupKindLabel(language, group.systemGroup)}</Badge>
          </div>
        ) : null
      }
    >
      {mode === 'edit' && isLoadingDetail ? (
        <div className="min-h-[360px] animate-pulse rounded-sm bg-fill" />
      ) : (
        <div className="space-y-6">
          {canEditFields ? (
            <>
              <Field label={t({ ko: '그룹 이름', en: 'Group name' })}>
                <Input
                  variant="settings"
                  value={draft.name}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                  placeholder={t({ ko: '예: 편집팀', en: 'Example: Editors' })}
                />
              </Field>

              <Field label={t({ ko: '설명', en: 'Description' })}>
                <Textarea
                  variant="settings"
                  rows={3}
                  value={draft.description}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ description: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{t({ ko: '권한', en: 'Permissions' })}</h3>
              {!canEditPermissions ? <Badge variant="secondary">{t({ ko: '읽기 전용', en: 'Read only' })}</Badge> : null}
            </div>

            <SecurityPermissionChecklist
              permissionCatalog={permissionCatalog}
              groupKey={group?.groupKey ?? null}
              selectedKeys={draft.permissionKeys}
              inheritedSources={inheritedPermissionSources}
              disabled={!canEditPermissions || isBusy}
              onToggle={onTogglePermission}
            />
          </section>

          {!isCreateMode ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{t({ ko: '그룹 멤버', en: 'Group members' })}</h3>
                {!canManageMembers ? <Badge variant="secondary">{t({ ko: '읽기 전용', en: 'Read only' })}</Badge> : null}
              </div>

              {canManageMembers ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label={t({ ko: '계정', en: 'Account' })}>
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
                  </Field>

                  <div className="flex items-end">
                    <IconButton
                      variant="secondary"
                      onClick={onAddMember}
                      disabled={selectedAddMemberAccountId === null || isAddingMember || isBusy}
                      label={t({ ko: '고른 계정을 멤버로 추가', en: 'Add the selected account as a member' })}
                    >
                      <UserPlus className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              ) : null}

              <div>
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
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      disabled={isRemovingMember || isBusy}
                      onClick={() => onRemoveMember(account.id)}
                      label={t({ ko: '이 그룹에서 멤버 제거', en: 'Remove member from this group' })}
                    >
                      <UserMinus className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                  onAccountGroupChange={onAccountGroupChange}
                  onAccountPasswordChange={onAccountPasswordChange}
                  onAccountDelete={onAccountDelete}
                />
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
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
    </Modal>
  )
}
