import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
  const isCreateMode = mode === 'create'
  const memberAccounts = useMemo(() => {
    const accountMap = new Map(allAccounts.map((account) => [account.id, account]))
    return members
      .map((member) => accountMap.get(member.id) ?? null)
      .filter((account): account is AuthAccountListItem => account !== null)
  }, [allAccounts, members])

  const title = isCreateMode
    ? '새 권한 그룹'
    : group
      ? getPermissionGroupDisplayName(group.groupKey, group.name)
      : '권한 그룹'
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
            <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>{getPermissionGroupKindLabel(group.systemGroup)}</Badge>
            <Badge variant="outline">권한 {draft.permissionKeys.length}</Badge>
            <Badge variant="outline">멤버 {members.length}</Badge>
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
              <SettingsField label="그룹 이름">
                <Input
                  variant="settings"
                  value={draft.name}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                  placeholder="예: 편집팀"
                />
              </SettingsField>

              <SettingsField label="설명">
                <Textarea
                  variant="settings"
                  rows={3}
                  value={draft.description}
                  disabled={isBusy}
                  onChange={(event) => onDraftChange({ description: event.target.value })}
                  placeholder="필요하면만 적어"
                />
              </SettingsField>
            </>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">페이지 권한</h3>
              {!canEditPermissions ? <Badge variant="secondary">읽기 전용</Badge> : null}
            </div>

            <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
              {permissionCatalog.length === 0 ? (
                <div className="text-sm text-muted-foreground">표시할 페이지 권한이 아직 없어.</div>
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
                          {getPagePermissionLabel(permission.permissionKey, permission.label)}
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
                <h3 className="text-sm font-semibold text-foreground">그룹 멤버</h3>
                {!canManageMembers ? <Badge variant="secondary">읽기 전용</Badge> : null}
              </div>

              {canManageMembers ? (
                <div className="grid gap-3 rounded-sm border border-border bg-surface-container p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <SettingsField label="계정">
                    <Select
                      variant="settings"
                      value={selectedAddMemberAccountId === null ? '' : String(selectedAddMemberAccountId)}
                      disabled={isAddingMember || isBusy}
                      onChange={(event) => onSelectedAddMemberAccountIdChange(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">계정 선택</option>
                      {addableAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.username} ({getAccountTypeLabel(account.accountType)})
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
                      추가
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
                  searchPlaceholder="멤버 검색"
                  searchAriaLabel="그룹 멤버 검색"
                  emptyMessage={members.length === 0 ? '멤버가 없어.' : '멤버 계정 정보를 불러오는 중이야.'}
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
                      멤버 제거
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
                  삭제
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isBusy}>
                닫기
              </Button>
              <Button type="button" onClick={onSave} disabled={!canEditPermissions || isBusy}>
                {isSaving ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsModal>
  )
}
