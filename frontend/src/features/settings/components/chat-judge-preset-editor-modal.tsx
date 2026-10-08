import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { JUDGE_OPTION_DEFAULTS, type ChatJudgeFollowUp, type ChatJudgeItem, type ChatJudgeTestTurn } from '@conai/shared'
import { Copy, Download, FlaskConical, MessageSquarePlus, Play, Plus, Save, Square, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  CHAT_JUDGE_PRESETS_QUERY_KEY,
  createChatJudgePreset,
  deleteChatJudgePreset,
  downloadChatJudgePresetFile,
  testChatJudgePreset,
  updateChatJudgePreset,
  type ChatJudgePreset,
  type ChatJudgePresetInput,
} from '@/lib/api-chat-judge'
import { CHAT_ADMIN_PROFILES_QUERY_KEY, listCodexChatThreads } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { GROW_TEXTAREA } from './chat-profile-editor-fields'
import { CollapsibleRow } from './chat-profile-sections'
import { JudgeConnectionSelect } from './chat-judge-connection-select'
import { ChatJudgeItemRow } from './chat-judge-item-editor'
import { ChatJudgeScopeSections } from './chat-judge-scope-sections'

type PresetDraft = Required<ChatJudgePresetInput>

const FOLLOW_UP_DEFAULTS: ChatJudgeFollowUp = { maxConsecutive: 1, delaySeconds: 8, directive: '' }
const EMPTY: PresetDraft = { name: '', providerName: null, model: '', escalationProviderName: null, escalationModel: '', items: [], followUp: FOLLOW_UP_DEFAULTS, ...JUDGE_OPTION_DEFAULTS }
const TEST_TURNS = [4, 6, 10, 20]

function draftOf(preset: ChatJudgePreset): PresetDraft {
  return {
    name: preset.name, providerName: preset.providerName, model: preset.model, escalationProviderName: preset.escalationProviderName, escalationModel: preset.escalationModel,
    items: preset.items, followUp: preset.followUp, room: preset.room, context: preset.context, fields: preset.fields, assets: preset.assets,
  }
}

/** A free item id for a new item (the server keeps ids stable; logs and stats key on them). */
function newItem(items: ChatJudgeItem[]): ChatJudgeItem {
  let n = items.length + 1
  while (items.some((item) => item.id === `custom-${n}`)) n += 1
  return {
    id: `custom-${n}`, name: '', enabled: true, stage: 'before', kind: 'noul', instructions: '', criteria: { yes: '', no: '' }, options: [],
    window: 6, yesThreshold: 0.7, noThreshold: 0.3, uncertain: 'default', tools: [], directive: '',
  }
}

/**
 * Create or edit one judge preset (option A: one column, items unfold in place). Saving reaches every profile that
 * references it. The test runs the draft as it stands on one of the editor's own chats; nothing is logged.
 */
