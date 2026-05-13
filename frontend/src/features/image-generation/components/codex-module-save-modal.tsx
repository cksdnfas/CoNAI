import { useI18n } from '@/i18n'
import { ModuleSaveModal, type ModuleSaveModalProps } from './module-save-modal'

type CodexModuleSaveModalProps = Omit<ModuleSaveModalProps, 'title' | 'moduleNamePlaceholder'>

export function CodexModuleSaveModal(props: CodexModuleSaveModalProps) {
  const { t } = useI18n()

  return (
    <ModuleSaveModal
      {...props}
      title={t('image-generation.components.codex.module.save.modal.save.codex.module')}
      moduleNamePlaceholder="Codex Image Module"
    />
  )
}
