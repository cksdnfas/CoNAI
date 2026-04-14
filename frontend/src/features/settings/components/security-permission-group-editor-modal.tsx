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
} from '@/lib/api-auth'
import { SettingsField } from './settings-primitives'
import { SettingsModal } from './settings-modal'

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
  addableAccounts: AuthAccountListItem[]
  selectedAddMemberAccountId: number | null
  permissionCatalog: PageAccessPermissionItem[]
  draft: PermissionGroupDraft
  isLoadingDetail: boolean
  isSaving: boolean
  isDeleting: boolean
  isAddingMember: boolean
  isRemovingMember: boolean
  canEditFields: boolean
  canEditPermissions: boolean
  canManageMembers: boolean
  canDelete: boolean
  onClose: () => void
  onDraftChange: (patch: Partial<PermissionGroupDraft>) => void
  onTogglePermission: (permissionKey: string, enabled: boolean) => void
  onSelectedAddMemberAccountIdChange: (accountId: number | null) => void
  onSave: () => void
  onDelete: (groupId: number) => void
  onAddMember: () => void
  onRemoveMember: (accountId: number) => void
}

/** Render the permission-group create/edit modal with page-permission and membership controls. */
export function SecurityPermissionGroupEditorModal({
  open,
  mode,
  group,
  members,
  addableAccounts,
  selectedAddMemberAccountId,
  permissionCatalog,
  draft,
  isLoadingDetail,
  isSaving,
  isDeleting,
  isAddingMember,
  isRemovingMember,
  canEditFields,
  canEditPermissions,
  canManageMembers,
  canDelete,
  onClose,
  onDraftChange,
  onTogglePermission,
  onSelectedAddMemberAccountIdChange,
  onSave,
  onDelete,
  onAddMember,
  onRemoveMember,
}: SecurityPermissionGroupEditorModalProps) {
  const isCreateMode = mode === 'create'
  const isSystemGroup = group?.systemGroup === true
  const isAdminSystemGroup = group?.groupKey === 'admin' && isSystemGroup
  const title = isCreateMode ? '권한 그룹 생성' : group ? `${group.name} 관리` : '권한 그룹 관리'
  const isBusy = isSaving || isDeleting

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={title}
      description={
        isCreateMode
          ? '이름, 설명, 페이지 권한을 정해서 커스텀 그룹을 추가해.'
          : isSystemGroup
            ? '시스템 그룹은 안전하게 제한된 범위만 수정할 수 있어.'
            : '권한과 그룹 멤버를 한 곳에서 정리해.'
      }
      widthClassName="max-w-5xl"
      headerContent={
        !isCreateMode && group ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={group.systemGroup ? 'secondary' : 'outline'}>{group.systemGroup ? 'system' : 'custom'}</Badge>
            <Badge variant="outline">{group.groupKey}</Badge>
            <Badge variant="outline">직접 권한 {draft.permissionKeys.length}</Badge>
            <Badge variant="outline">멤버 {members.length}</Badge>
          </div>
        ) : null
      }
    >
      {mode === 'edit' && isLoadingDetail ? (
        <div className="min-h-[360px] rounded-sm bg-surface-low animate-pulse" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label="그룹 이름">
              <Input
                variant="settings"
                value={draft.name}
                disabled={!canEditFields || isBusy}
                onChange={(event) => onDraftChange({ name: event.target.value })}
                placeholder="예: editors"
              />
            </SettingsField>

            <div className="rounded-sm border border-border bg-surface-container px-3 py-3 text-sm text-muted-foreground">
              {isCreateMode
                ? '새 커스텀 그룹은 시스템 그룹 위에 추가되는 운영용 그룹이야.'
                : isAdminSystemGroup
                  ? 'admin 시스템 그룹은 전체 권한 유지가 기본이라 여기서는 읽기 전용으로 보여줄게.'
                  : group?.groupKey === 'anonymous'
                    ? 'anonymous 시스템 그룹은 월페이퍼 라이브 접근만 열고 닫게 제한했어.'
                    : isSystemGroup
                      ? '시스템 그룹은 이름이나 멤버 구조는 고정하고, 필요한 범위만 조정해.'
                      : '커스텀 그룹은 이름, 권한, 멤버를 모두 여기서 관리하면 돼.'}
            </div>
          </div>

          <SettingsField label="설명">
            <Textarea
              variant="settings"
              rows={3}
              value={draft.description}
              disabled={!canEditFields || isBusy}
              onChange={(event) => onDraftChange({ description: event.target.value })}
              placeholder="이 그룹이 어떤 용도인지 적어줘"
            />
          </SettingsField>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">페이지 권한</h3>
                <p className="mt-1 text-xs text-muted-foreground">그룹 생성과 수정에서 바로 접근 권한을 조정할 수 있어.</p>
              </div>
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
                        <div className="text-sm font-semibold text-foreground">{permission.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{permission.description ?? permission.permissionKey}</div>
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
                <div>
                  <h3 className="text-sm font-semibold text-foreground">그룹 멤버</h3>
                  <p className="mt-1 text-xs text-muted-foreground">계정을 그룹에 추가하거나 빼서 권한을 묶어 관리해.</p>
                </div>
                {!canManageMembers ? <Badge variant="secondary">읽기 전용</Badge> : null}
              </div>

              {canManageMembers ? (
                <div className="grid gap-3 rounded-sm border border-border bg-surface-container p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <SettingsField label="계정 추가">
                    <Select
                      variant="settings"
                      value={selectedAddMemberAccountId === null ? '' : String(selectedAddMemberAccountId)}
                      disabled={isAddingMember || isBusy}
                      onChange={(event) => onSelectedAddMemberAccountIdChange(event.target.value ? Number(event.target.value) : null)}
                    >
                      <option value="">계정 선택</option>
                      {addableAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.username} ({account.accountType})
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

              <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
                {members.length === 0 ? (
                  <div className="text-sm text-muted-foreground">소속된 계정이 아직 없어.</div>
                ) : (
                  members.map((member) => (
                    <div
                      key={member.id}
                      className="flex flex-col gap-3 rounded-sm border border-border/60 bg-background/40 px-3 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-foreground">{member.username}</div>
                          <Badge variant={member.accountType === 'admin' ? 'secondary' : 'outline'}>{member.accountType}</Badge>
                          <Badge variant="outline">{member.status}</Badge>
                        </div>
                      </div>

                      {canManageMembers ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={isRemovingMember || isBusy}
                          onClick={() => onRemoveMember(member.id)}
                        >
                          제거
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
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
