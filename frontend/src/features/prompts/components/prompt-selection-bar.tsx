import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { FolderInput, Trash2 } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
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
          <IconButton size="icon-sm" variant="secondary" onClick={onDeleteSelected} disabled={!canDeletePrompts || !onDeleteSelected || isDeleting} data-no-select-drag="true" label={isDeleting ? t('prompts.components.prompt.selection.bar.deleting') : t('prompts.components.prompt.selection.bar.delete')}>
            <Trash2 />
          </IconButton>

          <Button size="sm" onClick={onAssignGroup} disabled={!canUpdatePrompts || isSubmitting} data-no-select-drag="true">
            <FolderInput className="h-4 w-4" />
            {isSubmitting ? t('prompts.components.prompt.selection.bar.applying') : t('prompts.components.prompt.selection.bar.assign.group')}
          </Button>
        </>
      )}
    />
  )
}
