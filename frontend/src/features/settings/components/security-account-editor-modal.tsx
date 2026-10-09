import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { AuthAccountListItem, PermissionGroupListItem } from '@/lib/api-auth'
import { Field, FieldInfo } from '@/components/ui/field'
import { EditorFooter } from '@/components/ui/editor-footer'
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

  const groupChanged = groupDraft !== account.accountType
  const passwordTyped = nextPassword.trim().length > 0
  const dirty = open && (groupChanged || passwordTyped)
  const save = activeSection === 'group'
    ? (groupChanged && !isUpdatingGroup ? () => void submitGroupChange() : undefined)
    : activeSection === 'password' && canChangeLegacyAdminPassword
      ? (passwordTyped && !isUpdatingPassword ? () => void submitPasswordChange() : undefined)
      : undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account.username}
      size="normal"
      height="medium"
      dirty={dirty}
      onSave={save}
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

        <TextTabs
          value={activeSection}
          onChange={setActiveSection}
          ariaLabel={t({ ko: '계정 편집 항목', en: 'Account sections' })}
          items={[
            { value: 'group', label: t({ ko: '그룹', en: 'Group' }) },
            { value: 'password', label: t({ ko: '비밀번호', en: 'Password' }) },
            { value: 'danger', label: t({ ko: '삭제', en: 'Delete' }) },
          ]}
        />

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
        ) : null}

        {activeSection === 'password' ? (
          canChangeLegacyAdminPassword ? (
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
          ) : (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {t({ ko: '여기선 못 바꿔', en: 'Not editable here' })}
              <FieldInfo>{t({ ko: '레거시 관리자 계정이라 비밀번호는 관리자 계정 카드에서 바꿔.', en: 'Legacy admin account: change its password in the admin account card.' })}</FieldInfo>
            </div>
          )
        ) : null}

        {activeSection === 'danger' ? (
          canDeleteAccount ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field
                className="min-w-48 flex-1"
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
              <Button
                type="button"
                variant="destructive-ghost"
                className="h-10"
                onClick={() => void submitDelete()}
                disabled={isDeletingAccount || deleteConfirmText.trim() !== account.username}
              >
                {isDeletingAccount ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                {t({ ko: '계정 삭제', en: 'Delete account' })}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t({ ko: '레거시 관리자 계정은 여기서 못 지워.', en: 'Legacy admin accounts cannot be deleted here.' })}</p>
          )
        ) : null}
      </div>
      {activeSection === 'danger' ? null : (
        <EditorFooter
          onSave={activeSection === 'group' ? () => void submitGroupChange() : () => void submitPasswordChange()}
          canSave={activeSection === 'group' ? groupChanged : canChangeLegacyAdminPassword && passwordTyped}
          saving={activeSection === 'group' ? isUpdatingGroup : isUpdatingPassword}
          saveLabel={activeSection === 'group' ? t({ ko: '그룹 저장', en: 'Save group' }) : t({ ko: '비밀번호 변경', en: 'Change password' })}
        />
      )}
    </Modal>
  )
}
