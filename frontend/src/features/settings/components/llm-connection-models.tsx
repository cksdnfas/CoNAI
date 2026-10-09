import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, LoaderCircle, Lock, Plus, RefreshCw, Save, Star, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { EditorGroup } from '@/components/ui/editor-group'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { ResourceRow, ResourceRowStat, ResourceRowStatus } from '@/components/ui/resource-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  MODEL_USAGE_QUERY_KEY,
  deleteModelSlot,
  listChatConnectionModels,
  updateModelSlot,
  type ModelSlot,
  type ModelUseRole,
} from '@/lib/api-codex-chat'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { ConnectionModelSelect } from './chat-profile-editor-fields'

const EMPTY_MODELS: string[] = []

/** Refreshes everything a model change can alter: the rows, workflow usage and both profile lists. */
export function useRefreshModelRows() {
  const queryClient = useQueryClient()
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: MODEL_SLOTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: MODEL_USAGE_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
  ])
}

function useRoleLabels(): Record<ModelUseRole, string> {
  const { t } = useI18n()
  return {
    chat: t({ ko: '대화', en: 'Chat' }),
    summary: t({ ko: '요약', en: 'Summary' }),
    translation: t({ ko: '번역', en: 'Translation' }),
    suggest: t({ ko: '답장 추천', en: 'Suggestions' }),
    judge: t({ ko: '판단', en: 'Judge' }),
  }
}

/** How many things use a row (workflow nodes included). */
export function slotUseCount(slot: ModelSlot, workflowNodes = 0) {
  return slot.profiles.length + slot.judgePresets.length + slot.userProfiles + slot.chats + workflowNodes
}

/** "세라 (대화, 요약)\n판단 프리셋: 기본\n워크플로 노드 2" — who uses a row, one kind per line. */
function useUsageLines(slot: ModelSlot, workflowNodes: number) {
  const { t } = useI18n()
  const roles = useRoleLabels()
  return [
    slot.profiles.length > 0 ? slot.profiles.map((profile) => `${profile.name} (${profile.roles.map((role) => roles[role]).join(', ')})`).join(' · ') : null,
    slot.judgePresets.length > 0 ? `${t({ ko: '판단 프리셋', en: 'Judge presets' })}: ${slot.judgePresets.map((preset) => preset.name).join(', ')}` : null,
    slot.userProfiles > 0 ? t({ ko: '사용자 프로필 {count}', en: '{count} user profiles' }, { count: slot.userProfiles }) : null,
    slot.chats > 0 ? t({ ko: '채팅 반응 {count}', en: '{count} chat reactions' }, { count: slot.chats }) : null,
    workflowNodes > 0 ? t({ ko: '워크플로 노드 {count}', en: '{count} workflow nodes' }, { count: workflowNodes }) : null,
  ].filter((line): line is string => line !== null)
}

/** One model under its connection: the model id, who uses it, and the ★ default (LLM models only). */
export function ConnectionModelRow({ slot, workflowNodes, settingDefault, onSetDefault, onOpen }: {
  slot: ModelSlot
  workflowNodes: number
  settingDefault: boolean
  onSetDefault: (slot: ModelSlot) => void
  onOpen: (slot: ModelSlot) => void
}) {
  const { t } = useI18n()
  const lines = useUsageLines(slot, workflowNodes)
  const uses = slotUseCount(slot, workflowNodes)
  const canBeDefault = slot.providerType !== null && slot.providerType !== 'decision_typesafe'

  return (
    <ResourceRow
      className="pl-10 before:left-10"
      name={<span className="font-mono text-xs font-normal">{slot.model}</span>}
      extra={uses === 0 ? <ResourceRowStatus>{t({ ko: '사용처 없음', en: 'Not used' })}</ResourceRowStatus> : null}
      aside={uses > 0 ? <ResourceRowStat icon={Link2} tip={<span className="whitespace-pre-line">{lines.join('\n')}</span>}>{uses}</ResourceRowStat> : null}
      trailing={canBeDefault ? (
        <IconButton
          size="icon-sm"
          variant="ghost"
          disabled={slot.isDefault || settingDefault}
          onClick={() => onSetDefault(slot)}
          label={slot.isDefault ? t({ ko: '기본 모델', en: 'Default model' }) : t({ ko: '기본으로', en: 'Make default' })}
        >
          <Star className={cn('h-4 w-4', slot.isDefault && 'fill-primary text-primary')} />
        </IconButton>
      ) : null}
      onOpen={() => onOpen(slot)}
    />
  )
}

