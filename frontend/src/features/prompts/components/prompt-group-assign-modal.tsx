import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { buildPromptGroupOptionItems } from '@/features/prompts/prompt-group-option-utils'
import type { PromptGroupRecord } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptGroupAssignModalProps {
  open: boolean
  groups: PromptGroupRecord[]
  selectedCount: number
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (groupId: number | null) => Promise<void>
}

export function PromptGroupAssignModal({
  open,
  groups,
  isSubmitting = false,
  onClose,
  onSubmit,
}: PromptGroupAssignModalProps) {
  const { t, formatNumber } = useI18n()
  const groupOptions = useMemo(() => buildPromptGroupOptionItems(groups), [groups])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedGroupId(groupOptions[0] ? String(groupOptions[0].id) : '')
    setFormError(null)
  }, [groupOptions, open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedGroupId) {
      setFormError(t('prompts.components.prompt.group.assign.modal.choose.a.destination.group.first'))
      return
    }

    setFormError(null)
    await onSubmit(Number(selectedGroupId))
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={t('prompts.components.prompt.group.assign.modal.assign.selected.prompts.to.a.group')}
      widthClassName="max-w-xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('prompts.components.prompt.group.assign.modal.confirmation.required')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('prompts.components.prompt.group.assign.modal.target.group')}</p>
            <HierarchyPicker
              items={groups}
              selectedId={selectedGroupId ? Number(selectedGroupId) : null}
              onSelect={(group) => setSelectedGroupId(String(group.id))}
              getId={(group) => group.id}
              getParentId={(group) => group.parent_id}
              getLabel={(group) => (
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate">{group.group_name}</span>
                  <span className="shrink-0 text-xs">{formatNumber(group.prompt_count ?? 0)}</span>
                </div>
              )}
              sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
              showRootOption={false}
            />
          </div>

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting || groupOptions.length === 0}>
              {isSubmitting ? t('prompts.components.prompt.group.assign.modal.applying') : t('prompts.components.prompt.group.assign.modal.assign.group')}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
