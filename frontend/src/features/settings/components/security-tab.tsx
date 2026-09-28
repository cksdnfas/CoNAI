import { useMemo, useState } from 'react'
import { SecurityAccountFormCard } from './security-account-form-card'
import { SecurityAccountListCard } from './security-account-list-card'
import { SecurityGroupColorEditorModal } from './security-group-color-editor-modal'
import { SecurityPermissionGroupEditorModal } from './security-permission-group-editor-modal'
import { SecurityPermissionGroupListCard } from './security-permission-group-list-card'
import { SecurityRecoveryCard } from './security-recovery-card'
import { SecurityStatusCard } from './security-status-card'
import { useSecurityTabData } from './security-tab-data'
import { useSecurityGroupColors } from './use-security-group-colors'

/** Compose the auth/account-management settings UI from a few focused sections. */
export function SecurityTab() {
  const securityTabData = useSecurityTabData()
  const [isGroupColorEditorOpen, setIsGroupColorEditorOpen] = useState(false)
  const { groupColors, setGroupColor, resetGroupColor, commit: commitGroupColors } = useSecurityGroupColors()

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
    <div className="space-y-6">
      <section>
        <SecurityStatusCard
          authStatus={securityTabData.authStatus}
          hasCredentials={securityTabData.hasCredentials}
          accountCount={securityTabData.canManageAccess && !securityTabData.isLoadingAccounts ? securityTabData.accounts.length : null}
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

      {securityTabData.canViewDatabaseInfo ? (
        <section>
          <SecurityRecoveryCard
            databaseInfo={securityTabData.databaseInfo}
            isError={securityTabData.isDatabaseInfoError}
            isRetrying={securityTabData.isRefetchingDatabaseInfo}
            onRetry={securityTabData.retryDatabaseInfo}
          />
        </section>
      ) : null}

      <SecurityPermissionGroupEditorModal
        open={securityTabData.isPermissionGroupEditorOpen}
        mode={securityTabData.permissionGroupEditorMode}
        group={securityTabData.activePermissionGroup}
        members={securityTabData.activePermissionGroupMembers}
        allAccounts={securityTabData.accounts}
        addableAccounts={securityTabData.addableAccounts}
        availableGroups={securityTabData.availableGroups}
        selectedAddMemberAccountId={securityTabData.selectedAddMemberAccountId}
        permissionCatalog={securityTabData.pagePermissionCatalog}
        draft={securityTabData.permissionGroupDraft}
        isLoadingDetail={securityTabData.isLoadingPermissionGroupDetail}
        isSaving={securityTabData.isSavingPermissionGroup}
        isDeleting={securityTabData.isDeletingPermissionGroup}
        isAddingMember={securityTabData.isAddingPermissionGroupMember}
        isRemovingMember={securityTabData.isRemovingPermissionGroupMember}
        isUpdatingAccountGroup={securityTabData.isUpdatingAccountGroup}
        isUpdatingAccountPassword={securityTabData.isUpdatingAccountPassword}
        isDeletingAccount={securityTabData.isDeletingAccount}
        canEditFields={securityTabData.canEditPermissionGroupFields}
        canEditPermissions={securityTabData.canEditPermissionGroupPermissions}
        canManageMembers={securityTabData.canManagePermissionGroupMembers}
        canDelete={securityTabData.canDeletePermissionGroup}
        groupColors={groupColors}
        groupLabels={groupLabels}
        onClose={securityTabData.closePermissionGroupEditor}
        onDraftChange={securityTabData.patchPermissionGroupDraft}
        onTogglePermission={securityTabData.togglePermissionKey}
        onSelectedAddMemberAccountIdChange={securityTabData.setSelectedAddMemberAccountId}
        onSave={securityTabData.submitPermissionGroupEditor}
        onDelete={securityTabData.deletePermissionGroup}
        onAddMember={securityTabData.addPermissionGroupMember}
        onRemoveMember={securityTabData.removePermissionGroupMember}
        onAccountGroupChange={securityTabData.updateAccountGroup}
        onAccountPasswordChange={securityTabData.updateAccountPassword}
        onAccountDelete={securityTabData.deleteAccount}
      />

      <SecurityGroupColorEditorModal
        open={isGroupColorEditorOpen}
        groups={colorEditableGroups}
        groupColors={groupColors}
        onClose={() => {
          commitGroupColors()
          setIsGroupColorEditorOpen(false)
        }}
        onChangeColor={setGroupColor}
        onResetColor={resetGroupColor}
      />
    </div>
  )
}
