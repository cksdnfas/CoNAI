import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody } from '@/components/ui/modal'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { AppearanceColorControl } from '@/features/settings/components/appearance-tab-editor-shared'
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
    setParentValue(String(group?.parent_id ?? defaultParentId ?? 'root'))
    setAutoCollectEnabled(Boolean(group?.auto_collect_enabled))
    setEmoticonEnabled(Boolean(group?.emoticon_enabled))
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
      emoticon_enabled: emoticonEnabled,
    }

    setFormError(null)
    await onSubmit(input)
  }

  // Auto-collect conditions are left out: the chip editor re-serialises them, so comparing would flag untouched groups.
  const initialParentValue = String(group?.parent_id ?? defaultParentId ?? 'root')
  const dirty = open && (
    name !== (group?.name ?? '')
    || description !== (group?.description ?? '')
    || color !== (group?.color ?? '')
    || parentValue !== initialParentValue
    || autoCollectEnabled !== Boolean(group?.auto_collect_enabled)
    || emoticonEnabled !== Boolean(group?.emoticon_enabled)
  )
  const canSave = !isSubmitting && (mode === 'create' || dirty || autoCollectEnabled)
  const colorValue = /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(color.trim()) ? color.trim() : '#7c3aed'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('groups.components.group.editor.modal.custom.group') : t('groups.components.group.editor.modal.custom.groups.edit')}
      size="normal"
      height="tall"
      dirty={dirty}
      onSave={canSave ? () => formRef.current?.requestSubmit() : undefined}
    >
      <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('groups.components.group.editor.modal.check.your.input')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <ModalBody className="space-y-4">
          <Field label={t('groups.components.group.editor.modal.group.name')}>
            <Input variant="settings" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('groups.components.group.editor.modal.e.g.concept.art.characters.favorites')} />
          </Field>

          <Field label={t('groups.components.group.editor.modal.description')}>
            <Textarea
              variant="settings"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <EditorGroup label={t('groups.components.group.editor.modal.group.location')}>
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
          </EditorGroup>

          <EditorGroup>
            <div>
              <div className="border-b border-line">
                <SettingsSwitchRow
                  className="border-b-0"
                  label={t('groups.components.group.editor.modal.filter.apply')}
                  checked={autoCollectEnabled}
                  onCheckedChange={setAutoCollectEnabled}
                />
                {autoCollectEnabled ? (
                  <div className="pb-4">
                    <AutoCollectChipEditor initialJsonText={autoCollectInitialText} onChange={setAutoCollectEditorState} />
                  </div>
                ) : null}
              </div>
              <SettingsSwitchRow
                label={t({ ko: 'LLM 이모티콘 그룹', en: 'LLM emoticon group' })}
                checked={emoticonEnabled}
                onCheckedChange={setEmoticonEnabled}
              />
              <SettingRow label={t('groups.components.group.editor.modal.accent.color')}>
                <AppearanceColorControl
                  ariaLabel={t('groups.components.group.editor.modal.accent.color')}
                  colorValue={colorValue}
                  textValue={color}
                  placeholder="#7c3aed"
                  onChangeColor={setColor}
                  onChangeText={setColor}
                />
              </SettingRow>
            </div>
          </EditorGroup>
        </ModalBody>

        <EditorFooter
          saveSubmit
          canSave={canSave}
          saving={isSubmitting}
          saveLabel={mode === 'create' ? t('groups.components.group.editor.modal.create.group') : t('groups.components.group.editor.modal.save.changes')}
        />
      </form>
    </Modal>
  )
}
