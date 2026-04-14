import { KeyRound, Save, ShieldCheck } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SettingsField } from './settings-primitives'

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
  const isSetupDisabled = isSubmittingSetup || setupUsername.trim().length === 0 || setupPassword.length === 0
  const isUpdateDisabled =
    isSubmittingUpdate ||
    currentPassword.length === 0 ||
    (nextUsername.trim().length === 0 && !currentUsername) ||
    nextPassword.length === 0

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          heading={!hasCredentials ? '관리자 계정' : '관리자 계정 변경'}
          actions={
            <div className="rounded-sm bg-primary/10 p-2 text-primary">
              {hasCredentials ? <KeyRound className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            </div>
          }
        />

        {!hasCredentials ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label="아이디">
                <Input
                  variant="settings"
                  value={setupUsername}
                  onChange={(event) => onSetupUsernameChange(event.target.value)}
                  autoComplete="username"
                />
              </SettingsField>
              <SettingsField label="비밀번호">
                <Input
                  type="password"
                  variant="settings"
                  value={setupPassword}
                  onChange={(event) => onSetupPasswordChange(event.target.value)}
                  autoComplete="new-password"
                />
              </SettingsField>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={onSubmitSetup} disabled={isSetupDisabled}>
                {isSubmittingSetup ? '생성 중…' : '생성'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <SettingsField label="현재 비밀번호">
                <Input
                  type="password"
                  variant="settings"
                  value={currentPassword}
                  onChange={(event) => onCurrentPasswordChange(event.target.value)}
                  autoComplete="current-password"
                />
              </SettingsField>
              <SettingsField label="새 아이디">
                <Input
                  variant="settings"
                  value={nextUsername}
                  onChange={(event) => onNextUsernameChange(event.target.value)}
                  autoComplete="username"
                  placeholder={currentUsername ?? '새 아이디'}
                />
              </SettingsField>
              <SettingsField label="새 비밀번호">
                <Input
                  type="password"
                  variant="settings"
                  value={nextPassword}
                  onChange={(event) => onNextPasswordChange(event.target.value)}
                  autoComplete="new-password"
                />
              </SettingsField>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="icon-sm"
                onClick={onSubmitUpdate}
                disabled={isUpdateDisabled}
                aria-label={isSubmittingUpdate ? '관리자 계정 변경 중' : '관리자 계정 저장'}
                title={isSubmittingUpdate ? '관리자 계정 변경 중' : '관리자 계정 저장'}
              >
                <Save className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
