import { FolderInput, Trash2 } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
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
  const { t } = useI18n()

  return (
    <SelectionActionBar
      selectedCount={selectedCount}
      onClear={onClear}
      actions={(
        <>
          <Button size="sm" variant="secondary" onClick={onDeleteSelected} disabled={!onDeleteSelected || isDeleting} data-no-select-drag="true">
            <Trash2 className="h-4 w-4" />
            {isDeleting ? t('prompts.components.prompt.selection.bar.deleting') : t('prompts.components.prompt.selection.bar.delete')}
          </Button>

          <Button size="sm" onClick={onAssignGroup} disabled={isSubmitting} data-no-select-drag="true">
            <FolderInput className="h-4 w-4" />
            {isSubmitting ? t('prompts.components.prompt.selection.bar.applying') : t('prompts.components.prompt.selection.bar.assign.group')}
          </Button>
        </>
      )}
    />
  )
}
