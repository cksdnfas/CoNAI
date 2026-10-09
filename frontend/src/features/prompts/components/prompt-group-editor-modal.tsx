import { Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Modal, ModalBody } from '@/components/ui/modal'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import type { PromptGroupRecord } from '@/types/prompt'
import { useI18n } from '@/i18n'

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
  const { t } = useI18n()
  const [groupName, setGroupName] = useState('')
  const [parentValue, setParentValue] = useState('root')
  const [isVisible, setIsVisible] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

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
      setFormError(t('prompts.components.prompt.group.editor.modal.group.name.is.required'))
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

  const dirty = open && (
    groupName !== (group?.group_name ?? '')
    || parentValue !== String(group?.parent_id ?? defaultParentId ?? 'root')
    || isVisible !== (group?.is_visible ?? true)
  )
  const canSave = !isSubmitting && (mode === 'create' || dirty)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t({ ko: '{typeLabel} 그룹 만들기', en: '{typeLabel} group' }, { typeLabel }) : t({ ko: '{typeLabel} 그룹 편집', en: '{typeLabel} group edit' }, { typeLabel })}
      size="narrow"
      height="medium"
      dirty={dirty}
      onSave={canSave ? () => formRef.current?.requestSubmit() : undefined}
    >
      <form ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('prompts.components.prompt.group.editor.modal.check.your.input')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <ModalBody className="space-y-4">
          <Field label={t('prompts.components.prompt.group.editor.modal.group.name')}>
            <Input variant="settings" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t('prompts.components.prompt.group.editor.modal.e.g.character.background.lora')} />
          </Field>

          <EditorGroup label={t('prompts.components.prompt.group.editor.modal.parent.group')}>
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
          </EditorGroup>

          <div className="border-t border-line">
            <SettingsSwitchRow label={t('prompts.components.prompt.group.editor.modal.display.status')} checked={isVisible} onCheckedChange={setIsVisible} />
          </div>
        </ModalBody>

        <EditorFooter
          saveSubmit
          canSave={canSave}
          saving={isSubmitting}
          saveLabel={mode === 'create' ? t('prompts.components.prompt.group.editor.modal.create.group') : t('prompts.components.prompt.group.editor.modal.save.changes')}
        />
      </form>
    </Modal>
  )
}
