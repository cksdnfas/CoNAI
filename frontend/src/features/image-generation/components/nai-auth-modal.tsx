import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'
import type { NaiLoginMode } from './use-nai-auth-controller'

type NaiAuthModalProps = {
  open: boolean
  loginMode: NaiLoginMode
  isSubmitting: boolean
  username: string
  password: string
  token: string
  connectionHint: string
  showStatusHint: boolean
  onClose: () => void
  onLoginModeChange: (mode: NaiLoginMode) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onTokenChange: (value: string) => void
  onSubmit: () => void
}

/** Render the NovelAI authentication modal used from the status header. */
export function NaiAuthModal({
  open,
  loginMode,
  isSubmitting,
  username,
  password,
  token,
  connectionHint,
  showStatusHint,
  onClose,
  onLoginModeChange,
  onUsernameChange,
  onPasswordChange,
  onTokenChange,
  onSubmit,
}: NaiAuthModalProps) {
  const { t } = useI18n()
  const submitDisabled = isSubmitting || (loginMode === 'account' ? username.trim().length === 0 || password.length === 0 : token.trim().length === 0)

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t('image-generation.components.nai.auth.modal.novelai.login')}
      description={t('image-generation.components.nai.auth.modal.connect.with.account.login.or.by.saving')}
      widthClassName="max-w-2xl"
    >
      <SettingsModalBody>
        <SegmentedTabBar
          value={loginMode}
          items={[
            { value: 'account', label: t('image-generation.components.nai.auth.modal.log.in') },
            { value: 'token', label: t('image-generation.components.nai.auth.modal.token') },
          ]}
          onChange={(nextMode) => onLoginModeChange(nextMode as NaiLoginMode)}
          fullWidth
          size="sm"
        />

        {loginMode === 'account' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Username">
              <Input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
            </FormField>
            <FormField label="Password">
              <Input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="current-password" />
            </FormField>
          </div>
        ) : (
          <FormField label="Access Token">
            <Input
              value={token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder=""
              autoComplete="off"
            />
          </FormField>
        )}

        {showStatusHint ? <div className="text-xs text-[#ffb4ab]">{connectionHint}</div> : null}

        <SettingsModalFooter className="justify-between">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('image-generation.components.nai.auth.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitDisabled}>
            {isSubmitting
              ? t('image-generation.components.nai.auth.modal.connecting')
              : loginMode === 'account'
                ? t('image-generation.components.nai.auth.modal.log.in')
                : t('image-generation.components.nai.auth.modal.save.token')}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
