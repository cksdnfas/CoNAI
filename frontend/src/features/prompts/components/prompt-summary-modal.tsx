import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { PromptCollectionItem, PromptGroupRecord, PromptStatistics, PromptTypeFilter } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { PromptSummaryPanel } from './prompt-summary-panel'

interface PromptSummaryModalProps {
  open: boolean
  promptType: PromptTypeFilter
  statistics?: PromptStatistics
  topPrompts?: PromptCollectionItem[]
  groupStatistics?: PromptGroupRecord[]
  onClose: () => void
}

export function PromptSummaryModal({
  open,
  promptType,
  statistics,
  topPrompts = [],
  groupStatistics = [],
  onClose,
}: PromptSummaryModalProps) {
  const { t } = useI18n()

  return (
    <SettingsModal open={open} onClose={onClose} title={t('prompts.components.prompt.summary.modal.status')} widthClassName="max-w-6xl">
      <PromptSummaryPanel promptType={promptType} statistics={statistics} topPrompts={topPrompts} groupStatistics={groupStatistics} />
    </SettingsModal>
  )
}
