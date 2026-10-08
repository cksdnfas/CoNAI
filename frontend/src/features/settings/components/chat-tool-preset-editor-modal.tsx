import { useLayoutEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Save, Trash2 } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SCOPES,
  CHAT_TOOL_PRESETS_QUERY_KEY,
  createChatToolPreset,
  deleteChatToolPreset,
  updateChatToolPreset,
  type ChatScope,
  type ChatToolPreset,
  type ChatToolPresetInput,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatToolPicker, useChatToolGroups } from './chat-tool-picker'
import { downloadChatToolPresetFile } from './chat-tool-preset-file'

const EMPTY: ChatToolPresetInput = { name: '', scopes: ['read'], toolAllowlist: null }

/**
 * Create or edit one tool preset: name, scopes and the tools within them. Saving reaches every profile that links it.
 * `onSaved` hands the saved preset back.
 */
export function ChatToolPresetEditorModal({ open, preset, initial, onClose, onSaved, onDuplicate, duplicating }: {
  open: boolean
  preset: ChatToolPreset | null
  /** Starting values for a new preset (e.g. a duplicate, or a profile's own grant turned into a preset). */
  initial?: ChatToolPresetInput
  onClose: () => void
  onSaved?: (preset: ChatToolPreset) => void
  /** Copy the opened preset (only offered when editing an existing one). */
  onDuplicate?: (preset: ChatToolPreset) => void
  duplicating?: boolean
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ChatToolPresetInput>(EMPTY)
  const { groups, isPending } = useChatToolGroups(open)

  useLayoutEffect(() => {
    if (open) setDraft(preset ? { name: preset.name, scopes: preset.scopes, toolAllowlist: preset.toolAllowlist } : initial ?? EMPTY)
  }, [initial, open, preset])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (preset ? updateChatToolPreset(preset.id, draft) : createChatToolPreset(draft)),
    onSuccess: async (saved) => {
      await refresh()
      onSaved?.(saved)
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatToolPreset(preset?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '도구 프리셋 삭제', en: 'Delete tool preset' }),
      description: t({ ko: '이 도구 프리셋을 지울까?', en: 'Delete this tool preset?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const toggleScope = (scope: ChatScope) => {
    const pressed = draft.scopes.includes(scope)
    if (pressed && draft.scopes.length === 1) return
    const scopes = pressed ? draft.scopes.filter((item) => item !== scope) : CHAT_SCOPES.filter((item) => item === scope || draft.scopes.includes(item))
    // Tools of a scope that went away leave the list too, so the summary never names a tool the grant cannot offer.
    const allowed = new Set(groups.filter((group) => scopes.includes(group.scope)).flatMap((group) => group.tools.map((tool) => tool.name)))
    setDraft({ ...draft, scopes, toolAllowlist: draft.toolAllowlist === null ? null : draft.toolAllowlist.filter((name) => allowed.has(name)) })
  }

  const nameMissing = draft.name.trim().length === 0

  return (
    <Modal open={open} onClose={onClose} title={preset ? t({ ko: '도구 프리셋 편집', en: 'Edit tool preset' }) : t({ ko: '도구 프리셋 추가', en: 'Add tool preset' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t({ ko: '권한', en: 'Scopes' })}>
            <div className="flex min-h-10 flex-wrap items-center gap-1.5">
              {CHAT_SCOPES.map((scope) => {
                const copy = getChatScopeCopy(scope, t)
                const pressed = draft.scopes.includes(scope)
                return (
                  <Tip key={scope} content={copy.description} side="bottom" align="start">
                    <ToggleChip size="sm" pressed={pressed} disabled={pressed && draft.scopes.length === 1} onClick={() => toggleScope(scope)}>{copy.label}</ToggleChip>
                  </Tip>
                )
              })}
            </div>
          </Field>
        </div>
        <div className="border-t border-line pt-3">
          <ChatToolPicker groups={groups} scopes={draft.scopes} allowlist={draft.toolAllowlist} onChange={(toolAllowlist) => setDraft({ ...draft, toolAllowlist })} loading={isPending} />
        </div>
      </ModalBody>
      <ModalFooter>
        {preset ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatToolPresetFile(draft)} disabled={nameMissing} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
          <Download />
        </IconButton>
        {preset && onDuplicate ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onDuplicate(preset)} disabled={duplicating} label={t({ ko: '복제', en: 'Duplicate' })}>
            <Copy />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={nameMissing || saveMutation.isPending} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}
