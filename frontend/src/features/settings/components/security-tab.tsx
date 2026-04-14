import { SecurityAccountFormCard } from './security-account-form-card'
import { SecurityAccountListCard } from './security-account-list-card'
import { SecurityPermissionGroupEditorModal } from './security-permission-group-editor-modal'
import { SecurityPermissionGroupListCard } from './security-permission-group-list-card'
import { SecurityRecoveryCard } from './security-recovery-card'
import { SecurityStatusCard } from './security-status-card'
import { useSecurityTabData } from './security-tab-data'

/** Compose the auth/account-management settings UI from a few focused sections. */
export function SecurityTab() {
  const securityTabData = useSecurityTabData()

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
              onAccountGroupChange={securityTabData.updateAccountGroup}
            />
          </section>

          <section>
            <SecurityPermissionGroupListCard
              groups={securityTabData.permissionGroups}
              isLoading={securityTabData.isLoadingPermissionGroups}
              onCreate={securityTabData.openCreatePermissionGroupEditor}
              onEdit={securityTabData.openEditPermissionGroupEditor}
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
    </div>
  )
}
