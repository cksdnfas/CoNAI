import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'

type NaiAssetSaveModalProps = {
  open: boolean
  title: string
  submitLabel?: string
  name: string
  description: string
  isSaving: boolean
  onClose: () => void
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSave: () => void
}

export function NaiAssetSaveModal({
  open,
  title,
  submitLabel,
  name,
  description,
  isSaving,
  onClose,
  onNameChange,
  onDescriptionChange,
  onSave,
}: NaiAssetSaveModalProps) {
  const { t } = useI18n()
  const { canUpdateWorkflows } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const effectiveSubmitLabel = submitLabel ?? t('image-generation.components.nai.asset.save.modal.save')

  return (
    <Modal open={open} onClose={onClose} title={title} widthClassName="max-w-xl">
      <ModalBody>
        <Field label={t('image-generation.components.nai.asset.save.modal.name')}>
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={t('image-generation.components.nai.asset.save.modal.save.name')} />
        </Field>

        <Field label={t('image-generation.components.nai.asset.save.modal.description')}>
          <Textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={4}
            placeholder={t('image-generation.components.nai.asset.save.modal.optional')}
          />
        </Field>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('image-generation.components.nai.asset.save.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!canUpdateWorkflows || !canViewImages || isSaving || name.trim().length === 0}>
            {isSaving
              ? t('image-generation.components.nai.asset.save.modal.saving.with.action', { action: effectiveSubmitLabel })
              : effectiveSubmitLabel}
          </Button>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}
