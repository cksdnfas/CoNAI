import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsInsetBlock, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import type { ModuleDefinitionRecord } from '@/lib/api'
import { toggleSelectionItem, type ModuleFieldOption } from '../image-generation-shared'

interface ComfyModuleSaveModalProps {
  open: boolean
  moduleName: string
  moduleDescription: string
  fieldOptions: ModuleFieldOption[]
  exposedFieldIds: string[]
  isSaving: boolean
  overwriteCandidates?: ModuleDefinitionRecord[]
  overwriteModuleId?: number | null
  onClose: () => void
  onModuleNameChange: (value: string) => void
  onModuleDescriptionChange: (value: string) => void
  onExposedFieldIdsChange: (value: string[]) => void
  onOverwriteModuleIdChange?: (value: number | null) => void
  onSave: () => void
}

export function ComfyModuleSaveModal({
  open,
  moduleName,
  moduleDescription,
  fieldOptions,
  exposedFieldIds,
  isSaving,
  overwriteCandidates = [],
  overwriteModuleId = null,
  onClose,
  onModuleNameChange,
  onModuleDescriptionChange,
  onExposedFieldIdsChange,
  onOverwriteModuleIdChange,
  onSave,
}: ComfyModuleSaveModalProps) {
  const selectedOverwriteModule = overwriteCandidates.find((module) => module.id === overwriteModuleId) ?? null
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="ComfyUI 모듈 저장"
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="저장 방식">
            <Select value={overwriteModuleId ? String(overwriteModuleId) : ''} onChange={(event) => onOverwriteModuleIdChange?.(event.target.value ? Number(event.target.value) : null)}>
              <option value="">새 모듈 생성</option>
              {overwriteCandidates.map((module) => (
                <option key={module.id} value={module.id}>#{module.id} {module.name}</option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="모듈 이름">
            <Input value={moduleName} onChange={(event) => onModuleNameChange(event.target.value)} placeholder="ComfyUI Workflow Module" />
          </SettingsField>

          <SettingsField label="설명">
            <Input value={moduleDescription} onChange={(event) => onModuleDescriptionChange(event.target.value)} placeholder="선택" />
          </SettingsField>

          {selectedOverwriteModule ? (
            <div className="rounded-sm border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning-foreground md:col-span-2">
              #{selectedOverwriteModule.id} 모듈을 같은 ID로 덮어써. 기존 그래프 연결은 포트 key가 유지되는 항목만 그대로 살아남아.
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">노출 입력</div>
          {fieldOptions.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fieldOptions.map((field) => {
                const checked = exposedFieldIds.includes(field.key)
                return (
                  <label key={field.key} className="flex items-center gap-2 rounded-sm border border-border/70 bg-surface-low/45 px-3 py-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onExposedFieldIdsChange(toggleSelectionItem(exposedFieldIds, field.key))}
                    />
                    <span>{field.label}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <SettingsInsetBlock className="text-sm text-muted-foreground">
              노출 가능한 입력 필드가 없어. 이 워크플로우는 고정 모듈로 저장돼.
            </SettingsInsetBlock>
          )}
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
