import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { collectDescendantGroupIds } from '@/features/groups/group-option-utils'
import type { GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'
import { AutoCollectChipEditor } from './auto-collect-chip-editor'
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
  const { t } = useI18n()
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
      title={mode === 'create' ? t('groups.components.group.editor.modal.custom.group') : t('groups.components.group.editor.modal.custom.groups.edit')}
      widthClassName="max-w-3xl"
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('groups.components.group.editor.modal.check.your.input')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsModalBody className="space-y-5">
          <div className="space-y-5">
            <SettingsField label={t('groups.components.group.editor.modal.group.name')}>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('groups.components.group.editor.modal.e.g.concept.art.characters.favorites')} />
            </SettingsField>

            <SettingsField label={t('groups.components.group.editor.modal.description')}>
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </SettingsField>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('groups.components.group.editor.modal.group.location')}</p>
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

            <div className="space-y-3">
              <SettingsToggleRow className="justify-between">
                <p className="text-sm font-medium text-foreground">{t('groups.components.group.editor.modal.filter.apply')}</p>
                <input type="checkbox" checked={autoCollectEnabled} onChange={(event) => setAutoCollectEnabled(event.target.checked)} />
              </SettingsToggleRow>

              {autoCollectEnabled ? <AutoCollectChipEditor initialJsonText={autoCollectInitialText} onChange={setAutoCollectEditorState} /> : null}
            </div>

            <SettingsField label={t('groups.components.group.editor.modal.accent.color')}>
              <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#7c3aed" />
            </SettingsField>
          </div>

          <SettingsModalFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('groups.components.group.editor.modal.saving') : mode === 'create' ? t('groups.components.group.editor.modal.create.group') : t('groups.components.group.editor.modal.save.changes')}
            </Button>
          </SettingsModalFooter>
        </SettingsModalBody>
      </form>
    </SettingsModal>
  )
}
