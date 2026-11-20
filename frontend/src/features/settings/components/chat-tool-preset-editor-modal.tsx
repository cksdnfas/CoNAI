import { Copy, Download } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorGroup } from '@/components/ui/editor-group'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SCOPES,
  CHAT_TOOL_PRESETS_QUERY_KEY,
  createChatToolPreset,
  updateChatToolPreset,
  type ChatScope,
  type ChatToolPreset,
  type ChatToolPresetInput,
} from '@/lib/api-codex-chat'
import { useChatResourceEditor } from './use-chat-resource-editor'
import { ChatToolPicker, useChatToolGroups } from './chat-tool-picker'
import { downloadChatToolPresetFile } from './chat-tool-preset-file'
import { CHAT_DOCK_INSET } from './use-settings-editor-chat-page'
import { useChatResourceDelete } from './use-chat-resource-actions'

const EMPTY: ChatToolPresetInput = { name: '', scopes: ['read'], toolAllowlist: null }

/**
 * Create or edit one tool preset: name, scopes and the tools within them. Saving reaches every profile that links it.
 * `onSaved` hands the saved preset back.
 */
type ToolEditorProps = {
  open: boolean
  preset: ChatToolPreset | null
  /** Starting values for a new preset (e.g. a duplicate, or a profile's own grant turned into a preset). */
  initial?: ChatToolPresetInput
  onClose: () => void
  onSaved?: (preset: ChatToolPreset) => void
  /** Copy the opened preset (only offered when editing an existing one). */
  onDuplicate?: (preset: ChatToolPreset) => void
  duplicating?: boolean
}

export function ChatToolPresetEditorModal(props: ToolEditorProps) {
  return props.open ? <ToolEditor key={props.preset?.id ?? 'new'} {...props} /> : null
}

function ToolEditor({ open, preset: record, initial, onClose, onSaved, onDuplicate, duplicating }: ToolEditorProps) {
  const { t } = useI18n()
  const { groups, isPending } = useChatToolGroups(open)
  const { base: preset, draft, setDraft, dirty, saveMutation } = useChatResourceEditor({
    initial: record, draftOf: row => row ? { name: row.name, scopes: row.scopes, toolAllowlist: row.toolAllowlist } : initial ?? EMPTY,
    write: (base, value) => base ? updateChatToolPreset(base.id, value, base.revision) : createChatToolPreset(value),
    refresh: [CHAT_TOOL_PRESETS_QUERY_KEY, CHAT_ADMIN_PROFILES_QUERY_KEY, CHAT_PROFILES_QUERY_KEY], onSaved, onClose,
  })
  const deleteMutation = useChatResourceDelete(onClose)

  const toggleScope = (scope: ChatScope) => setDraft(current => {
    const pressed = current.scopes.includes(scope)
    if (pressed && current.scopes.length === 1) return current
    const scopes = pressed ? current.scopes.filter((item) => item !== scope) : CHAT_SCOPES.filter((item) => item === scope || current.scopes.includes(item))
    // Tools of a scope that went away leave the list too, so the summary never names a tool the grant cannot offer.
    const allowed = new Set(groups.filter((group) => scopes.includes(group.scope)).flatMap((group) => group.tools.map((tool) => tool.name)))
    return { ...current, scopes, toolAllowlist: current.toolAllowlist === null ? null : current.toolAllowlist.filter((name) => allowed.has(name)) }
  })

  const nameMissing = draft.name.trim().length === 0
  const canSave = !nameMissing && !saveMutation.isPending && (dirty || !preset)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preset ? t({ ko: '도구 프리셋 편집', en: 'Edit tool preset' }) : t({ ko: '도구 프리셋 추가', en: 'Add tool preset' })}
      size="lg"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft(current => ({ ...current, name: event.target.value }))} />
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
        <EditorGroup label={t({ ko: '도구', en: 'Tools' })}>
          <ChatToolPicker groups={groups} scopes={draft.scopes} allowlist={draft.toolAllowlist} onChange={(toolAllowlist) => setDraft(current => ({ ...current, toolAllowlist }))} loading={isPending} />
        </EditorGroup>
      </ModalBody>
      <EditorFooter
        onDelete={preset ? () => deleteMutation.mutate({ kind: 'tool', resource: preset }) : undefined}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      >
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatToolPresetFile(draft)} disabled={nameMissing} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
          <Download />
        </IconButton>
        {preset && onDuplicate ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onDuplicate(preset)} disabled={duplicating} label={t({ ko: '복제', en: 'Duplicate' })}>
            <Copy />
          </IconButton>
        ) : null}
      </EditorFooter>
    </Modal>
  )
}
