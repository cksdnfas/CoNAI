import { useMemo, useState } from 'react'
import { UserMinus, UserPlus } from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { Badge } from '@/components/ui/badge'
import { EditorFooter } from '@/components/ui/editor-footer'
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
  const [tab, setTab] = useState<'permissions' | 'members'>('permissions')
  const [tabFor, setTabFor] = useState<string | null>(null)
  const sessionKey = open ? `${mode}:${group?.id ?? 'new'}` : null
  if (sessionKey !== tabFor) {
    // A newly opened group starts on its permissions.
    setTabFor(sessionKey)
    setTab('permissions')
  }
  const shownTab = isCreateMode ? 'permissions' : tab
  const sameKeys = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')
  const dirty = open && (isCreateMode
    ? draft.name.trim() !== '' || draft.description.trim() !== ''
    : group !== null && (draft.name !== group.name || draft.description !== (group.description ?? '') || !sameKeys(draft.permissionKeys, group.directPermissionKeys)))
  const canSave = canEditPermissions && !isBusy && draft.name.trim() !== '' && (dirty || isCreateMode)
  const readOnlyBadge = <Badge variant="secondary">{t({ ko: '읽기 전용', en: 'Read only' })}</Badge>

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="wide"
      height="tall"
      dirty={dirty}
      onSave={canSave ? onSave : undefined}
      headerContent={
        !isCreateMode && group ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>{getPermissionGroupKindLabel(language, group.systemGroup)}</Badge>
          </div>
        ) : null
      }
    >
      {mode === 'edit' && isLoadingDetail ? (
        <div className="min-h-[360px] flex-1 animate-pulse rounded-sm bg-fill" />
      ) : (
        <>
          <div className="space-y-5">
            {canEditFields ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
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
                    rows={1}
                    className="min-h-10 max-h-40 [field-sizing:content]"
                    value={draft.description}
                    disabled={isBusy}
                    onChange={(event) => onDraftChange({ description: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}

            {isCreateMode ? (
              // A new group has no members yet: one section, so a heading rather than a one-tab strip.
              <div className="flex min-h-7 items-center gap-3 border-b border-line pb-2">
                <h3 className="flex-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
                  {t({ ko: '권한', en: 'Permissions' })} <span className="tabular-nums">{draft.permissionKeys.length}</span>
                </h3>
                {!canEditPermissions ? readOnlyBadge : null}
              </div>
            ) : (
              <TextTabs
                value={shownTab}
                onChange={setTab}
                ariaLabel={t({ ko: '권한 그룹 항목', en: 'Permission group sections' })}
                items={[
                  { value: 'permissions', label: t({ ko: '권한', en: 'Permissions' }), count: draft.permissionKeys.length },
                  { value: 'members', label: t({ ko: '멤버', en: 'Members' }), count: members.length },
                ]}
                actions={(shownTab === 'permissions' ? !canEditPermissions : !canManageMembers) ? readOnlyBadge : undefined}
              />
            )}

            {shownTab === 'permissions' ? (
              <SecurityPermissionChecklist
                permissionCatalog={permissionCatalog}
                groupKey={group?.groupKey ?? null}
                selectedKeys={draft.permissionKeys}
                inheritedSources={inheritedPermissionSources}
                disabled={!canEditPermissions || isBusy}
                onToggle={onTogglePermission}
              />
            ) : (
              <div className="space-y-3">
                {canManageMembers ? (
                  <div className="flex items-center gap-2">
                    <Select
                      variant="settings"
                      className="min-w-0 flex-1"
                      aria-label={t({ ko: '추가할 계정', en: 'Account to add' })}
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
                    <IconButton
                      variant="secondary"
                      onClick={onAddMember}
                      disabled={selectedAddMemberAccountId === null || isAddingMember || isBusy}
                      label={t({ ko: '고른 계정을 멤버로 추가', en: 'Add the selected account as a member' })}
                    >
                      <UserPlus className="h-4 w-4" />
                    </IconButton>
                  </div>
                ) : null}

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
            )}
          </div>

          <EditorFooter
            onDelete={canDelete && group ? () => onDelete(group.id) : undefined}
            deleteLabel={t({ ko: '그룹 삭제', en: 'Delete group' })}
            deleting={isDeleting}
            onSave={onSave}
            canSave={canSave}
            saving={isSaving}
          />
        </>
      )}
    </Modal>
  )
}
