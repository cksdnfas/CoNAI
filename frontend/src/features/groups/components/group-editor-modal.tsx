import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { collectDescendantGroupIds } from '@/features/groups/group-option-utils'
import type { GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'
import { AutoCollectChipEditor } from './auto-collect-chip-editor'

interface GroupEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  groups: GroupWithHierarchy[]
  group?: GroupRecord | null
  defaultParentId?: number | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: GroupMutationInput) => Promise<void>
}

interface AutoCollectEditorState {
  mode: 'chip' | 'json'
  parsedValue: unknown
  errorMessage: string | null
}

/** Build the editable auto-collect JSON text shown in the group form. */
function getInitialAutoCollectText(group?: GroupRecord | null) {
  return group?.auto_collect_conditions?.trim() ?? ''
}

export function GroupEditorModal({
  open,
  mode,
  groups,
  group,
  defaultParentId = null,
  isSubmitting = false,
  onClose,
  onSubmit,
}: GroupEditorModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('')
  const [parentValue, setParentValue] = useState('root')
  const [autoCollectEnabled, setAutoCollectEnabled] = useState(false)
  const [autoCollectEditorState, setAutoCollectEditorState] = useState<AutoCollectEditorState>({
    mode: 'chip',
    parsedValue: undefined,
    errorMessage: null,
  })
  const [autoCollectInitialText, setAutoCollectInitialText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(group?.name ?? '')
    setDescription(group?.description ?? '')
    setColor(group?.color ?? '')
    setParentValue(String(group?.parent_id ?? defaultParentId ?? 'root'))
    setAutoCollectEnabled(Boolean(group?.auto_collect_enabled))
    setAutoCollectInitialText(getInitialAutoCollectText(group))
    setAutoCollectEditorState({
      mode: 'chip',
      parsedValue: undefined,
      errorMessage: null,
    })
    setFormError(null)
  }, [defaultParentId, group, open])

  const excludedParentIds = useMemo(() => {
    if (mode !== 'edit' || !group) {
      return undefined
    }

    const descendantIds = collectDescendantGroupIds(groups, group.id)
    descendantIds.add(group.id)
    return descendantIds
  }, [group, groups, mode])

  const parentGroups = useMemo(
    () => groups.filter((candidate) => !excludedParentIds?.has(candidate.id)),
    [excludedParentIds, groups],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedColor = color.trim()

    if (!trimmedName) {
      setFormError('그룹 이름은 꼭 필요해.')
      return
    }

    if (autoCollectEnabled && autoCollectEditorState.errorMessage) {
      setFormError(autoCollectEditorState.errorMessage)
      return
    }

    if (autoCollectEnabled && autoCollectEditorState.parsedValue === undefined) {
      setFormError(
        autoCollectEditorState.mode === 'chip'
          ? '필터를 켰다면 조건 칩을 하나 이상 넣어줘야 해.'
          : '필터를 켰다면 조건 JSON도 같이 넣어줘야 해.',
      )
      return
    }

    const input: GroupMutationInput = {
      name: trimmedName,
      description: trimmedDescription || null,
      color: trimmedColor || null,
      parent_id: parentValue === 'root' ? null : Number(parentValue),
      auto_collect_enabled: autoCollectEnabled,
      auto_collect_conditions: autoCollectEditorState.parsedValue,
    }

    setFormError(null)
    await onSubmit(input)
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? '커스텀 그룹 만들기' : '커스텀 그룹 편집'}
      widthClassName="max-w-3xl"
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">그룹명</p>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 컨셉 아트 / 캐릭터 / 즐겨찾기" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">설명</p>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">그룹 위치</p>
            <HierarchyPicker
              items={parentGroups}
              selectedId={parentValue === 'root' ? null : Number(parentValue)}
              onSelectRoot={() => setParentValue('root')}
              onSelect={(candidate) => setParentValue(String(candidate.id))}
              getId={(candidate) => candidate.id}
              getParentId={(candidate) => candidate.parent_id}
              getLabel={(candidate) => candidate.name}
              sortItems={(left, right) => left.name.localeCompare(right.name)}
              renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
            />
          </div>

          <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/50 p-3">
            <ToggleRow className="justify-between px-0 py-0" variant="detail">
              <p className="text-sm font-medium text-foreground">필터 적용</p>
              <input type="checkbox" checked={autoCollectEnabled} onChange={(event) => setAutoCollectEnabled(event.target.checked)} />
            </ToggleRow>

            {autoCollectEnabled ? (
              <AutoCollectChipEditor initialJsonText={autoCollectInitialText} onChange={setAutoCollectEditorState} />
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">대표 색상</p>
            <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#7c3aed" />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '저장 중…' : mode === 'create' ? '그룹 만들기' : '변경 저장'}
          </Button>
        </div>
      </form>
    </SettingsModal>
  )
}
