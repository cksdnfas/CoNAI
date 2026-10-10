import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Download } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  createChatBlock,
  deleteChatBlock,
  updateChatBlock,
  type ChatDisplayBlock,
  type ChatSharedBlock,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { BLOCK_KEY_PATTERN, ChatBlockEditor, starterBlock } from './chat-block-editor'
import { downloadChatBlockFile } from './chat-block-file'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'

/** Create or edit one shared display block. Saving reaches every profile that links it. */
export function ChatBlockEditorModal({ open, shared, initialName, initialBlock, onClose, onSaved, onDuplicate, duplicating }: {
  open: boolean
  shared: ChatSharedBlock | null
  /** New block only: the draft starts from this name and block (a block proposed in a chat) instead of the starter. */
  initialName?: string
  initialBlock?: ChatDisplayBlock
  onClose: () => void
  /** Called after a new block is created (not after an edit of an existing one). */
  onSaved?: (shared: ChatSharedBlock) => void
  /** Copy the opened block (only offered when editing an existing one). */
  onDuplicate?: (shared: ChatSharedBlock) => void
  duplicating?: boolean
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [block, setBlock] = useState<ChatDisplayBlock>(starterBlock)
  /** What was opened, to tell unsaved edits apart (the starter of a new block counts as unedited). */
  const [opened, setOpened] = useState<{ name: string; block: ChatDisplayBlock } | null>(null)
  /** Bumped with every open, so the editor (and its field rows) mounts on the block being opened, not the last one. */
  const [session, setSession] = useState(0)

  useLayoutEffect(() => {
    if (open) {
      const next = { name: shared?.name ?? initialName ?? '', block: shared?.block ?? initialBlock ?? starterBlock() }
      setName(next.name)
      setBlock(next.block)
      setOpened(next)
      setSession((current) => current + 1)
    }
  }, [shared, initialName, initialBlock, open])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (shared ? updateChatBlock(shared.id, { name, block }) : createChatBlock({ name: name.trim() || block.key, block })),
    onSuccess: async (saved) => {
      if (!shared) onSaved?.(saved)
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatBlock(shared?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleDelete = async () => {
    const linked = shared?.profiles.length ?? 0
    const confirmed = await confirm({
      title: t({ ko: '표시 블록 삭제', en: 'Delete display block' }),
      description: linked > 0
        ? t({ ko: '프로필 {count}개에서 쓰는 중이야. 지우면 연결도 같이 풀려.', en: 'Used by {count} profiles. Deleting also unlinks it from them.' }, { count: linked })
        : t({ ko: '이 표시 블록을 지울까?', en: 'Delete this display block?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const keyValid = BLOCK_KEY_PATTERN.test(block.key)
  const dirty = opened !== null && JSON.stringify({ name, block }) !== JSON.stringify(opened)
  const canSave = keyValid && !saveMutation.isPending && (dirty || !shared)
  useBlockChatPage({ open, shared, name, setName, block, setBlock, remount: () => setSession((current) => current + 1), dirty, save: () => saveMutation.mutateAsync() })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shared ? t({ ko: '표시 블록 편집', en: 'Edit display block' }) : t({ ko: '표시 블록 추가', en: 'Add display block' })}
      size="wide"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody className="space-y-4">
        <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>} info={t({ ko: '비우면 블록 이름을 써.', en: 'Empty uses the block name.' })}>
          <Input variant="settings" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ChatBlockEditor key={session} block={block} onChange={setBlock} />
      </ModalBody>
      <EditorFooter
        onDelete={shared ? () => void handleDelete() : undefined}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      >
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatBlockFile(name.trim() || block.key, block)} disabled={!keyValid} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
          <Download />
        </IconButton>
        {shared && onDuplicate ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onDuplicate(shared)} disabled={duplicating} label={t({ ko: '복제', en: 'Duplicate' })}>
            <Copy />
          </IconButton>
        ) : null}
      </EditorFooter>
    </Modal>
  )
}

/** The block fields a connected chat may fill as text; the field rules go through `block.fields`. */
const BLOCK_TEXT_KEYS = ['instruction', 'rules', 'example', 'summary', 'template', 'css'] as const

/**
 * Registers the open display block editor with a connected chat: it fills the draft, and asks to save with a card.
 * A change to the starting values or field rules remounts the editor, whose field table is read from them once.
 */
function useBlockChatPage({ open, shared, name, setName, block, setBlock, remount, dirty, save }: {
  open: boolean
  shared: ChatSharedBlock | null
  name: string
  setName: (name: string) => void
  block: ChatDisplayBlock
  setBlock: (update: (current: ChatDisplayBlock) => ChatDisplayBlock) => void
  remount: () => void
  dirty: boolean
  save: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const blockRef = useRef(block)
  blockRef.current = block
  useSettingsEditorChatPage({
    open, dirty,
    title: shared ? t({ ko: '표시 블록 편집 · {name}', en: 'Edit display block · {name}' }, { name: shared.name }) : t({ ko: '표시 블록 추가', en: 'Add display block' }),
    resourceId: `display-block:${shared?.id ?? 'new'}`,
    fields: [
      { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name },
      { id: 'key', label: t({ ko: '블록 이름 (```이름, 영소문자·숫자·_-)', en: 'Block name (```name, a-z 0-9 _-)' }), type: 'text', value: block.key },
      { id: 'instruction', label: t({ ko: '언제 쓰는지', en: 'When to use' }), type: 'text', value: block.instruction },
      { id: 'rules', label: t({ ko: '갱신 규칙', en: 'Update rules' }), type: 'text', value: block.rules },
      { id: 'example', label: t({ ko: '시작 값 (JSON 객체)', en: 'Starting values (JSON object)' }), type: 'text', value: block.example },
      { id: 'summary', label: t({ ko: '한 줄 요약 (접힌 상태창, {{필드}})', en: 'One-line summary (folded panel, {{field}})' }), type: 'text', value: block.summary },
      { id: 'template', label: t({ ko: 'HTML 템플릿 ({{필드}}, {{#if}}, {{#each}})', en: 'HTML template ({{field}}, {{#if}}, {{#each}})' }), type: 'text', value: block.template },
      { id: 'css', label: 'CSS', type: 'text', value: block.css },
    ],
    data: {
      fields: block.fields.map((field) => ({ name: field.name, min: field.min, max: field.max, step: field.step, values: field.values, readonly: field.readonly })),
      selected: { name, key: block.key },
    },
    apply: (patch) => {
      if (patch.name !== undefined) setName(String(patch.name))
      const next: Partial<ChatDisplayBlock> = {}
      if (patch.key !== undefined) next.key = String(patch.key).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
      for (const key of BLOCK_TEXT_KEYS) if (patch[key] !== undefined) next[key] = String(patch[key])
      if (Object.keys(next).length === 0) return
      setBlock((current) => ({ ...current, ...next }))
      if (next.example !== undefined) remount()
    },
    actions: [pageAction('block.fields', t({ ko: '필드 규칙 채우기', en: 'Fill field rules' }), t({ ko: '필드 규칙을 전부 바꿔. 저장하지 않아. 시작 값은 example 필드로 따로 채워. min/max/step은 숫자 필드만, values는 허용 값 목록(비우면 아무 값), readonly는 모델이 못 바꾸는 값.', en: 'Replace every field rule; nothing is saved. Starting values go in the example field. min/max/step are for numbers, values lists the allowed values (empty: any), readonly fields cannot be changed by the model.' }), pageObject({
      fields: pageArray(pageObject({ name: pageText(60), min: pageNumber(), max: pageNumber(), step: pageNumber(0), values: pageArray(pageText(100), 40), readonly: { type: 'boolean' } }, ['name']), 40),
    }, ['fields']))],
    applyAction: (id, args) => {
      if (id !== 'block.fields' || !Array.isArray(args.fields)) throw new Error('표시 블록 편집기에 없는 작업이야.')
      const before = blockRef.current
      const tones = new Map(before.fields.map((field) => [field.name, field.tone]))
      const fields = args.fields.map((raw) => {
        const field = raw as { name: string; min?: number; max?: number; step?: number; values?: string[]; readonly?: boolean }
        const fieldName = field.name.trim()
        const tone = tones.get(fieldName)
        return { name: fieldName, min: field.min ?? null, max: field.max ?? null, step: field.step ?? null, values: field.values ?? [], readonly: field.readonly === true, ...(tone ? { tone } : {}) }
      }).filter((field) => field.name)
      const next = { ...before, fields }
      setBlock(() => next)
      remount()
      return { isCurrent: () => blockRef.current === next, restore: () => { setBlock(() => before); remount() } }
    },
    save,
  })
}
