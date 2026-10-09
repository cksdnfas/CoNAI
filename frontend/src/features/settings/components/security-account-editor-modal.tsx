import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { Field, FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { getAccountStatusLabel, getPermissionGroupDisplayName } from './security-ui-text'
import { getSecurityGroupBadgeStyle, type SecurityGroupColorMap, getSecurityGroupColor } from './security-group-color-utils'
import { SettingsStatLine } from './settings-rows'

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
    <Modal
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
        <SettingsStatLine
          items={[
            { label: t({ ko: '생성일', en: 'Created' }), value: formatDateTime(account.createdAt) },
            { label: t({ ko: '수정일', en: 'Updated' }), value: formatDateTime(account.updatedAt) },
            { label: t({ ko: '최근 로그인', en: 'Last login' }), value: account.lastLoginAt ? formatDateTime(account.lastLoginAt) : '—' },
          ]}
        />

        <div className="flex flex-wrap gap-1">
          <IconButton variant="ghost" size="icon-sm" active={activeSection === 'group'} label={t({ ko: '그룹 바꾸기', en: 'Change group' })} onClick={() => setActiveSection('group')}>
            <Shield className="h-4 w-4" />
          </IconButton>
          <IconButton variant="ghost" size="icon-sm" active={activeSection === 'password'} label={t({ ko: '비밀번호 바꾸기', en: 'Change password' })} onClick={() => setActiveSection('password')}>
            <KeyRound className="h-4 w-4" />
          </IconButton>
          <IconButton variant={activeSection === 'danger' ? 'destructive' : 'ghost'} size="icon-sm" active={activeSection === 'danger'} label={t({ ko: '계정 삭제', en: 'Delete account' })} onClick={() => setActiveSection('danger')}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>

        {activeSection === 'group' ? (
          <div className="space-y-4">
            <Field label={t({ ko: '기본 그룹', en: 'Base group' })}>
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
            </Field>

            <div className="space-y-2 text-sm text-muted-foreground">
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
          <div className="space-y-4">
            {canChangeLegacyAdminPassword ? (
              <>
                <Field label={t({ ko: '새 비밀번호', en: 'New password' })}>
                  <Input
                    variant="settings"
                    type="password"
                    value={nextPassword}
                    disabled={isUpdatingPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                    placeholder={t({ ko: '새 비밀번호', en: 'New password' })}
                  />
                </Field>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={isUpdatingPassword}>{t({ ko: '닫기', en: 'Close' })}</Button>
                  <Button type="button" onClick={() => void submitPasswordChange()} disabled={isUpdatingPassword || !nextPassword.trim()}>
                    {isUpdatingPassword ? t({ ko: '변경 중…', en: 'Updating…' }) : t({ ko: '변경', en: 'Update' })}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                {t({ ko: '여기선 못 바꿔', en: 'Not editable here' })}
                <FieldInfo>{t({ ko: '레거시 관리자 계정이라 비밀번호는 관리자 계정 카드에서 바꿔.', en: 'Legacy admin account: change its password in the admin account card.' })}</FieldInfo>
              </div>
            )}
          </div>
        ) : null}

        {activeSection === 'danger' ? (
          <div className="space-y-4 rounded-sm bg-destructive-soft/40 p-4">
            <div className="flex items-start gap-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                <div className="font-semibold">{t({ ko: '계정 삭제', en: 'Delete account' })}</div>
                {canDeleteAccount ? null : (
                  <div className="text-muted-foreground">{t({ ko: '레거시 관리자 계정은 여기서 못 지워.', en: 'Legacy admin accounts cannot be deleted here.' })}</div>
                )}
              </div>
            </div>

            {canDeleteAccount ? (
              <>
                <Field
                  label={t({ ko: '확인용 사용자명', en: 'Confirmation username' })}
                  info={t({ ko: '정말 지우려면 {username} 를 그대로 입력해.', en: 'To confirm deletion, type {username} exactly.' }, { username: account.username })}
                >
                  <Input
                    variant="settings"
                    value={deleteConfirmText}
                    disabled={isDeletingAccount}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder={account.username}
                  />
                </Field>

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
    </Modal>
  )
}
