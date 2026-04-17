import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'

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
  return (
    <SettingsModal open={open} onClose={onClose} title={title} widthClassName="max-w-xl">
      <SettingsModalBody>
        <SettingsField label="이름">
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="저장 이름" />
        </SettingsField>

        <SettingsField label="설명">
          <Textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={4}
            placeholder="선택 사항"
          />
        </SettingsField>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving || name.trim().length === 0}>
            {isSaving ? `${submitLabel ?? '저장'} 중…` : (submitLabel ?? '저장')}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
