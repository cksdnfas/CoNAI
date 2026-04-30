import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { SettingsField, SettingsValueTile } from './settings-primitives'
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
  const { formatDateTime, language, t } = useI18n()
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
              {getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey)}
            </Badge>
          ))}
          {account.status !== 'active' ? <Badge variant="outline">{getAccountStatusLabel(language, account.status)}</Badge> : null}
          {account.syncedLegacyAdmin ? <Badge variant="secondary">{t({ ko: '레거시 동기화', en: 'Legacy sync' })}</Badge> : null}
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <SettingsValueTile label={t({ ko: '생성일', en: 'Created' })} value={formatDateTime(account.createdAt)} className="px-3 py-3" valueClassName="text-sm font-medium" />
          <SettingsValueTile label={t({ ko: '수정일', en: 'Updated' })} value={formatDateTime(account.updatedAt)} className="px-3 py-3" valueClassName="text-sm font-medium" />
          <SettingsValueTile label={t({ ko: '최근 로그인', en: 'Last login' })} value={account.lastLoginAt ? formatDateTime(account.lastLoginAt) : '—'} className="px-3 py-3" valueClassName="text-sm font-medium" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={activeSection === 'group' ? 'default' : 'secondary'} size="sm" onClick={() => setActiveSection('group')}>
            <Shield className="h-4 w-4" />
            {t({ ko: '그룹', en: 'Group' })}
          </Button>
          <Button type="button" variant={activeSection === 'password' ? 'default' : 'secondary'} size="sm" onClick={() => setActiveSection('password')}>
            <KeyRound className="h-4 w-4" />
            {t({ ko: '비밀번호', en: 'Password' })}
          </Button>
          <Button type="button" variant={activeSection === 'danger' ? 'destructive' : 'secondary'} size="sm" onClick={() => setActiveSection('danger')}>
            <Trash2 className="h-4 w-4" />
            {t({ ko: '삭제', en: 'Delete' })}
          </Button>
        </div>

        {activeSection === 'group' ? (
          <div className="space-y-4 rounded-sm border border-border bg-surface-container p-4">
            <SettingsField label={t({ ko: '기본 그룹', en: 'Base group' })}>
              <Select
                variant="settings"
                value={groupDraft}
                disabled={isUpdatingGroup}
                onChange={(event) => setGroupDraft(event.target.value as 'admin' | 'guest')}
              >
                {availableGroups.map((group) => (
                  <option key={group.groupKey} value={group.groupKey}>
                    {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                  </option>
                ))}
              </Select>
            </SettingsField>

            <div className="space-y-2 text-sm text-muted-foreground">
              <div>{t({ ko: '커스텀 그룹 멤버십은 권한 그룹 모달에서 관리해.', en: 'Manage custom group memberships in the permission group modal.' })}</div>
              {customMemberships.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {customMemberships.map((groupKey) => (
                    <Badge
                      key={groupKey}
                      className="border-0 normal-case tracking-normal"
                      style={getSecurityGroupBadgeStyle(getSecurityGroupColor(groupKey, groupColors))}
                    >
                      {getPermissionGroupDisplayName(language, groupKey, groupLabels[groupKey] ?? groupKey)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isUpdatingGroup}>{t({ ko: '닫기', en: 'Close' })}</Button>
              <Button type="button" onClick={() => void submitGroupChange()} disabled={isUpdatingGroup || groupDraft === account.accountType}>
                {isUpdatingGroup ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
              </Button>
            </div>
          </div>
        ) : null}

        {activeSection === 'password' ? (
          <div className="space-y-4 rounded-sm border border-border bg-surface-container p-4">
            {canChangeLegacyAdminPassword ? (
              <>
                <SettingsField label={t({ ko: '새 비밀번호', en: 'New password' })}>
                  <Input
                    variant="settings"
                    type="password"
                    value={nextPassword}
                    disabled={isUpdatingPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                    placeholder={t({ ko: '새 비밀번호', en: 'New password' })}
                  />
                </SettingsField>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={isUpdatingPassword}>{t({ ko: '닫기', en: 'Close' })}</Button>
                  <Button type="button" onClick={() => void submitPasswordChange()} disabled={isUpdatingPassword || !nextPassword.trim()}>
                    {isUpdatingPassword ? t({ ko: '변경 중…', en: 'Updating…' }) : t({ ko: '변경', en: 'Update' })}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-sm border border-border/70 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                {t({ ko: '이 계정은 레거시 관리자 자격과 동기화돼 있어서 여기서 비밀번호를 직접 바꾸지 않아. 위쪽 관리자 계정 카드에서 변경해.', en: 'This account is synced with legacy admin credentials, so do not change its password here. Use the admin account card above instead.' })}
              </div>
            )}
          </div>
        ) : null}

        {activeSection === 'danger' ? (
          <div className="space-y-4 rounded-sm border border-[#93000a]/30 bg-[#93000a]/8 p-4">
            <div className="flex items-start gap-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff8a80]" />
              <div className="space-y-1">
                <div className="font-semibold">{t({ ko: '계정 삭제', en: 'Delete account' })}</div>
                <div className="text-muted-foreground">
                  {canDeleteAccount
                    ? t({ ko: '정말 지우려면 아래에 {username} 를 그대로 입력해.', en: 'To confirm deletion, type {username} exactly below.' }, { username: account.username })
                    : t({ ko: '레거시 관리자 계정은 여기서 삭제하지 않는 게 맞아.', en: 'Legacy admin accounts should not be deleted here.' })}
                </div>
              </div>
            </div>

            {canDeleteAccount ? (
              <>
                <SettingsField label={t({ ko: '확인용 사용자명', en: 'Confirmation username' })}>
                  <Input
                    variant="settings"
                    value={deleteConfirmText}
                    disabled={isDeletingAccount}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder={account.username}
                  />
                </SettingsField>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={isDeletingAccount}>{t({ ko: '닫기', en: 'Close' })}</Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void submitDelete()}
                    disabled={isDeletingAccount || deleteConfirmText.trim() !== account.username}
                  >
                    {isDeletingAccount ? t({ ko: '삭제 중…', en: 'Deleting…' }) : t({ ko: '계정 삭제', en: 'Delete account' })}
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
