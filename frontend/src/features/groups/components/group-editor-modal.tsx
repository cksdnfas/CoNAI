import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { buildGroupOptionItems, collectDescendantGroupIds } from '@/features/groups/group-option-utils'
import type { GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'

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
  const [autoCollectText, setAutoCollectText] = useState('')
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
    setAutoCollectText(getInitialAutoCollectText(group))
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

  const parentOptions = useMemo(
    () => buildGroupOptionItems(groups, { excludeIds: excludedParentIds }),
    [excludedParentIds, groups],
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedColor = color.trim()
    const trimmedAutoCollectText = autoCollectText.trim()

    if (!trimmedName) {
      setFormError('그룹 이름은 꼭 필요해.')
      return
    }

    if (autoCollectEnabled && !trimmedAutoCollectText) {
      setFormError('자동수집을 켰다면 조건 JSON도 같이 넣어줘야 해.')
      return
    }

    let parsedAutoCollectConditions: unknown = undefined
    if (trimmedAutoCollectText) {
      try {
        parsedAutoCollectConditions = JSON.parse(trimmedAutoCollectText)
      } catch {
        setFormError('자동수집 조건 JSON 형식이 올바르지 않아.')
        return
      }
    }

    const input: GroupMutationInput = {
      name: trimmedName,
      description: trimmedDescription || null,
      color: trimmedColor || null,
      parent_id: parentValue === 'root' ? null : Number(parentValue),
      auto_collect_enabled: autoCollectEnabled,
      auto_collect_conditions: parsedAutoCollectConditions,
    }

    setFormError(null)
    await onSubmit(input)
  }

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? '커스텀 그룹 만들기' : '커스텀 그룹 편집'}
      description="중첩 그룹, 수동 이미지 할당, 자동수집 조건까지 한 번에 관리할 수 있어."
      widthClassName="max-w-3xl"
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>입력 확인이 필요해</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">그룹 이름</p>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 컨셉 아트 / 캐릭터 / 즐겨찾기" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">부모 그룹</p>
            <Select value={parentValue} onChange={(event) => setParentValue(event.target.value)}>
              <option value="root">루트 그룹</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">설명</p>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="이 그룹이 어떤 용도인지 짧게 적어두면 나중에 덜 헷갈려."
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">대표 색상</p>
            <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#7c3aed" />
          </div>
        </div>

        <ToggleRow className="justify-between px-3 py-3" variant="detail">
          <div className="space-y-1">
            <p className="font-medium text-foreground">자동수집 사용</p>
            <p className="text-xs text-muted-foreground">새 이미지 유입 시 조건에 맞으면 이 그룹으로 자동 할당돼.</p>
          </div>
          <input type="checkbox" checked={autoCollectEnabled} onChange={(event) => setAutoCollectEnabled(event.target.checked)} />
        </ToggleRow>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">자동수집 조건 JSON</p>
          <Textarea
            rows={12}
            value={autoCollectText}
            onChange={(event) => setAutoCollectText(event.target.value)}
            placeholder={[
              '{',
              '  "or_group": [',
              '    { "category": "auto_tag", "type": "auto_tag_any", "value": "1girl" }',
              '  ],',
              '  "and_group": [],',
              '  "exclude_group": []',
              '}',
            ].join('\n')}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            백엔드가 이미 지원하는 ComplexFilter / legacy 조건 JSON을 그대로 넣는 방식이야.
          </p>
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
