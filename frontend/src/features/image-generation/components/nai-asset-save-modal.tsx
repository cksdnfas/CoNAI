import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
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
  const effectiveSubmitLabel = submitLabel ?? t('image-generation.components.nai.asset.save.modal.save')

  return (
    <SettingsModal open={open} onClose={onClose} title={title} widthClassName="max-w-xl">
      <SettingsModalBody>
        <SettingsField label={t('image-generation.components.nai.asset.save.modal.name')}>
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={t('image-generation.components.nai.asset.save.modal.save.name')} />
        </SettingsField>

        <SettingsField label={t('image-generation.components.nai.asset.save.modal.description')}>
          <Textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={4}
            placeholder={t('image-generation.components.nai.asset.save.modal.optional')}
          />
        </SettingsField>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            {t('image-generation.components.nai.asset.save.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving || name.trim().length === 0}>
            {isSaving
              ? t('image-generation.components.nai.asset.save.modal.saving.with.action', { action: effectiveSubmitLabel })
              : effectiveSubmitLabel}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
