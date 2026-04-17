import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { toggleSelectionItem, type ModuleFieldOption } from '../image-generation-shared'

interface NaiModuleSaveModalProps {
  open: boolean
  moduleName: string
  moduleDescription: string
  fieldOptions: ModuleFieldOption[]
  exposedFieldKeys: string[]
  isSaving: boolean
  onClose: () => void
  onModuleNameChange: (value: string) => void
  onModuleDescriptionChange: (value: string) => void
  onExposedFieldKeysChange: (value: string[]) => void
  onSave: () => void
}

export function NaiModuleSaveModal({
  open,
  moduleName,
  moduleDescription,
  fieldOptions,
  exposedFieldKeys,
  isSaving,
  onClose,
  onModuleNameChange,
  onModuleDescriptionChange,
  onExposedFieldKeysChange,
  onSave,
}: NaiModuleSaveModalProps) {
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="NAI 모듈 저장"
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="모듈 이름">
            <Input value={moduleName} onChange={(event) => onModuleNameChange(event.target.value)} placeholder="NAI Character Module" />
          </SettingsField>

          <SettingsField label="설명">
            <Input value={moduleDescription} onChange={(event) => onModuleDescriptionChange(event.target.value)} placeholder="선택" />
          </SettingsField>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">노출 입력</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldOptions.map((field) => {
              const checked = exposedFieldKeys.includes(field.key)
              return (
                <label key={field.key} className="flex items-center gap-2 rounded-sm border border-border/70 bg-surface-low/45 px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onExposedFieldKeysChange(toggleSelectionItem(exposedFieldKeys, field.key))}
                  />
                  <span>{field.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving || moduleName.trim().length === 0}>
            {isSaving ? '저장 중…' : '저장'}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
