import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord } from '@/lib/api-module-graph'
import { toggleSelectionItem, type ModuleFieldOption } from '../image-generation-shared'

export interface ModuleSaveModalProps {
  open: boolean
  title: string
  moduleNamePlaceholder: string
  moduleName: string
  moduleDescription: string
  fieldOptions: ModuleFieldOption[]
  exposedFieldKeys: string[]
  isSaving: boolean
  overwriteCandidates?: ModuleDefinitionRecord[]
  overwriteModuleId?: number | null
  onClose: () => void
  onModuleNameChange: (value: string) => void
  onModuleDescriptionChange: (value: string) => void
  onExposedFieldKeysChange: (value: string[]) => void
  onOverwriteModuleIdChange?: (value: number | null) => void
  onSave: () => void
}

export function ModuleSaveModal({
  open,
  title,
  moduleNamePlaceholder,
  moduleName,
  moduleDescription,
  fieldOptions,
  exposedFieldKeys,
  isSaving,
  overwriteCandidates = [],
  overwriteModuleId = null,
  onClose,
  onModuleNameChange,
  onModuleDescriptionChange,
  onExposedFieldKeysChange,
  onOverwriteModuleIdChange,
  onSave,
}: ModuleSaveModalProps) {
  const { t } = useI18n()
  const exposedFieldKeySet = useMemo(() => new Set(exposedFieldKeys), [exposedFieldKeys])
  const selectedOverwriteModule = overwriteCandidates.find((module) => module.id === overwriteModuleId) ?? null
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={title}
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t('image-generation.components.module.save.modal.save.mode')}>
            <Select value={overwriteModuleId ? String(overwriteModuleId) : ''} onChange={(event) => onOverwriteModuleIdChange?.(event.target.value ? Number(event.target.value) : null)}>
              <option value="">{t('image-generation.components.module.save.modal.create.new.module')}</option>
              {overwriteCandidates.map((module) => (
                <option key={module.id} value={module.id}>#{module.id} {module.name}</option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t('image-generation.components.module.save.modal.module.name')}>
            <Input value={moduleName} onChange={(event) => onModuleNameChange(event.target.value)} placeholder={moduleNamePlaceholder} />
          </SettingsField>

          <SettingsField label={t('image-generation.components.module.save.modal.description')}>
            <Input value={moduleDescription} onChange={(event) => onModuleDescriptionChange(event.target.value)} placeholder={t('image-generation.components.module.save.modal.optional')} />
          </SettingsField>

          {selectedOverwriteModule ? (
            <div className="rounded-sm border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning-foreground md:col-span-2">
              {t('image-generation.components.module.save.modal.overwrite.warning', { id: selectedOverwriteModule.id })}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">{t('image-generation.components.module.save.modal.exposed.inputs')}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fieldOptions.map((field) => {
              const checked = exposedFieldKeySet.has(field.key)
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
            {t('image-generation.components.module.save.modal.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={isSaving || moduleName.trim().length === 0}>
            {isSaving ? t('image-generation.components.module.save.modal.saving') : t('image-generation.components.module.save.modal.save')}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
