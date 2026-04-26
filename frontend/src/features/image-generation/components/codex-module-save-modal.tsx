import { ModuleSaveModal, type ModuleSaveModalProps } from './module-save-modal'

type CodexModuleSaveModalProps = Omit<ModuleSaveModalProps, 'title' | 'moduleNamePlaceholder'>

export function CodexModuleSaveModal(props: CodexModuleSaveModalProps) {
  return (
    <ModuleSaveModal
      {...props}
      title="Codex 모듈 저장"
      moduleNamePlaceholder="Codex Image Module"
    />
  )
}
