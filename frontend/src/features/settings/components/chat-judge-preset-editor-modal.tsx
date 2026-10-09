import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { JUDGE_OPTION_DEFAULTS, type ChatJudgeFollowUp, type ChatJudgeItem, type ChatJudgeTestTurn } from '@conai/shared'
import { Copy, Download, FlaskConical, LoaderCircle, Play, Plus, Square } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { EditorPaneHeader, EditorSplit, type EditorNavGroup } from '@/components/ui/editor-split'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
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
import { JudgeModelSelect } from './chat-judge-connection-select'
import { ChatJudgeItemPane, itemTestSummary } from './chat-judge-item-editor'
import { JudgeAssetsPane, JudgeContextPane, JudgeFieldsPane, JudgeRoomPane, judgeScopesOn, type JudgeScopes } from './chat-judge-scope-sections'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'

type PresetDraft = Required<Omit<ChatJudgePresetInput, 'providerName' | 'model' | 'escalationProviderName' | 'escalationModel'>>

const FOLLOW_UP_DEFAULTS: ChatJudgeFollowUp = { maxConsecutive: 1, delaySeconds: 8, directive: '' }
const EMPTY: PresetDraft = { name: '', modelSlotId: null, escalationSlotId: null, items: [], followUp: FOLLOW_UP_DEFAULTS, ...JUDGE_OPTION_DEFAULTS }
const TEST_TURNS = [4, 6, 10, 20]