/** Change one row's model (everything using the row follows) or delete an unused row. */
export function ConnectionModelEditorModal({ slot, workflowNodes, onClose }: { slot: ModelSlot | null; workflowNodes: number; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const refresh = useRefreshModelRows()
  const [model, setModel] = useState('')
  useEffect(() => {
    if (slot) setModel(slot.model)
  }, [slot])

  const modelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', slot?.providerName ?? ''],
    queryFn: () => listChatConnectionModels(slot?.providerName ?? ''),
    enabled: slot !== null && slot.providerType !== 'decision_typesafe',
    retry: false,
    staleTime: 60_000,
  })
  const lines = useUsageLines(slot ?? { profiles: [], judgePresets: [], userProfiles: 0, chats: 0 } as unknown as ModelSlot, workflowNodes)
  const used = slot !== null && slotUseCount(slot, workflowNodes) > 0

  const saveMutation = useMutation({
    mutationFn: () => updateModelSlot(slot?.id ?? 0, { model: model.trim() }),
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '저장하지 못했어.', en: 'Could not save.' }), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteModelSlot(slot?.id ?? 0),
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '지웠어.', en: 'Deleted.' }), tone: 'info' })
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '지우지 못했어.', en: 'Could not delete.' }), tone: 'error' }),
  })
  const busy = saveMutation.isPending || deleteMutation.isPending

  return (
    <Modal
      open={slot !== null}
      onClose={onClose}
      title={slot ? slot.providerLabel : ''}
      size="narrow"
      dirty={slot !== null && model.trim() !== slot.model}
      onSave={model.trim() && model.trim() !== slot?.model && !busy ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody>
        <Field
          label={t({ ko: '모델', en: 'Model' })}
          info={used ? t({ ko: '바꾸면 이 모델을 쓰는 곳이 모두 따라 바뀌어.', en: 'Everything using this model follows the change.' }) : undefined}
        >
          <ConnectionModelSelect value={model} models={modelsQuery.data?.models ?? EMPTY_MODELS} defaultModel={slot?.model ?? null} onChange={setModel} />
        </Field>
      </ModalBody>
      {/* EditorFooter's shape; the delete keeps its own tooltip listing what uses the model. */}
      <ModalFooter className="mt-4 gap-1 border-t border-line pt-3">
        <Tip content={used ? <span className="whitespace-pre-line">{`${t({ ko: '쓰는 곳이 있어서 지울 수 없어', en: 'In use, so it cannot be deleted' })}\n${lines.join('\n')}`}</span> : null}>
          <span>
            <IconButton size="icon-sm" variant="destructive-ghost" disabled={used || busy} onClick={() => deleteMutation.mutate()} label={t({ ko: '모델 삭제', en: 'Delete model' })}>
              {deleteMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </IconButton>
          </span>
        </Tip>
        <span className="flex-1" />
        <IconButton size="icon-sm" onClick={() => saveMutation.mutate()} disabled={!model.trim() || model.trim() === slot?.model || busy} label={t({ ko: '저장', en: 'Save' })}>
          {saveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}

/** The models picked for a connection in its editor: the checked ones in order and the one starred as the default. */
export type ConnectionModelsDraft = { models: string[]; defaultModel: string }

/**
 * The connection editor's model checklist: what the server lists, plus the connection's saved rows and models typed in.
 * A saved row that something uses stays checked (locked, with its use count).
 */
export function ConnectionModelChecklist({ value, listed, saved, loading, canStar, onRefresh, onChange }: {
  value: ConnectionModelsDraft
  /** Model ids the server lists. */
  listed: string[]
  /** The connection's saved rows (empty for a new connection). */
  saved: ModelSlot[]
  loading: boolean
  /** LLM connections only: TypeSafe models are never the default. */
  canStar: boolean
  onRefresh: () => void
  onChange: (next: ConnectionModelsDraft) => void
}) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const all = [...new Set([...saved.map((slot) => slot.model), ...value.models, ...listed])]
  const toggle = (model: string, checked: boolean) => {
    const models = checked ? [...value.models, model].sort((a, b) => all.indexOf(a) - all.indexOf(b)) : value.models.filter((entry) => entry !== model)
    onChange({ models, defaultModel: models.includes(value.defaultModel) ? value.defaultModel : '' })
  }
  const add = () => {
    const model = typed.trim()
    if (!model) return
    if (!value.models.includes(model)) onChange({ ...value, models: [...value.models, model] })
    setTyped('')
  }

  return (
    <EditorGroup
      label={all.length > 0 ? `${t({ ko: '모델', en: 'Models' })} ${value.models.length} / ${all.length}` : t({ ko: '모델', en: 'Models' })}
      actions={(
        <IconButton size="icon-sm" variant="ghost" onClick={onRefresh} disabled={loading} label={t({ ko: '서버 목록 다시 읽기', en: 'Reload the server list' })}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </IconButton>
      )}
    >
      <div>
      {all.map((model) => {
        const row = saved.find((slot) => slot.model === model)
        const uses = row ? slotUseCount(row) : 0
        const checked = value.models.includes(model)
        const id = `connection-model-${model}`
        return (
          <div key={model} className="flex h-9 items-center gap-2.5 border-b border-line px-1 text-sm last:border-b-0">
            <Checkbox id={id} checked={checked} disabled={uses > 0} onCheckedChange={(next) => toggle(model, next === true)} />
            <label htmlFor={id} className={cn('min-w-0 flex-1 cursor-pointer truncate font-mono text-xs', !checked && 'text-muted-foreground')}>{model}</label>
            {uses > 0 ? (
              <Tip content={t({ ko: '쓰는 곳이 있어서 뺄 수 없어', en: 'In use, so it stays' })}>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"><Lock className="size-3" aria-hidden />{uses}</span>
              </Tip>
            ) : null}
            {canStar && checked ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                onClick={() => onChange({ ...value, defaultModel: value.defaultModel === model ? '' : model })}
                label={value.defaultModel === model ? t({ ko: '기본 모델', en: 'Default model' }) : t({ ko: '기본으로', en: 'Make default' })}
              >
                <Star className={cn('h-3.5 w-3.5', value.defaultModel === model && 'fill-primary text-primary')} />
              </IconButton>
            ) : null}
          </div>
        )
      })}
      <div className="flex items-center gap-2 pt-2">
        <Input
          variant="settings"
          className={typed ? 'font-mono' : undefined}
          value={typed}
          placeholder={t({ ko: '목록에 없는 모델 ID', en: 'Model id not in the list' })}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <IconButton size="icon-sm" variant="secondary" onClick={add} disabled={!typed.trim()} label={t({ ko: '모델 추가', en: 'Add model' })}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>
      </div>
    </EditorGroup>
  )
}
