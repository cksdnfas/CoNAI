import { useI18n } from '@/i18n'
import { ModuleSaveModal, type ModuleSaveModalProps } from './module-save-modal'

type NaiModuleSaveModalProps = Omit<ModuleSaveModalProps, 'title' | 'moduleNamePlaceholder'>

export function NaiModuleSaveModal(props: NaiModuleSaveModalProps) {
  const { t } = useI18n()

  return (
    <ModuleSaveModal
      {...props}
      title={t('image-generation.components.nai.module.save.modal.save.nai.module')}
      moduleNamePlaceholder="NAI Character Module"
    />
  )
}
