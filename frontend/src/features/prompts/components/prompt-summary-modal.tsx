import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { PromptCollectionItem, PromptGroupRecord, PromptStatistics, PromptTypeFilter } from '@/types/prompt'
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
  return (
    <SettingsModal open={open} onClose={onClose} title="상태" widthClassName="max-w-6xl">
      <PromptSummaryPanel promptType={promptType} statistics={statistics} topPrompts={topPrompts} groupStatistics={groupStatistics} />
    </SettingsModal>
  )
}
