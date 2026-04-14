import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { SettingsField } from './settings-primitives'
import { SettingsModal } from './settings-modal'
import { getAccountStatusLabel, getPermissionGroupDisplayName } from './security-ui-text'
import { getSecurityGroupBadgeStyle, type SecurityGroupColorMap, getSecurityGroupColor } from './security-group-color-utils'

export type SecurityAccountEditorSection = 'group' | 'password' | 'danger'

interface SecurityAccountEditorModalProps {
  open: boolean
  account: AuthAccountListItem | null
  initialSection: SecurityAccountEditorSection
  availableGroups: PermissionGroupListItem[]
  groupColors: SecurityGroupColorMap
  groupLabels: Record<string, string>
  isUpdatingGroup: boolean
  isUpdatingPassword: boolean
  isDeletingAccount: boolean
  onClose: () => void
  onAccountGroupChange: (accountId: number, groupKey: 'admin' | 'guest') => Promise<boolean>
  onAccountPasswordChange: (accountId: number, password: string) => Promise<boolean>
  onAccountDelete: (accountId: number) => Promise<boolean>
}

export function SecurityAccountEditorModal({
  open,
  account,
  initialSection,
  availableGroups,
  groupColors,
  groupLabels,
  isUpdatingGroup,
  isUpdatingPassword,
  isDeletingAccount,
  onClose,
  onAccountGroupChange,
  onAccountPasswordChange,
  onAccountDelete,
}: SecurityAccountEditorModalProps) {
  const [activeSection, setActiveSection] = useState<SecurityAccountEditorSection>('group')
  const [groupDraft, setGroupDraft] = useState<'admin' | 'guest'>('guest')
  const [nextPassword, setNextPassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    if (!open || !account) {
      return
    }

    setActiveSection(initialSection)
    setGroupDraft(account.accountType)
    setNextPassword('')
    setDeleteConfirmText('')
  }, [account, initialSection, open])

  const canChangeLegacyAdminPassword = account?.syncedLegacyAdmin !== true
  const canDeleteAccount = account?.syncedLegacyAdmin !== true
  const customMemberships = useMemo(
    () => account?.groupKeys.filter((groupKey) => groupKey !== 'admin' && groupKey !== 'guest') ?? [],
    [account],
  )

  if (!account) {
    return null
  }

  const submitGroupChange = async () => {
    if (groupDraft === account.accountType) {
      onClose()
      return
    }

    const success = await onAccountGroupChange(account.id, groupDraft)
    if (success) {
      onClose()
    }
  }

  const submitPasswordChange = async () => {
    const trimmedPassword = nextPassword.trim()
    if (!trimmedPassword) {
      return
    }

    const success = await onAccountPasswordChange(account.id, trimmedPassword)
    if (success) {
      onClose()
    }
  }

  const submitDelete = async () => {
    if (deleteConfirmText.trim() !== account.username) {
      return
    }

    const success = await onAccountDelete(account.id)
    if (success) {
      onClose()
    }
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={account.username}
      widthClassName="max-w-2xl"
      headerContent={(
        <div className="flex flex-wrap items-center gap-2">
          {account.groupKeys.map((groupKey) => (
            <Badge
              key={groupKey}
              className="border-0 normal-case tracking-normal"
              style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
            >
              {getPermissionGroupDisplayName(groupKey, groupLabels[groupKey] ?? groupKey)}
            </Badge>
          ))}
          {account.status !== 'active' ? <Badge variant="outline">{getAccountStatusLabel(account.status)}</Badge> : null}
          {account.syncedLegacyAdmin ? <Badge variant="secondary">레거시 동기화</Badge> : null}
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={activeSection === 'group' ? 'default' : 'secondary'} size="sm" onClick={() => setActiveSection('group')}>
            <Shield className="h-4 w-4" />
            그룹
          </Button>
          <Button type="button" variant={activeSection === 'password' ? 'default' : 'secondary'} size="sm" onClick={() => setActiveSection('password')}>
            <KeyRound className="h-4 w-4" />
            비밀번호
          </Button>
          <Button type="button" variant={activeSection === 'danger' ? 'destructive' : 'secondary'} size="sm" onClick={() => setActiveSection('danger')}>
            <Trash2 className="h-4 w-4" />
            삭제
          </Button>
        </div>

        {activeSection === 'group' ? (
          <div className="space-y-4 rounded-sm border border-border bg-surface-container p-4">
            <SettingsField label="기본 그룹">
              <Select
                variant="settings"
                value={groupDraft}
                disabled={isUpdatingGroup}
                onChange={(event) => setGroupDraft(event.target.value as 'admin' | 'guest')}
              >
                {availableGroups.map((group) => (
                  <option key={group.groupKey} value={group.groupKey}>
                    {getPermissionGroupDisplayName(group.groupKey, group.name)}
                  </option>
                ))}
              </Select>
            </SettingsField>

            <div className="space-y-2 text-sm text-muted-foreground">
              <div>커스텀 그룹 멤버십은 권한 그룹 모달에서 관리해.</div>
              {customMemberships.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {customMemberships.map((groupKey) => (
                    <Badge
                      key={groupKey}
                      className="border-0 normal-case tracking-normal"
                      style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
                    >
                      {getPermissionGroupDisplayName(groupKey, groupLabels[groupKey] ?? groupKey)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isUpdatingGroup}>닫기</Button>
              <Button type="button" onClick={() => void submitGroupChange()} disabled={isUpdatingGroup || groupDraft === account.accountType}>
                {isUpdatingGroup ? '저장 중…' : '저장'}
              </Button>
            </div>
          </div>
        ) : null}

        {activeSection === 'password' ? (
          <div className="space-y-4 rounded-sm border border-border bg-surface-container p-4">
            {canChangeLegacyAdminPassword ? (
              <>
                <SettingsField label="새 비밀번호">
                  <Input
                    variant="settings"
                    type="password"
                    value={nextPassword}
                    disabled={isUpdatingPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                    placeholder="새 비밀번호"
                  />
                </SettingsField>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={isUpdatingPassword}>닫기</Button>
                  <Button type="button" onClick={() => void submitPasswordChange()} disabled={isUpdatingPassword || !nextPassword.trim()}>
                    {isUpdatingPassword ? '변경 중…' : '변경'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-sm border border-border/70 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                이 계정은 레거시 관리자 자격과 동기화돼 있어서 여기서 비밀번호를 직접 바꾸지 않아. 위쪽 관리자 계정 카드에서 변경해.
              </div>
            )}
          </div>
        ) : null}

        {activeSection === 'danger' ? (
          <div className="space-y-4 rounded-sm border border-[#93000a]/30 bg-[#93000a]/8 p-4">
            <div className="flex items-start gap-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff8a80]" />
              <div className="space-y-1">
                <div className="font-semibold">계정 삭제</div>
                <div className="text-muted-foreground">
                  {canDeleteAccount
                    ? `정말 지우려면 아래에 ${account.username} 를 그대로 입력해.`
                    : '레거시 관리자 계정은 여기서 삭제하지 않는 게 맞아.'}
                </div>
              </div>
            </div>

            {canDeleteAccount ? (
              <>
                <SettingsField label="확인용 사용자명">
                  <Input
                    variant="settings"
                    value={deleteConfirmText}
                    disabled={isDeletingAccount}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder={account.username}
                  />
                </SettingsField>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={isDeletingAccount}>닫기</Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void submitDelete()}
                    disabled={isDeletingAccount || deleteConfirmText.trim() !== account.username}
                  >
                    {isDeletingAccount ? '삭제 중…' : '계정 삭제'}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsModal>
  )
}
