import { useEffect, useMemo, useState } from 'react'
import { SecurityAccountFormCard } from './security-account-form-card'
import { SecurityAccountListCard } from './security-account-list-card'
import { SecurityGroupColorEditorModal } from './security-group-color-editor-modal'
import {
  readSecurityGroupColorMap,
  SECURITY_GROUP_COLOR_STORAGE_KEY,
  type SecurityGroupColorMap,
} from './security-group-color-utils'
import { SecurityPermissionGroupEditorModal } from './security-permission-group-editor-modal'
import { SecurityPermissionGroupListCard } from './security-permission-group-list-card'
import { SecurityRecoveryCard } from './security-recovery-card'
import { SecurityStatusCard } from './security-status-card'
import { useSecurityTabData } from './security-tab-data'

/** Compose the auth/account-management settings UI from a few focused sections. */
export function SecurityTab() {
  const securityTabData = useSecurityTabData()
  const [isGroupColorEditorOpen, setIsGroupColorEditorOpen] = useState(false)
  const [groupColors, setGroupColors] = useState<SecurityGroupColorMap>(() => (
    typeof window === 'undefined'
      ? {}
      : readSecurityGroupColorMap(window.localStorage.getItem(SECURITY_GROUP_COLOR_STORAGE_KEY))
  ))

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(SECURITY_GROUP_COLOR_STORAGE_KEY, JSON.stringify(groupColors))
  }, [groupColors])

  const colorEditableGroups = useMemo(() => {
    const orderedGroups = new Map<string, { groupKey: string; name?: string | null; systemGroup?: boolean }>()

    securityTabData.permissionGroups.forEach((group) => {
      orderedGroups.set(group.groupKey, {
        groupKey: group.groupKey,
        name: group.name,
        systemGroup: group.systemGroup,
      })
    })

    securityTabData.accounts.forEach((account) => {
      account.groupKeys.forEach((groupKey) => {
        if (!orderedGroups.has(groupKey)) {
          orderedGroups.set(groupKey, { groupKey, name: groupKey, systemGroup: groupKey === 'admin' || groupKey === 'guest' || groupKey === 'anonymous' })
        }
      })
    })

    return Array.from(orderedGroups.values())
  }, [securityTabData.accounts, securityTabData.permissionGroups])

  const groupLabels = useMemo(
    () => Object.fromEntries(colorEditableGroups.map((group) => [group.groupKey, group.name ?? group.groupKey])),
    [colorEditableGroups],
  )

  if (securityTabData.isLoading) {
    return <div className="min-h-[240px] rounded-sm bg-surface-low animate-pulse" />
  }

  return (
    <div className="space-y-8">
      <section>
        <SecurityStatusCard
          authStatus={securityTabData.authStatus}
          hasCredentials={securityTabData.hasCredentials}
          currentUsername={securityTabData.currentUsername}
        />
      </section>

      {securityTabData.canManageCredentials ? (
        <section>
          <SecurityAccountFormCard
            hasCredentials={securityTabData.hasCredentials}
            currentUsername={securityTabData.currentUsername}
            setupUsername={securityTabData.setupDraft.username}
            setupPassword={securityTabData.setupDraft.password}
            currentPassword={securityTabData.updateDraft.currentPassword}
            nextUsername={securityTabData.updateDraft.nextUsername}
            nextPassword={securityTabData.updateDraft.nextPassword}
            onSetupUsernameChange={(value) =>
              securityTabData.setSetupDraft((draft) => ({ ...draft, username: value }))
            }
            onSetupPasswordChange={(value) =>
              securityTabData.setSetupDraft((draft) => ({ ...draft, password: value }))
            }
            onCurrentPasswordChange={(value) =>
              securityTabData.setUpdateDraft((draft) => ({ ...draft, currentPassword: value }))
            }
            onNextUsernameChange={(value) =>
              securityTabData.setUpdateDraft((draft) => ({ ...draft, nextUsername: value }))
            }
            onNextPasswordChange={(value) =>
              securityTabData.setUpdateDraft((draft) => ({ ...draft, nextPassword: value }))
            }
            onSubmitSetup={securityTabData.submitSetup}
            onSubmitUpdate={securityTabData.submitUpdate}
            isSubmittingSetup={securityTabData.isSubmittingSetup}
            isSubmittingUpdate={securityTabData.isSubmittingUpdate}
          />
        </section>
      ) : null}

      {securityTabData.canManageAccess ? (
        <>
          <section>
            <SecurityAccountListCard
              accounts={securityTabData.accounts}
              availableGroups={securityTabData.availableGroups}
              isLoading={securityTabData.isLoadingAccounts}
              isUpdatingAccountGroup={securityTabData.isUpdatingAccountGroup}
              isUpdatingAccountPassword={securityTabData.isUpdatingAccountPassword}
              isDeletingAccount={securityTabData.isDeletingAccount}
              groupColors={groupColors}
              groupLabels={groupLabels}
              onOpenGroupColors={() => setIsGroupColorEditorOpen(true)}
              onAccountGroupChange={securityTabData.updateAccountGroup}
              onAccountPasswordChange={securityTabData.updateAccountPassword}
              onAccountDelete={securityTabData.deleteAccount}
            />
          </section>

          <section>
            <SecurityPermissionGroupListCard
              groups={securityTabData.permissionGroups}
              isLoading={securityTabData.isLoadingPermissionGroups}
              groupColors={groupColors}
              onCreate={securityTabData.openCreatePermissionGroupEditor}
              onEdit={securityTabData.openEditPermissionGroupEditor}
              onOpenGroupColors={() => setIsGroupColorEditorOpen(true)}
            />
          </section>
        </>
      ) : null}

      <section>
        <SecurityRecoveryCard databaseInfo={securityTabData.databaseInfo} />
      </section>

      <SecurityPermissionGroupEditorModal
        open={securityTabData.isPermissionGroupEditorOpen}
        mode={securityTabData.permissionGroupEditorMode}
        group={securityTabData.activePermissionGroup}
        members={securityTabData.activePermissionGroupMembers}
        addableAccounts={securityTabData.addableAccounts}
        selectedAddMemberAccountId={securityTabData.selectedAddMemberAccountId}
        permissionCatalog={securityTabData.pagePermissionCatalog}
        draft={securityTabData.permissionGroupDraft}
        isLoadingDetail={securityTabData.isLoadingPermissionGroupDetail}
        isSaving={securityTabData.isSavingPermissionGroup}
        isDeleting={securityTabData.isDeletingPermissionGroup}
        isAddingMember={securityTabData.isAddingPermissionGroupMember}
        isRemovingMember={securityTabData.isRemovingPermissionGroupMember}
        canEditFields={securityTabData.canEditPermissionGroupFields}
        canEditPermissions={securityTabData.canEditPermissionGroupPermissions}
        canManageMembers={securityTabData.canManagePermissionGroupMembers}
        canDelete={securityTabData.canDeletePermissionGroup}
        onClose={securityTabData.closePermissionGroupEditor}
        onDraftChange={securityTabData.patchPermissionGroupDraft}
        onTogglePermission={securityTabData.togglePermissionKey}
        onSelectedAddMemberAccountIdChange={securityTabData.setSelectedAddMemberAccountId}
        onSave={securityTabData.submitPermissionGroupEditor}
        onDelete={securityTabData.deletePermissionGroup}
        onAddMember={securityTabData.addPermissionGroupMember}
        onRemoveMember={securityTabData.removePermissionGroupMember}
      />

      <SecurityGroupColorEditorModal
        open={isGroupColorEditorOpen}
        groups={colorEditableGroups}
        groupColors={groupColors}
        onClose={() => setIsGroupColorEditorOpen(false)}
        onChangeColor={(groupKey, color) => setGroupColors((current) => ({ ...current, [groupKey]: color }))}
        onResetColor={(groupKey) => {
          setGroupColors((current) => {
            const next = { ...current }
            delete next[groupKey]
            return next
          })
        }}
      />
    </div>
  )
}
