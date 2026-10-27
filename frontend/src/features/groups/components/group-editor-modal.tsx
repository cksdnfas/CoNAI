import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { buildGroupCountMaps, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import { collectDescendantGroupIds } from '@/features/groups/group-option-utils'
import { getGroupPreviewImages } from '@/lib/api-groups'
import type { GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'
import { AutoCollectChipEditor, type AutoCollectEditorState } from './auto-collect-chip-editor'
import { GroupCoverMosaic } from './group-cover-mosaic'
import { GroupLocationPicker } from './group-location-picker'
import { GroupColorSwatches, GroupModalFooter, GroupModalRow, GroupModalSection, GroupModalSwitchRow } from './group-modal-parts'
import { useI18n } from '@/i18n'

interface GroupEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  groups: GroupWithHierarchy[]
  group?: GroupRecord | null
  defaultParentId?: number | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: GroupMutationInput) => Promise<void>
  /** Edit mode: open the delete confirmation for this group. */
  onDelete?: () => void
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
  onDelete,
}: GroupEditorModalProps) {
  const { t, formatNumber } = useI18n()
  // A new group starts with only name and location; the rest opens on demand.
  const [showMore, setShowMore] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('')
  const [parentValue, setParentValue] = useState<number | null>(null)
  const [autoCollectEnabled, setAutoCollectEnabled] = useState(false)
  const [emoticonEnabled, setEmoticonEnabled] = useState(false)
  const [autoCollectEditorState, setAutoCollectEditorState] = useState<AutoCollectEditorState>({
    mode: 'chip',
    parsedValue: undefined,
    errorMessage: null,
  })
  const [autoCollectInitialText, setAutoCollectInitialText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    setName(group?.name ?? '')
    setDescription(group?.description ?? '')
    setColor(group?.color ?? '')
    setParentValue(group?.parent_id ?? defaultParentId ?? null)
    setAutoCollectEnabled(Boolean(group?.auto_collect_enabled))
    setEmoticonEnabled(Boolean(group?.emoticon_enabled))
    setAutoCollectInitialText(getInitialAutoCollectText(group))
    setAutoCollectEditorState({
      mode: 'chip',
      parsedValue: undefined,
      errorMessage: null,
    })
    setFormError(null)
    setShowMore(false)
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
      setFormError(t('groups.components.group.editor.modal.group.name.is.required'))
      return
    }

    if (autoCollectEnabled && autoCollectEditorState.errorMessage) {
      setFormError(autoCollectEditorState.errorMessage)
      return
    }

    if (autoCollectEnabled && autoCollectEditorState.parsedValue === undefined) {
      setFormError(
        autoCollectEditorState.mode === 'chip'
          ? t('groups.components.group.editor.modal.add.at.least.one.condition.chip.when')
          : t('groups.components.group.editor.modal.add.condition.json.when.filtering.is.enabled'),
      )
      return
    }

    const input: GroupMutationInput = {
      name: trimmedName,
      description: trimmedDescription || null,
      color: trimmedColor || null,
      parent_id: parentValue,
      auto_collect_enabled: autoCollectEnabled,
      auto_collect_conditions: autoCollectEditorState.parsedValue,
      emoticon_enabled: emoticonEnabled,
    }

    setFormError(null)
    try {
      await onSubmit(input)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    }
  }

  // Auto-collect conditions are left out: the chip editor re-serialises them, so comparing would flag untouched groups.
  const initialParentValue = group?.parent_id ?? defaultParentId ?? null
  const dirty = open && (
    name !== (group?.name ?? '')
    || description !== (group?.description ?? '')
    || color !== (group?.color ?? '')
    || parentValue !== initialParentValue
    || autoCollectEnabled !== Boolean(group?.auto_collect_enabled)
    || emoticonEnabled !== Boolean(group?.emoticon_enabled)
  )
  const canSave = !isSubmitting && (mode === 'create' || dirty || autoCollectEnabled)
  const editedGroup = mode === 'edit' ? group : null
  const showDetails = mode === 'edit' || showMore
  const countMaps = useMemo(() => buildGroupCountMaps(groups), [groups])
  const hierarchyGroup = editedGroup ? groups.find((candidate) => candidate.id === editedGroup.id) : undefined
  const imageTotal = hierarchyGroup ? getGroupHierarchyTotalCount(hierarchyGroup, countMaps) : editedGroup?.image_count ?? 0
  const childCount = editedGroup ? countMaps.childCountByGroupId.get(editedGroup.id) ?? 0 : 0
  const summary = childCount > 0
    ? t({ ko: '{images}장 · 하위 {children}', en: '{images} images · {children} subgroups' }, { images: formatNumber(imageTotal), children: formatNumber(childCount) })
    : t({ ko: '{images}장', en: '{images} images' }, { images: formatNumber(imageTotal) })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t({ ko: '새 그룹', en: 'New group' }) : t({ ko: '그룹 편집', en: 'Edit group' })}
      description={editedGroup ? summary : undefined}
      leading={editedGroup ? (
        <GroupCoverMosaic groupId={editedGroup.id} sourceKey="custom" imageCount={imageTotal} loadPreviewImages={getGroupPreviewImages} className="size-10 rounded-lg" />
      ) : undefined}
      size="md"
      dirty={dirty}
      onSave={canSave ? () => formRef.current?.requestSubmit() : undefined}
    >
      <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
        <ModalBody>
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{t('groups.components.group.editor.modal.check.your.input')}</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label={t('groups.components.group.editor.modal.group.name')}
              placeholder={t('groups.components.group.editor.modal.e.g.concept.art.characters.favorites')}
              autoFocus={mode === 'create'}
            />
            {showDetails ? (
              <textarea
                rows={1}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-label={t('groups.components.group.editor.modal.description')}
                placeholder={t('groups.components.group.editor.modal.description')}
                className="mt-1 block w-full resize-none rounded-sm bg-transparent px-3 py-1.5 text-sm text-foreground outline-none field-sizing-content placeholder:text-muted-foreground/70 focus:bg-field"
              />
            ) : null}
          </div>

          <GroupModalSection>
            <GroupLocationPicker
              label={t({ ko: '위치', en: 'Location' })}
              groups={parentGroups}
              pathGroups={groups}
              value={parentValue}
              onChange={setParentValue}
            />
            {showDetails ? (
              <GroupModalRow label={t({ ko: '색', en: 'Color' })}>
                <GroupColorSwatches value={color} onChange={setColor} />
              </GroupModalRow>
            ) : (
              <GroupModalRow label={t({ ko: '추가 설정', en: 'More settings' })}>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t({ ko: '추가 설정 펼치기', en: 'Show more settings' })} aria-expanded={false} onClick={() => setShowMore(true)}>
                  <ChevronDown />
                </Button>
              </GroupModalRow>
            )}
          </GroupModalSection>

          {showDetails ? (
            <GroupModalSection>
              <div className="border-b border-line last:border-b-0">
                <GroupModalSwitchRow
                  className="border-b-0"
                  label={t({ ko: '자동수집', en: 'Auto-collect' })}
                  checked={autoCollectEnabled}
                  onCheckedChange={setAutoCollectEnabled}
                />
                {autoCollectEnabled ? (
                  <div className="pb-3">
                    <AutoCollectChipEditor initialJsonText={autoCollectInitialText} onChange={setAutoCollectEditorState} />
                  </div>
                ) : null}
              </div>
              <GroupModalSwitchRow
                label={t({ ko: '채팅 이모티콘', en: 'Chat emoticons' })}
                checked={emoticonEnabled}
                onCheckedChange={setEmoticonEnabled}
              />
            </GroupModalSection>
          ) : null}
        </ModalBody>

        <GroupModalFooter
          busy={isSubmitting}
          start={mode === 'edit' && onDelete ? (
            <Button type="button" variant="destructive-ghost" onClick={onDelete} disabled={isSubmitting}>
              {t({ ko: '그룹 삭제', en: 'Delete group' })}
            </Button>
          ) : null}
        >
          <Button type="submit" disabled={!canSave}>
            {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
            {mode === 'create' ? t({ ko: '만들기', en: 'Create' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </GroupModalFooter>
      </form>
    </Modal>
  )
}
