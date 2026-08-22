import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'

type NaiAuthModalProps = {
  open: boolean
  isSubmitting: boolean
  token: string
  connectionHint: string
  showStatusHint: boolean
  onClose: () => void
  onTokenChange: (value: string) => void
  onSubmit: () => void
}

/** Render the NovelAI authentication modal used from the status header. */
export function NaiAuthModal({
  open,
  isSubmitting,
  token,
  connectionHint,
  showStatusHint,
  onClose,
  onTokenChange,
  onSubmit,
}: NaiAuthModalProps) {
  const { t } = useI18n()
  const submitDisabled = isSubmitting || token.trim().length === 0

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t({ ko: 'NovelAI 토큰 연결', en: 'Connect NovelAI Token' })}
      description={t({ ko: 'NovelAI 영구 API 토큰을 저장해서 연결해.', en: 'Connect by saving a NovelAI persistent API token.' })}
      widthClassName="max-w-2xl"
    >
      <SettingsModalBody>
        <FormField label={t({ ko: '영구 API 토큰', en: 'Persistent API Token' })}>
          <Input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="pst-…"
            autoComplete="off"
          />
        </FormField>

        {showStatusHint ? <div className="text-xs text-[#ffb4ab]">{connectionHint}</div> : null}

        <SettingsModalFooter className="justify-between">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('image-generation.components.nai.auth.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitDisabled}>
            {isSubmitting
              ? t('image-generation.components.nai.auth.modal.connecting')
              : t('image-generation.components.nai.auth.modal.save.token')}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
