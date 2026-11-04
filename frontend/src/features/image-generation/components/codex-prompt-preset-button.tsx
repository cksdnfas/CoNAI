import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { createPromptPreset } from '@/lib/api-prompt-presets'
import { getErrorMessage } from '@/lib/error-message'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'

/** Save either prompt to the existing preset library without mixing positive and negative text. */
export function CodexPromptPresetButton({ prompt, negativePrompt }: { prompt: string; negativePrompt: string }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const authStatus = useAuthStatusQuery()
  const permissions = authStatus.data?.permissionKeys ?? []
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'positive' | 'negative'>('positive')
  const [saving, setSaving] = useState(false)
  const value = normalizeTextSegmentSpreadsheetText(kind === 'positive' ? prompt : negativePrompt).trim()
  const label = t({ ko: '프롬프트 프리셋으로 저장', en: 'Save as prompt preset' })

  if (!hasAuthPermission(permissions, 'prompts.edit')) {
    return null
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !name.trim() || !value) return
    setSaving(true)
    try {
      await createPromptPreset({
        name: name.trim(),
        description: kind === 'positive' ? 'Codex positive prompt' : 'Codex negative prompt',
        items: [{ description: name.trim(), value }],
      })
      setOpen(false)
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['prompt-presets'] })
      showSnackbar({ message: t({ ko: '프리셋을 저장했어.', en: 'Preset saved.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '프리셋 저장에 실패했어.', en: 'Failed to save the preset.' })), tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return <>
    <IconButton type="button" variant="ghost" size="icon-sm" label={label} disabled={!prompt.trim() && !negativePrompt.trim()} onClick={() => { setKind(prompt.trim() ? 'positive' : 'negative'); setOpen(true) }}>
      <BookmarkPlus />
    </IconButton>
    <Modal open={open} title={label} onClose={() => { if (!saving) setOpen(false) }} size="md">
      <form onSubmit={(event) => void save(event)}>
        <ModalBody>
          <Field label={t({ ko: '이름', en: 'Name' })}><Input value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} /></Field>
          <Field label={t({ ko: '저장할 프롬프트', en: 'Prompt to save' })}>
            <Select value={kind} onChange={(event) => setKind(event.target.value === 'negative' ? 'negative' : 'positive')} disabled={saving}>
              <option value="positive">{t({ ko: '포지티브', en: 'Positive' })}</option>
              <option value="negative">{t({ ko: '네거티브', en: 'Negative' })}</option>
            </Select>
          </Field>
          <Field label={t({ ko: '저장 내용', en: 'Content' })}><Textarea value={value} readOnly rows={6} /></Field>
        </ModalBody>
        <EditorFooter saveSubmit canSave={Boolean(name.trim() && value)} saving={saving} />
      </form>
    </Modal>
  </>
}
