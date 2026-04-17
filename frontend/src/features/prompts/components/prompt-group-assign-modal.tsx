import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { buildPromptGroupOptionItems } from '@/features/prompts/prompt-group-option-utils'
import type { PromptGroupRecord } from '@/types/prompt'

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
  selectedCount,
  isSubmitting = false,
  onClose,
  onSubmit,
}: PromptGroupAssignModalProps) {
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
      setFormError('먼저 이동할 그룹을 골라줘.')
      return
    }

    setFormError(null)
    await onSubmit(Number(selectedGroupId))
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="선택 프롬프트 그룹 지정"
      widthClassName="max-w-xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">대상 그룹</p>
            <HierarchyPicker
              items={groups}
              selectedId={selectedGroupId ? Number(selectedGroupId) : null}
              onSelect={(group) => setSelectedGroupId(String(group.id))}
              getId={(group) => group.id}
              getParentId={(group) => group.parent_id}
              getLabel={(group) => (
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate">{group.group_name}</span>
                  <span className="shrink-0 text-xs">{(group.prompt_count ?? 0).toLocaleString('ko-KR')}</span>
                </div>
              )}
              sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
              showRootOption={false}
            />
          </div>

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting || groupOptions.length === 0}>
              {isSubmitting ? '적용 중…' : '그룹 지정'}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
