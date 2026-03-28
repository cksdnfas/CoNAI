import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">모듈 이름</span>
            <Input value={moduleName} onChange={(event) => onModuleNameChange(event.target.value)} placeholder="NAI Character Module" />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">설명</span>
            <Input value={moduleDescription} onChange={(event) => onModuleDescriptionChange(event.target.value)} placeholder="선택" />
          </label>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">노출 입력</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldOptions.map((field) => {
              const checked = exposedFieldKeys.includes(field.key)
              return (
                <label key={field.key} className="flex items-center gap-2 rounded-sm bg-surface-low px-3 py-2 text-sm text-foreground">
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

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving || moduleName.trim().length === 0}>
            {isSaving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}
