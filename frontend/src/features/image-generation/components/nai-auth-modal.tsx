import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
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
  const { isAdmin } = useFeaturePermissions()
  const submitDisabled = !isAdmin || isSubmitting || token.trim().length === 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t({ ko: 'NovelAI 토큰 연결', en: 'Connect NovelAI Token' })}
      widthClassName="max-w-2xl"
    >
      <ModalBody>
        {!isAdmin ? <Text>{t({ ko: '서버 토큰 변경은 관리자 권한이 필요해.', en: 'Changing the server token requires an administrator.' })}</Text> : null}
        <FormField label={t({ ko: '영구 API 토큰', en: 'Persistent API Token' })}>
          <Input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="pst-…"
            autoComplete="off"
          />
        </FormField>

        {showStatusHint ? <Text variant="caption" className="text-destructive">{connectionHint}</Text> : null}

        <ModalFooter className="justify-between">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t('image-generation.components.nai.auth.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submitDisabled}>
            {isSubmitting
              ? t('image-generation.components.nai.auth.modal.connecting')
              : t('image-generation.components.nai.auth.modal.save.token')}
          </Button>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}
