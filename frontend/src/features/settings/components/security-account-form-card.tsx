import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'

interface SecurityAccountFormCardProps {
  hasCredentials: boolean
  currentUsername: string | null
  setupUsername: string
  setupPassword: string
  currentPassword: string
  nextUsername: string
  nextPassword: string
  onSetupUsernameChange: (value: string) => void
  onSetupPasswordChange: (value: string) => void
  onCurrentPasswordChange: (value: string) => void
  onNextUsernameChange: (value: string) => void
  onNextPasswordChange: (value: string) => void
  onSubmitSetup: () => void
  onSubmitUpdate: () => void
  isSubmittingSetup: boolean
  isSubmittingUpdate: boolean
}

/** Render the first-admin setup form or the current admin credential update form. */
export function SecurityAccountFormCard({
  hasCredentials,
  currentUsername,
  setupUsername,
  setupPassword,
  currentPassword,
  nextUsername,
  nextPassword,
  onSetupUsernameChange,
  onSetupPasswordChange,
  onCurrentPasswordChange,
  onNextUsernameChange,
  onNextPasswordChange,
  onSubmitSetup,
  onSubmitUpdate,
  isSubmittingSetup,
  isSubmittingUpdate,
}: SecurityAccountFormCardProps) {
  const { t } = useI18n()
  const isSetupDisabled = isSubmittingSetup || setupUsername.trim().length === 0 || setupPassword.length === 0
  const isUpdateDisabled =
    isSubmittingUpdate ||
    currentPassword.length === 0 ||
    (nextUsername.trim().length === 0 && !currentUsername) ||
    nextPassword.length === 0

  const labels = {
    username: t({ ko: '아이디', en: 'Username' }),
    password: t({ ko: '비밀번호', en: 'Password' }),
    currentPassword: t({ ko: '현재 비밀번호', en: 'Current password' }),
    nextUsername: t({ ko: '새 아이디', en: 'New username' }),
    nextPassword: t({ ko: '새 비밀번호', en: 'New password' }),
  }

  return (
    <RowGroup heading={!hasCredentials ? t({ ko: '관리자 계정', en: 'Admin account' }) : t({ ko: '관리자 계정 변경', en: 'Change admin account' })}>
      {!hasCredentials ? (
        <>
          <SettingRow label={labels.username} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Input
              variant="settings"
              aria-label={labels.username}
              value={setupUsername}
              onChange={(event) => onSetupUsernameChange(event.target.value)}
              autoComplete="username"
            />
          </SettingRow>
          <SettingRow label={labels.password} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Input
              type="password"
              variant="settings"
              aria-label={labels.password}
              value={setupPassword}
              onChange={(event) => onSetupPasswordChange(event.target.value)}
              autoComplete="new-password"
            />
          </SettingRow>
          <div className="flex justify-end pt-3">
            <Button type="button" size="sm" onClick={onSubmitSetup} disabled={isSetupDisabled}>
              <ShieldCheck className="h-4 w-4" />
              {isSubmittingSetup ? t({ ko: '생성 중…', en: 'Creating…' }) : t({ ko: '생성', en: 'Create' })}
            </Button>
          </div>
        </>
      ) : (
        <>
          <SettingRow label={labels.currentPassword} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Input
              type="password"
              variant="settings"
              aria-label={labels.currentPassword}
              value={currentPassword}
              onChange={(event) => onCurrentPasswordChange(event.target.value)}
              autoComplete="current-password"
            />
          </SettingRow>
          <SettingRow label={labels.nextUsername} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Input
              variant="settings"
              aria-label={labels.nextUsername}
              value={nextUsername}
              onChange={(event) => onNextUsernameChange(event.target.value)}
              autoComplete="username"
              placeholder={currentUsername ?? labels.nextUsername}
            />
          </SettingRow>
          <SettingRow label={labels.nextPassword} controlClassName={SETTINGS_CONTROL_CLASS}>
            <Input
              type="password"
              variant="settings"
              aria-label={labels.nextPassword}
              value={nextPassword}
              onChange={(event) => onNextPasswordChange(event.target.value)}
              autoComplete="new-password"
            />
          </SettingRow>
          <div className="flex justify-end pt-3">
            <Button type="button" size="sm" variant="secondary" onClick={onSubmitUpdate} disabled={isUpdateDisabled}>
              <KeyRound className="h-4 w-4" />
              {isSubmittingUpdate ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
            </Button>
          </div>
        </>
      )}
    </RowGroup>
  )
}
