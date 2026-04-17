import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { buildGroupOptionItems } from '@/features/groups/group-option-utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupAssignModalProps {
  open: boolean
  groups: GroupWithHierarchy[]
  selectedCount: number
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (groupId: number) => Promise<void>
}

export function GroupAssignModal({
  open,
  groups,
  selectedCount: _selectedCount,
  isSubmitting = false,
  onClose,
  onSubmit,
}: GroupAssignModalProps) {
  const groupOptions = useMemo(() => buildGroupOptionItems(groups), [groups])
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
      setFormError('먼저 할당할 그룹을 골라줘.')
      return
    }

    setFormError(null)
    await onSubmit(Number(selectedGroupId))
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="선택 이미지를 그룹에 추가"
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
          {groupOptions.length > 0 ? (
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
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-xs">{group.image_count.toLocaleString('ko-KR')}</span>
                  </div>
                )}
                sortItems={(left, right) => left.name.localeCompare(right.name)}
                renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
                showRootOption={false}
              />
            </div>
          ) : (
            <Alert>
              <AlertTitle>그룹이 없어</AlertTitle>
              <AlertDescription>먼저 그룹을 만들어줘.</AlertDescription>
            </Alert>
          )}

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting || groupOptions.length === 0}>
              {isSubmitting ? '추가 중…' : '그룹에 추가'}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
