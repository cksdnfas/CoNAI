import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { FolderInput, Trash2 } from 'lucide-react'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { useI18n } from '@/i18n'

interface PromptSelectionBarProps {
  selectedCount: number
  isSubmitting?: boolean
  isDeleting?: boolean
  onAssignGroup: () => void
  onDeleteSelected?: () => void
  onClear: () => void
}

export function PromptSelectionBar({ selectedCount, isSubmitting = false, isDeleting = false, onAssignGroup, onDeleteSelected, onClear }: PromptSelectionBarProps) {
  const { canUpdatePrompts, canDeletePrompts } = useFeaturePermissions()
  const { t } = useI18n()

  return (
    <SelectionActionBar
      selectedCount={selectedCount}
      onClear={onClear}
      actions={(
        <>
          <SelectionBarAction
            icon={Trash2}
            label={isDeleting ? t('prompts.components.prompt.selection.bar.deleting') : t('prompts.components.prompt.selection.bar.delete')}
            onClick={onDeleteSelected}
            disabled={!canDeletePrompts || !onDeleteSelected || isDeleting}
          />

          <SelectionBarAction
            icon={FolderInput}
            label={isSubmitting ? t('prompts.components.prompt.selection.bar.applying') : t('prompts.components.prompt.selection.bar.assign.group')}
            variant="default"
            onClick={onAssignGroup}
            disabled={!canUpdatePrompts || isSubmitting}
          />
        </>
      )}
    />
  )
}
