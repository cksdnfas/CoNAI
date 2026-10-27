import { useState } from 'react'
import type { LlmPresetRecord } from '@conai/shared'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { LLM_PRESET_SECTIONS, buildEmptyPresetDraft, buildPresetDraft, type LlmPresetDraft, type LlmPresetModalState } from './llm-connections-tab-utils'

/** Mounted for one preset editing session. Kind changes preserve the name and any typed content. */
export function LlmPresetEditorModal({ state, isSaving, isDeleting, onClose, onTypeChange, onSave, onDelete }: {
  state: NonNullable<LlmPresetModalState>
  isSaving: boolean
  isDeleting: boolean
  onClose: () => void
  onTypeChange: (kind: NonNullable<LlmPresetModalState>['presetType']) => void
  onSave: (draft: LlmPresetDraft) => void
  onDelete: (preset: LlmPresetRecord) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const preset = state.mode === 'edit' ? state.preset : null
  const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === state.presetType)!
  const [savedDraft] = useState(() => preset ? buildPresetDraft(preset) : buildEmptyPresetDraft(state.presetType))
  const [draft, setDraft] = useState(savedDraft)
  const [contentEdited, setContentEdited] = useState(false)
  const baseline = preset ? savedDraft : { ...savedDraft, content: section.initialContent ?? '' }
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const canSave = draft.name.trim().length > 0 && (dirty || !preset) && !isSaving && !isDeleting
  const save = () => onSave(draft)

  return (
    <Modal open onClose={onClose} title={preset ? t({ ko: '{heading} 수정', en: 'Edit {heading}' }, { heading: t(section.heading) }) : t({ ko: '프롬프트 프리셋 추가', en: 'Add prompt preset' })} size="md" dirty={dirty} onSave={canSave ? save : undefined}>
      <ModalBody>
        {!preset ? <SegmentedControl
          className="mb-4"
          size="sm"
          value={section.key}
          onChange={(key) => {
            const kind = key as typeof section.key
            const next = LLM_PRESET_SECTIONS.find((entry) => entry.key === kind)!
            if (!contentEdited) setDraft((current) => ({ ...current, content: next.initialContent ?? '' }))
            onTypeChange(kind)
          }}
          items={LLM_PRESET_SECTIONS.map((entry) => ({ value: entry.key, label: t(entry.shortLabel) }))}
          ariaLabel={t({ ko: '종류', en: 'Kind' })}
        /> : null}
        <div className="grid gap-4">
          <Field label={t('llmConnectionsTab.presetName')}>
            <Input variant="settings" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t({ ko: '예: item-summary-json', en: 'e.g. item-summary-json' })} />
          </Field>
          <Field label={t(section.fieldLabel)}>
            <Textarea variant="settings" rows={section.expectsJson ? 10 : 8} value={draft.content} onChange={(event) => { setContentEdited(true); setDraft((current) => ({ ...current, content: event.target.value })) }} placeholder={t(section.placeholder)} mono={section.mono} textSize={section.mono ? 'xs' : 'sm'} />
          </Field>
        </div>
      </ModalBody>
      <EditorFooter
        onDelete={preset ? () => void (async () => {
          const confirmed = await confirm({
            title: t({ ko: '프리셋 삭제', en: 'Delete preset' }),
            description: t({ ko: "프리셋 '{presetName}' 을(를) 삭제할까?", en: "Delete preset '{presetName}'?" }, { presetName: preset.name }),
            confirmLabel: t({ ko: '삭제', en: 'Delete' }),
            tone: 'destructive',
          })
          if (confirmed) onDelete(preset)
        })() : undefined}
        deleteLabel={t('llmConnectionsTab.deletePreset')}
        deleting={isDeleting}
        onSave={save}
        canSave={canSave}
        saving={isSaving}
        saveLabel={preset ? t('llmConnectionsTab.savePreset') : t({ ko: '{fieldLabel} 저장', en: 'Save {fieldLabel}' }, { fieldLabel: t(section.fieldLabel) })}
      />
    </Modal>
  )
}
