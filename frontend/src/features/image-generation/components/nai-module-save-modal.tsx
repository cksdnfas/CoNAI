import { ModuleSaveModal, type ModuleSaveModalProps } from './module-save-modal'

type NaiModuleSaveModalProps = Omit<ModuleSaveModalProps, 'title' | 'moduleNamePlaceholder'>

export function NaiModuleSaveModal(props: NaiModuleSaveModalProps) {
  return (
    <ModuleSaveModal
      {...props}
      title="NAI 모듈 저장"
      moduleNamePlaceholder="NAI Character Module"
    />
  )
}