function draftOf(preset: ChatJudgePreset): PresetDraft {
  return {
    name: preset.name, modelSlotId: preset.modelSlotId, escalationSlotId: preset.escalationSlotId,
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
 * Create or edit one judge preset: its sections listed on the left (basics, items, follow-ups, built-in judgments),
 * the picked one on the right. Saving reaches every profile that references it. The test runs the draft as it stands
 * on one of the editor's own chats (nothing is logged); each item shows its results, and the list their yes count.
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
  /** The section on the right: `base`, `item:<id>`, `follow`, or a built-in judgment. */
  const [pane, setPane] = useState('base')
  /** Phone layout: the section list until one is picked. */
  const [showingList, setShowingList] = useState(true)
  const [testOpen, setTestOpen] = useState(false)
  const [testThreadId, setTestThreadId] = useState<number | null>(null)
  const [testTurnCount, setTestTurnCount] = useState(6)
  const [testTurns, setTestTurns] = useState<ChatJudgeTestTurn[] | null>(null)
  const testAbort = useRef<AbortController | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    setDraft(preset ? draftOf(preset) : { ...EMPTY, ...initial } as PresetDraft)
    setPane('base')
    setShowingList(true)
    setTestOpen(false)
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
    setPane(`item:${item.id}`)
    setShowingList(false)
  }
  const patchFollowUp = (patch: Partial<ChatJudgeFollowUp>) => setDraft((current) => ({ ...current, followUp: { ...current.followUp, ...patch } }))

  const nameMissing = draft.name.trim().length === 0
  const dirty = JSON.stringify(draft) !== JSON.stringify(preset ? draftOf(preset) : { ...EMPTY, ...initial })
  // A connected chat reads the preset and fills its name; the questions themselves stay with the person.
  useSettingsEditorChatPage({
    open,
    title: preset ? t({ ko: '판단 프리셋 편집 · {name}', en: 'Edit judge preset · {name}' }, { name: preset.name }) : t({ ko: '판단 프리셋 추가', en: 'Add judge preset' }),
    resourceId: `judge-preset:${preset?.id ?? 'new'}`,
    dirty,
    fields: [{ id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: draft.name }],
    data: { items: draft.items.map((item) => ({ id: item.id, name: item.name, enabled: item.enabled, stage: item.stage, kind: item.kind })), selected: { name: draft.name, items: draft.items.length } },
    apply: (patch) => { if (patch.name !== undefined) setDraft((current) => ({ ...current, name: String(patch.name) })) },
    save: nameMissing ? undefined : () => saveMutation.mutateAsync(),
  })
  const hasAfterItems = draft.items.some((item) => item.stage === 'after')
  const testControls = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Select variant="settings" className="h-8 w-56 min-w-0 flex-1 text-xs" aria-label={t({ ko: '테스트할 대화', en: 'Chat to test on' })} value={testThreadId ?? ''} onChange={(event) => setTestThreadId(event.target.value ? Number(event.target.value) : null)}>
        <option value="">{threads.length === 0 ? t({ ko: '1:1 채팅이 없어', en: 'No direct chats' }) : t({ ko: '대화 고르기', en: 'Pick a chat' })}</option>
        {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || t({ ko: '제목 없음 #{id}', en: 'Untitled #{id}' }, { id: thread.id })}</option>)}
      </Select>
      <Select variant="settings" className="h-8 w-24 text-xs" aria-label={t({ ko: '최근 메시지 수', en: 'Recent messages' })} value={testTurnCount} onChange={(event) => setTestTurnCount(Number(event.target.value))}>
        {TEST_TURNS.map((count) => <option key={count} value={count}>{t({ ko: '최근 {n}개', en: 'Last {n}' }, { n: count })}</option>)}
      </Select>
      {testMutation.isPending
        ? <IconButton size="icon-sm" variant="ghost" onClick={() => testAbort.current?.abort()} label={t({ ko: '멈추기', en: 'Stop' })}><Square /></IconButton>
        : <IconButton size="icon-sm" variant="ghost" disabled={!testThreadId || draft.items.length === 0 || (draft.modelSlotId === null && !preset?.profiles.length)} onClick={() => testMutation.mutate()} label={t({ ko: '테스트 실행', en: 'Run test' })}><Play /></IconButton>}
    </div>
  )

  const scopesOn = judgeScopesOn(draft)
  const patchScopes = (patch: Partial<JudgeScopes>) => setDraft((current) => ({ ...current, ...patch }))
  const go = (next: string) => {
    setPane(next)
    setShowingList(false)
  }
  const removeItem = (id: string) => {
    const index = draft.items.findIndex((item) => item.id === id)
    const rest = draft.items.filter((item) => item.id !== id)
    setDraft((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== id) }))
    setPane(rest.length > 0 ? `item:${rest[Math.min(index, rest.length - 1)].id}` : 'base')
  }
  const navGroups: EditorNavGroup[] = [
    { id: 'base', items: [{ id: 'base', label: t({ ko: '기본', en: 'Basics' }) }] },
    {
      id: 'items',
      label: <>{t({ ko: '판단 항목', en: 'Judgment items' })} <span className="tabular-nums">{draft.items.length}</span></>,
      actions: <IconButton size="icon-xs" variant="ghost" disabled={draft.items.length >= 16} onClick={addItem} label={t({ ko: '항목 추가', en: 'Add item' })}><Plus /></IconButton>,
      items: [
        ...draft.items.map((item) => {
          const summary = testTurns ? itemTestSummary(item, testTurns) : null
          return {
            id: `item:${item.id}`,
            label: item.name || t({ ko: '이름 없음', en: 'Untitled' }),
            state: item.enabled ? 'on' as const : 'off' as const,
            trailing: summary
              ? <Tip content={t({ ko: '테스트: 예 {yes} / {total}', en: 'Test: yes {yes} / {total}' }, summary)}><span className="text-success">{summary.yes}/{summary.total}</span></Tip>
              : item.stage === 'after' ? t({ ko: '답변 후', en: 'After' }) : undefined,
          }
        }),
        {
          id: 'follow',
          label: t({ ko: '후속 메시지', en: 'Follow-ups' }),
          state: hasAfterItems && draft.followUp.maxConsecutive > 0 ? 'on' as const : 'off' as const,
          trailing: draft.followUp.maxConsecutive > 0 ? t({ ko: '{n}회', en: '{n}×' }, { n: draft.followUp.maxConsecutive }) : undefined,
        },
      ],
    },
    {
      id: 'builtin',
      label: t({ ko: '기본 제공', en: 'Built in' }),
      items: [
        { id: 'room', label: t({ ko: '그룹 대화', en: 'Group rooms' }), state: scopesOn.room ? 'on' : 'off' },
        { id: 'context', label: t({ ko: '로어·회상', en: 'Lore & recall' }), state: scopesOn.context ? 'on' : 'off' },
        { id: 'fields', label: t({ ko: '상태 필드', en: 'Status fields' }), state: scopesOn.fields ? 'on' : 'off' },
        { id: 'assets', label: t({ ko: '표정 검수', en: 'Expression review' }), state: scopesOn.assets ? 'on' : 'off' },
      ],
    },
  ]
  const openItem = pane.startsWith('item:') ? draft.items.find((item) => `item:${item.id}` === pane) : undefined
  const users = [...(preset?.profiles.map((profile) => profile.name) ?? []), ...(preset?.rooms.map((room) => room.title || `#${room.id}`) ?? [])]
  const canSave = !nameMissing && !saveMutation.isPending && (dirty || !preset)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preset ? t({ ko: '판단 프리셋 편집', en: 'Edit judge preset' }) : t({ ko: '판단 프리셋 추가', en: 'Add judge preset' })}
      size="wide"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? () => saveMutation.mutate() : undefined}
      headerActions={(
        <IconButton size="icon-sm" variant="ghost" active={testOpen} onClick={() => setTestOpen(!testOpen)} label={t({ ko: '테스트', en: 'Test' })}>
          {testMutation.isPending ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
        </IconButton>
      )}
      headerContent={testOpen ? testControls : undefined}
    >
      <EditorSplit
        groups={navGroups}
        current={pane}
        onSelect={go}
        showingList={showingList}
        onShowList={() => setShowingList(true)}
        navLabel={t({ ko: '판단 프리셋 항목', en: 'Judge preset sections' })}
      >
        {pane === 'base' ? (
          <div>
            <EditorPaneHeader title={t({ ko: '기본', en: 'Basics' })} />
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>}>
                  <Input variant="settings" value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </Field>
                <Field label={t({ ko: '판단 모델', en: 'Judge model' })}>
                  <JudgeModelSelect
                    enabled={open}
                    ariaLabel={t({ ko: '판단 모델', en: 'Judge model' })}
                    slotId={draft.modelSlotId}
                    emptyLabel={t({ ko: '프로필에서 정함', en: 'Set per profile' })}
                    onChange={(modelSlotId) => setDraft({ ...draft, modelSlotId })}
                  />
                </Field>
              </div>
              <Field label={t({ ko: '애매할 때 다시 물을 LLM', en: 'LLM asked again when unsure' })}>
                <JudgeModelSelect
                  enabled={open}
                  llmOnly
                  ariaLabel={t({ ko: '재판단 LLM', en: 'Re-judge LLM' })}
                  slotId={draft.escalationSlotId}
                  emptyLabel={t({ ko: '대화 모델 그대로', en: 'Same as chat' })}
                  onChange={(escalationSlotId) => setDraft({ ...draft, escalationSlotId })}
                />
              </Field>
              {users.length > 0 ? (
                <div className="border-t border-line">
                  <SettingRow label={t({ ko: '쓰는 곳', en: 'Used by' })} controlClassName="max-w-[60%]">
                    <span className="truncate text-sm text-muted-foreground" title={users.join(', ')}>{users.join(', ')}</span>
                  </SettingRow>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {openItem ? (
          <ChatJudgeItemPane
            key={openItem.id}
            item={openItem}
            onChange={(patch) => patchItem(openItem.id, patch)}
            onRemove={() => removeItem(openItem.id)}
            testTurns={testTurns}
          />
        ) : null}

        {pane === 'follow' ? (
          <div>
            <EditorPaneHeader title={t({ ko: '후속 메시지', en: 'Follow-up messages' })} info={t({ ko: '1:1 대화에서, 답변 후 항목이 예일 때 보내.', en: 'Direct chats only, when an after-reply item says yes.' })} />
            <div className="space-y-4">
              <div className="border-t border-line">
                <SettingRow label={t({ ko: '연속 최대', en: 'At most in a row' })}>
                  <NumberStepperInput variant="settings" className="w-32" min={0} max={3} step={1} value={draft.followUp.maxConsecutive} onValueCommit={(value) => patchFollowUp({ maxConsecutive: Number(value) || 0 })} aria-label={t({ ko: '연속 최대', en: 'At most in a row' })} />
                </SettingRow>
                <SettingRow label={t({ ko: '보내기 전 대기 (초)', en: 'Wait before sending (s)' })}>
                  <NumberStepperInput variant="settings" className="w-32" min={0} max={600} step={1} value={draft.followUp.delaySeconds} onValueCommit={(value) => patchFollowUp({ delaySeconds: Number(value) || 0 })} aria-label={t({ ko: '보내기 전 대기 (초)', en: 'Wait before sending (s)' })} />
                </SettingRow>
              </div>
              {hasAfterItems ? (
                <Field label={t({ ko: '후속 지시문', en: 'Follow-up directive' })}>
                  <Textarea variant="settings" className={GROW_TEXTAREA} value={draft.followUp.directive} maxLength={2000} placeholder={t({ ko: '비우면 기본', en: 'Empty: default' })} onChange={(event) => patchFollowUp({ directive: event.target.value })} />
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}

        {pane === 'room' ? <JudgeRoomPane value={draft} onChange={patchScopes} /> : null}
        {pane === 'context' ? <JudgeContextPane value={draft} onChange={patchScopes} /> : null}
        {pane === 'fields' ? <JudgeFieldsPane value={draft} onChange={patchScopes} /> : null}
        {pane === 'assets' ? <JudgeAssetsPane value={draft} onChange={patchScopes} /> : null}
      </EditorSplit>
      <EditorFooter
        onDelete={preset ? () => void handleDelete() : undefined}
        deleteLabel={t({ ko: '프리셋 삭제', en: 'Delete preset' })}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      >
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatJudgePresetFile(draft)} disabled={nameMissing} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
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
