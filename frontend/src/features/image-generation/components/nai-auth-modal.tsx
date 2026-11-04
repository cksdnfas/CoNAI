import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'

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
      open={open && isAdmin}
      onClose={onClose}
      title={t({ ko: 'NovelAI 토큰 연결', en: 'Connect NovelAI Token' })}
      size="md"
    >
      <ModalBody>
        <Field label={t({ ko: '영구 API 토큰', en: 'Persistent API Token' })}>
          <Input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="pst-…"
            autoComplete="off"
          />
        </Field>

        {showStatusHint ? <Text variant="caption" tone="destructive">{connectionHint}</Text> : null}

      </ModalBody>
      <EditorFooter
        onSave={onSubmit}
        canSave={!submitDisabled}
        saving={isSubmitting}
      />
    </Modal>
  )
}
