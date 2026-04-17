import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptGroupEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  promptType: 'positive' | 'negative' | 'auto'
  groups: PromptGroupRecord[]
  group?: PromptGroupRecord | null
  defaultParentId?: number | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: { group_name: string; parent_id?: number | null; is_visible?: boolean }) => Promise<void>
}

export function PromptGroupEditorModal({
  open,
  mode,
  promptType,
  groups,
  group,
  defaultParentId = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: PromptGroupEditorModalProps) {
  const [groupName, setGroupName] = useState('')
  const [parentValue, setParentValue] = useState('root')
  const [isVisible, setIsVisible] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setGroupName(group?.group_name ?? '')
    setParentValue(String(group?.parent_id ?? defaultParentId ?? 'root'))
    setIsVisible(group?.is_visible ?? true)
    setFormError(null)
  }, [defaultParentId, group, open])

  const parentGroups = useMemo(
    () => groups.filter((item) => item.id !== 0 && item.id !== group?.id),
    [group?.id, groups],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = groupName.trim()

    if (!trimmedName) {
      setFormError('그룹 이름은 꼭 필요해.')
      return
    }

    setFormError(null)
    await onSubmit({
      group_name: trimmedName,
      parent_id: parentValue === 'root' ? null : Number(parentValue),
      is_visible: isVisible,
    })
  }

  const typeLabel = promptType === 'positive' ? 'Positive' : promptType === 'negative' ? 'Negative' : 'Auto'

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? `${typeLabel} 그룹 만들기` : `${typeLabel} 그룹 편집`}
      widthClassName="max-w-2xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <SettingsField label="그룹 이름">
            <Input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="예: 캐릭터 / 배경 / LoRA" />
          </SettingsField>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">부모 그룹</p>
            <HierarchyPicker
              items={parentGroups}
              selectedId={parentValue === 'root' ? null : Number(parentValue)}
              onSelectRoot={() => setParentValue('root')}
              onSelect={(candidate) => setParentValue(String(candidate.id))}
              getId={(candidate) => candidate.id}
              getParentId={(candidate) => candidate.parent_id}
              getLabel={(candidate) => candidate.group_name}
              sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
            />
          </div>

          <SettingsToggleRow className="justify-between">
            <span className="font-medium text-foreground">표시 상태</span>
            <input type="checkbox" checked={isVisible} onChange={(event) => setIsVisible(event.target.checked)} />
          </SettingsToggleRow>

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '저장 중…' : mode === 'create' ? '그룹 만들기' : '변경 저장'}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