export function ChatJudgePresetEditorModal({ open, preset, initial, onClose, onDuplicate, duplicating }: {
  open: boolean
  preset: ChatJudgePreset | null
  initial?: ChatJudgePresetInput
  onClose: () => void
  onDuplicate?: (preset: ChatJudgePreset) => void
  duplicating?: boolean
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<PresetDraft>(EMPTY)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [testThreadId, setTestThreadId] = useState<number | null>(null)
  const [testTurnCount, setTestTurnCount] = useState(6)
  const [testTurns, setTestTurns] = useState<ChatJudgeTestTurn[] | null>(null)
  const testAbort = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    setDraft(preset ? draftOf(preset) : { ...EMPTY, ...initial } as PresetDraft)
    setOpenItem(null)
    setTestTurns(null)
  }, [initial, open, preset])

  const threadsQuery = useQuery({ queryKey: ['codex-chat-judge-test-threads'], queryFn: listCodexChatThreads, enabled: open })
  const threads = (threadsQuery.data ?? []).filter((thread) => thread.kind !== 'group')

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
  ])
  const saveMutation = useMutation({
    mutationFn: () => (preset ? updateChatJudgePreset(preset.id, draft) : createChatJudgePreset(draft)),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatJudgePreset(preset?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })
  const testMutation = useMutation({
    mutationFn: () => {
      testAbort.current?.abort()
      testAbort.current = new AbortController()
      return testChatJudgePreset({ preset: draft, threadId: testThreadId ?? 0, turns: testTurnCount }, testAbort.current.signal)
    },
    onSuccess: (turns) => {
      setTestTurns(turns)
      const errors = [...new Set(turns.map((turn) => turn.error).filter(Boolean))]
      if (errors.length > 0) showSnackbar({ message: errors.join(' / '), tone: 'error' })
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      showSnackbar({ message: getErrorMessage(error, t({ ko: '테스트하지 못했어.', en: 'Could not test.' })), tone: 'error' })
    },
  })

  const handleDelete = async () => {
    const using = (preset?.profiles.length ?? 0) + (preset?.rooms.length ?? 0)
    const confirmed = await confirm({
      title: t({ ko: '판단 프리셋 삭제', en: 'Delete judge preset' }),
      description: using > 0
        ? t({ ko: '프로필·그룹 방 {count}개가 이 프리셋을 써. 지우면 판단 없이 동작해.', en: '{count} profiles and rooms use it. They will chat without a judge.' }, { count: using })
        : t({ ko: '이 판단 프리셋을 지울까?', en: 'Delete this judge preset?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const patchItem = (id: string, patch: Partial<ChatJudgeItem>) => setDraft((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }))
  const addItem = () => {
    const item = newItem(draft.items)
    setDraft((current) => ({ ...current, items: [...current.items, item] }))
    setOpenItem(item.id)
  }
  const patchFollowUp = (patch: Partial<ChatJudgeFollowUp>) => setDraft((current) => ({ ...current, followUp: { ...current.followUp, ...patch } }))

  const nameMissing = draft.name.trim().length === 0
  const hasAfterItems = draft.items.some((item) => item.stage === 'after')
  const testControls = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{t({ ko: '테스트', en: 'Test' })}</span>
      <Select variant="settings" className="h-8 w-56 min-w-0 flex-1 text-xs" aria-label={t({ ko: '테스트할 대화', en: 'Chat to test on' })} value={testThreadId ?? ''} onChange={(event) => setTestThreadId(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{threads.length === 0 ? t({ ko: '1:1 채팅이 없어', en: 'No direct chats' }) : t({ ko: '대화 고르기', en: 'Pick a chat' })}</option>
        {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || t({ ko: '제목 없음 #{id}', en: 'Untitled #{id}' }, { id: thread.id })}</option>)}
      </Select>
      <Select variant="settings" className="h-8 w-24 text-xs" aria-label={t({ ko: '최근 메시지 수', en: 'Recent messages' })} value={testTurnCount} onChange={(event) => setTestTurnCount(Number(event.target.value))}>
        {TEST_TURNS.map((count) => <option key={count} value={count}>{t({ ko: '최근 {n}개', en: 'Last {n}' }, { n: count })}</option>)}
      </Select>
      {testMutation.isPending
        ? <IconButton size="icon-sm" variant="ghost" onClick={() => testAbort.current?.abort()} label={t({ ko: '멈추기', en: 'Stop' })}><Square /></IconButton>
        : <IconButton size="icon-sm" variant="ghost" disabled={!testThreadId || draft.items.length === 0 || (!draft.providerName && !preset?.profiles.length)} onClick={() => testMutation.mutate()} label={t({ ko: '테스트 실행', en: 'Run test' })}><Play /></IconButton>}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={preset ? t({ ko: '판단 프리셋 편집', en: 'Edit judge preset' }) : t({ ko: '판단 프리셋 추가', en: 'Add judge preset' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t({ ko: '판단 연결', en: 'Judge connection' })}>
            <JudgeConnectionSelect
              enabled={open}
              ariaLabel={t({ ko: '판단 연결', en: 'Judge connection' })}
              providerName={draft.providerName}
              model={draft.model}
              emptyLabel={t({ ko: '프로필에서 정함', en: 'Set per profile' })}
              onChange={({ providerName, model }) => setDraft({ ...draft, providerName, model })}
            />
          </Field>
        </div>

        <section className="space-y-3 border-t border-line pt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium"><MessageSquarePlus className="size-4 text-muted-foreground" aria-hidden="true" />{t({ ko: '후속 메시지', en: 'Follow-up messages' })}</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t({ ko: '연속 최대', en: 'At most in a row' })}>
              <NumberStepperInput variant="settings" min={0} max={3} step={1} value={draft.followUp.maxConsecutive} onValueCommit={(value) => patchFollowUp({ maxConsecutive: Number(value) || 0 })} aria-label={t({ ko: '연속 최대', en: 'At most in a row' })} />
            </Field>
            <Field label={t({ ko: '보내기 전 대기 (초)', en: 'Wait before sending (s)' })}>
              <NumberStepperInput variant="settings" min={0} max={600} step={1} value={draft.followUp.delaySeconds} onValueCommit={(value) => patchFollowUp({ delaySeconds: Number(value) || 0 })} aria-label={t({ ko: '보내기 전 대기 (초)', en: 'Wait before sending (s)' })} />
            </Field>
            <Field label={t({ ko: '적용', en: 'Applies to' })}>
              <div className="flex min-h-10 items-center text-sm text-muted-foreground">{t({ ko: '1:1 대화만', en: 'Direct chats only' })}</div>
            </Field>
          </div>
          {hasAfterItems ? (
            <Textarea variant="settings" className={GROW_TEXTAREA} value={draft.followUp.directive} maxLength={2000} aria-label={t({ ko: '후속 지시문', en: 'Follow-up directive' })} placeholder={t({ ko: '후속 지시문 (비우면 기본)', en: 'Follow-up directive (empty: default)' })} onChange={(event) => patchFollowUp({ directive: event.target.value })} />
          ) : null}
        </section>

        <section className="border-t border-line pt-4">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <h3 className="text-sm font-medium">{t({ ko: '판단 항목', en: 'Judgment items' })} <span className="tabular-nums text-muted-foreground">{draft.items.length}</span></h3>
            <IconButton size="icon-sm" variant="ghost" disabled={draft.items.length >= 16} onClick={addItem} label={t({ ko: '항목 추가', en: 'Add item' })}><Plus /></IconButton>
          </div>
          <div>
            {draft.items.map((item) => (
              <ChatJudgeItemRow
                key={item.id}
                item={item}
                open={openItem === item.id}
                onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}
                onChange={(patch) => patchItem(item.id, patch)}
                onRemove={() => setDraft((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))}
                test={testControls}
                testTurns={testTurns}
              />
            ))}
          </div>
        </section>

        <ChatJudgeScopeSections value={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />

        <div className="border-t border-line">
          <CollapsibleRow
            title={t({ ko: '고급', en: 'Advanced' })}
            meta={draft.escalationProviderName ?? t({ ko: '재판단: 대화 모델', en: 'Re-judge: chat model' })}
          >
            <Field label={t({ ko: '애매할 때 다시 물을 LLM', en: 'LLM asked again when unsure' })}>
              <JudgeConnectionSelect
                enabled={open}
                llmOnly
                ariaLabel={t({ ko: '재판단 LLM', en: 'Re-judge LLM' })}
                providerName={draft.escalationProviderName}
                model={draft.escalationModel}
                emptyLabel={t({ ko: '대화 모델 그대로', en: 'Same as chat' })}
                onChange={({ providerName, model }) => setDraft({ ...draft, escalationProviderName: providerName, escalationModel: model })}
              />
            </Field>
          </CollapsibleRow>
        </div>
      </ModalBody>
      <ModalFooter>
        {preset ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatJudgePresetFile(draft)} disabled={nameMissing} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
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
