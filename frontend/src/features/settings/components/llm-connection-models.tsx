import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Link2, Plus, RefreshCw, Route, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EditorGroup } from '@/components/ui/editor-group'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { ResourceRow, ResourceRowStat, ResourceRowStatus } from '@/components/ui/resource-row'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_MODEL_OPTIONS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_PROFILE_DEFAULTS_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  MODEL_USAGE_QUERY_KEY,
  ROUTE_NO_CEILING,
  createModelRoute,
  deleteModelSlot,
  listChatConnectionModels,
  listModelSlots,
  listReplacementCandidates,
  updateModelRoute,
  updateModelSlot,
  type ModelReplacement,
  type ModelRouteKey,
  type ModelSlot,
  type ModelUseRole,
} from '@/lib/api-codex-chat'
import { CONTENT_EVALUATION_QUERY_KEY } from '@/lib/api-content-evaluation'
import { POSTS_QUERY_KEY } from '@/lib/api-posts'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { ConnectionModelSelect } from './chat-profile-editor-fields'
import { ContentRatingSelect } from './content-rating-select'

const EMPTY_MODELS: string[] = []

/**
 * Built-in judges, custom default judges and directly selected board evaluators all affect judge consumers, and so
 * does a model row any of those routes points at (`slots`: the full list, to look the pointing routes up).
 */
export function modelAffectsJudge(slot: ModelSlot | null | undefined, slots: readonly ModelSlot[] = []): boolean {
  const judging = (entry: ModelSlot) => entry.routeKey === 'judge' || entry.isDefaultJudge || (entry.contentEvaluations ?? 0) > 0
  return Boolean(slot && (judging(slot) || slot.routes.some((route) => {
    const routeSlot = slots.find((entry) => entry.id === route.id)
    return route.key === 'judge' || (routeSlot !== undefined && judging(routeSlot))
  })))
}

/** Refresh model consumers; only changes reaching the judge need board evaluation/readiness data. */
export function useRefreshModelRows() {
  const queryClient = useQueryClient()
  return ({ judgeChanged = false }: { judgeChanged?: boolean } = {}) => Promise.all([
    queryClient.invalidateQueries({ queryKey: MODEL_SLOTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: MODEL_USAGE_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_MODEL_OPTIONS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    // A new profile starts with the chat representative model's prompt.
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILE_DEFAULTS_QUERY_KEY }),
    // Topic relevance and board evaluations follow the judge representative model; their readiness changes with it.
    ...(judgeChanged ? [
      queryClient.invalidateQueries({ queryKey: [CONTENT_EVALUATION_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    ] : []),
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
    reaction: t({ ko: '완료 반응', en: 'Completion reaction' }),
  }
}

/** A representative model's name: a built-in one is named after its part. */
export function useRouteName() {
  const roles = useRoleLabels()
  return (slot: Pick<ModelSlot, 'routeKey' | 'routeName'>) => (slot.routeKey ? roles[slot.routeKey] : slot.routeName ?? '')
}

/**
 * How many things use a row (workflow nodes included). Chats' own picks (`chats`, `chatModels`) are not uses: removing
 * the row sends those chats back to their profile's setting.
 */
export function slotUseCount(slot: ModelSlot, workflowNodes = 0) {
  return slot.routes.length + slot.profiles.length + slot.judgePresets.length + slot.userProfiles + (slot.contentEvaluations ?? 0) + workflowNodes
}

/** Representative models holding a row: all but the chat one, which moves to another model when its row goes. */
const holdingRoutes = (slot: ModelSlot) => slot.routes.filter((route) => route.key !== 'chat')

/** Configuration that needs a replacement (or a deliberate blank) before the row goes, workflow nodes naming it included. */
export function slotHoldCount(slot: ModelSlot) {
  return holdingRoutes(slot).length + slot.profiles.length + slot.judgePresets.length + slot.userProfiles + (slot.contentEvaluations ?? 0) + (slot.workflowNodes ?? 0) + (slot.isDefaultJudge ? 1 : 0)
}

/**
 * "대표모델: 대화\n세라 (대화, 요약)\n판단 프리셋: 기본\n워크플로 노드 2" — who uses a row, one kind per line;
 * `holdersOnly`: just what slotHoldCount counts.
 */
function useDescribeUse() {
  const { t } = useI18n()
  const roles = useRoleLabels()
  const routeName = useRouteName()
  return (slot: ModelSlot | null, workflowNodes = 0, holdersOnly = false) => {
    if (!slot) return []
    const routes = holdersOnly ? holdingRoutes(slot) : slot.routes
    return [
      routes.length > 0 ? `${t({ ko: '대표모델', en: 'Representative' })}: ${routes.map((route) => routeName({ routeKey: route.key, routeName: route.name })).join(', ')}` : null,
      holdersOnly && slot.isDefaultJudge ? t({ ko: '기본 판단 모델', en: 'Default judge' }) : null,
      slot.profiles.length > 0 ? slot.profiles.map((profile) => `${profile.name} (${profile.roles.map((role) => roles[role]).join(', ')})`).join(' · ') : null,
      slot.judgePresets.length > 0 ? `${t({ ko: '판단 프리셋', en: 'Judge presets' })}: ${slot.judgePresets.map((preset) => preset.name).join(', ')}` : null,
      slot.userProfiles > 0 ? t({ ko: '사용자 프로필 {count}', en: '{count} user profiles' }, { count: slot.userProfiles }) : null,
      (slot.contentEvaluations ?? 0) > 0 ? t({ ko: '게시판 평가', en: 'Board evaluations' }) : null,
      (holdersOnly ? slot.workflowNodes ?? 0 : workflowNodes) > 0 ? t({ ko: '워크플로 노드 {count}', en: '{count} workflow nodes' }, { count: holdersOnly ? slot.workflowNodes ?? 0 : workflowNodes }) : null,
    ].filter((line): line is string => line !== null)
  }
}

/**
 * Consumers left with no usable model (e.g. after a model was removed and left blank), as listed on the judge
 * representative model: named so the admin can pick models for them again.
 */
export function UnconfiguredConsumersAlert({ slot }: { slot: ModelSlot | null | undefined }) {
  const { t } = useI18n()
  const consumers = slot?.unconfiguredConsumers
  if (!consumers) return null
  const lines = [
    consumers.judgePresets.length > 0 ? `${t({ ko: '판단 프리셋', en: 'Judge presets' })}: ${consumers.judgePresets.map((preset) => preset.name).join(', ')}` : null,
    consumers.contentEvaluations > 0 ? t({ ko: '게시판·주제 평가 {count}', en: '{count} board/topic evaluations' }, { count: consumers.contentEvaluations }) : null,
    consumers.routes.length > 0 ? `${t({ ko: '대표모델', en: 'Representative models' })}: ${consumers.routes.map((route) => route.name).join(', ')}` : null,
    (consumers.userProfiles ?? 0) > 0 ? t({ ko: '사용자 프로필 {count}', en: '{count} user profiles' }, { count: consumers.userProfiles ?? 0 }) : null,
  ].filter((line): line is string => line !== null)
  if (lines.length === 0) return null
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertDescription>
        <p>{t({ ko: '쓸 모델이 없어서 꺼진 곳이 있어. 판단 대표모델을 정하거나 각 설정에서 모델을 다시 골라.', en: 'Some settings have no usable model and are off. Point the judge representative model somewhere or pick a model in each setting.' })}</p>
        <ul className="mt-1 space-y-0.5">{lines.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
      </AlertDescription>
    </Alert>
  )
}

function useUsageLines(slot: ModelSlot | null, workflowNodes: number) {
  return useDescribeUse()(slot, workflowNodes)
}

/** Rows per connection, in list order. */
function connectionGroups(rows: ModelSlot[]) {
  const groups: Array<{ key: string; label: string; rows: ModelSlot[] }> = []
  for (const row of rows) {
    const group = groups.find((entry) => entry.key === row.providerName)
    if (group) group.rows.push(row)
    else groups.push({ key: row.providerName, label: row.providerLabel, rows: [row] })
  }
  return groups
}

type RemovalRequest = { rows: ModelSlot[]; resolve: (choice: ModelReplacement | null) => void }

/**
 * Before model rows go: rows nothing holds go as they are (`{}`); otherwise a dialog lists who holds them and asks for
 * a replacement row or a deliberate blank. `choose` resolves null when the admin cancels. Render `dialog`.
 */
export function useModelRemoval() {
  const [request, setRequest] = useState<RemovalRequest | null>(null)
  const choose = (rows: ModelSlot[]) => (rows.some((row) => slotHoldCount(row) > 0)
    ? new Promise<ModelReplacement | null>((resolve) => setRequest({ rows, resolve }))
    : Promise.resolve<ModelReplacement | null>({}))
  const settle = (choice: ModelReplacement | null) => {
    request?.resolve(choice)
    setRequest(null)
  }
  return { choose, dialog: <ModelReplacementDialog request={request} onSettle={settle} /> }
}

function ModelReplacementDialog({ request, onSettle }: { request: RemovalRequest | null; onSettle: (choice: ModelReplacement | null) => void }) {
  const { t } = useI18n()
  const describe = useDescribeUse()
  const rows = request?.rows ?? []
  const slotIds = rows.map((row) => row.id)
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: request !== null })
  // The server decides which rows may take over (the same checks the removal runs).
  const candidatesQuery = useQuery({
    queryKey: ['codex-chat-model-replacement-candidates', ...slotIds],
    queryFn: () => listReplacementCandidates(slotIds),
    enabled: request !== null,
    staleTime: 0,
    gcTime: 0,
  })
  const [choice, setChoice] = useState('')
  useEffect(() => { if (request) setChoice('') }, [request])
  const allowed = new Set(candidatesQuery.data?.slotIds ?? [])
  const candidates = (slotsQuery.data ?? []).filter((slot) => allowed.has(slot.id))
  const routes = candidates.filter((slot) => slot.kind === 'route')
  const groups = connectionGroups(candidates.filter((slot) => slot.kind === 'model'))
  const label = t({ ko: '대신 쓸 모델', en: 'Replacement model' })
  const confirm = () => onSettle({ replacementSlotId: choice === 'blank' ? null : Number(choice) })

  return (
    <Modal open={request !== null} onClose={() => onSettle(null)} title={t({ ko: '쓰는 곳이 있는 모델 삭제', en: 'Delete a model in use' })} size="md">
      <ModalBody spacing="sm">
        <p className="text-sm text-muted-foreground">{t({ ko: '아래 설정이 이 모델을 쓰고 있어. 대신 쓸 모델을 고르거나 비워 둬.', en: 'The settings below use this model. Pick a model to take over, or leave them blank.' })}</p>
        {rows.filter((row) => slotHoldCount(row) > 0).map((row) => (
          <EditorGroup key={row.id} label={row.label}>
            <ul className="space-y-1 text-sm">{describe(row, 0, true).map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
          </EditorGroup>
        ))}
        <Field label={label} info={t({ ko: '채팅에서 따로 고른 모델은 이 선택과 관계없이 프로필 설정으로 돌아가.', en: 'Chats that picked this model themselves go back to their profile’s setting either way.' })}>
          <Select variant="settings" value={choice} aria-label={label} disabled={!slotsQuery.isSuccess || !candidatesQuery.isSuccess} onChange={(event) => setChoice(event.target.value)}>
            <option value="" disabled>{t({ ko: '선택', en: 'Select' })}</option>
            <option value="blank">{t({ ko: '비워 두기', en: 'Leave blank' })}</option>
            {routes.length > 0 ? (
              <optgroup label={t({ ko: '대표모델', en: 'Representative models' })}>
                {routes.map((slot) => <option key={slot.id} value={String(slot.id)} disabled={slot.ready === false}>{slot.model ? `${slot.label} (${slot.model})` : slot.label}</option>)}
              </optgroup>
            ) : null}
            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.rows.map((slot) => <option key={slot.id} value={String(slot.id)} disabled={slot.ready === false}>{slot.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        {candidatesQuery.isError ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription>{candidatesQuery.error instanceof Error ? candidatesQuery.error.message : t({ ko: '대신 쓸 모델 목록을 불러오지 못했어.', en: 'Could not load the replacement models.' })}</AlertDescription>
          </Alert>
        ) : null}
        {choice === 'blank' ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>
              <p>{t({ ko: '비워 두면 이 모델을 쓰던 프로필 역할과 기능이 모델 없이 남아서 꺼져. 대화 모델이 비는 프로필은 프로필 자체가 꺼져.', en: 'Left blank, the profile roles and features using this model keep no model and turn off. A profile left without its chat model is turned off itself.' })}</p>
              <p>{t({ ko: '꺼진 프로필과 역할은 프로필 목록과 편집기에 경고로 보여. 다시 모델을 고르면 돼.', en: 'Affected profiles show a warning in the profile list and editor until a model is picked again.' })}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="button" size="sm" variant="ghost" onClick={() => onSettle(null)}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button type="button" size="sm" variant="destructive" disabled={!choice} onClick={confirm}>
          {choice === 'blank' ? t({ ko: '비우고 삭제', en: 'Delete and leave blank' }) : t({ ko: '바꾸고 삭제', en: 'Replace and delete' })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** One model under its connection: the model id and who uses it. */
export function ConnectionModelRow({ slot, workflowNodes, onOpen }: {
  slot: ModelSlot
  workflowNodes: number
  onOpen: (slot: ModelSlot) => void
}) {
  const { t } = useI18n()
  const lines = useUsageLines(slot, workflowNodes)
  const uses = slotUseCount(slot, workflowNodes)

  return (
    <div className="pl-8"><ResourceRow
      name={<span className="font-mono text-xs font-normal">{slot.model}</span>}
      extra={uses === 0 ? <ResourceRowStatus>{t({ ko: '사용처 없음', en: 'Not used' })}</ResourceRowStatus> : null}
      aside={uses > 0 ? <ResourceRowStat icon={Link2} tip={<span className="whitespace-pre-line">{lines.join('\n')}</span>}>{uses}</ResourceRowStat> : null}
      onOpen={() => onOpen(slot)}
    /></div>
  )
}

/** Change one row's model or content rating ceiling (everything using the row follows) or delete an unused row. */
export function ConnectionModelEditorModal({ slot, workflowNodes, onClose }: { slot: ModelSlot | null; workflowNodes: number; onClose: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const refresh = useRefreshModelRows()
  const queryClient = useQueryClient()
  const affectsJudge = () => modelAffectsJudge(slot, queryClient.getQueryData<ModelSlot[]>(MODEL_SLOTS_QUERY_KEY))
  const [model, setModel] = useState('')
  const [ratingTierId, setRatingTierId] = useState<number | null>(null)
  useEffect(() => {
    if (slot) {
      setModel(slot.model)
      setRatingTierId(slot.contentRatingTierId)
    }
  }, [slot])

  const modelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', slot?.providerName ?? ''],
    queryFn: () => listChatConnectionModels(slot?.providerName ?? ''),
    enabled: slot !== null && slot.providerType !== 'decision_typesafe',
    retry: false,
    staleTime: 60_000,
  })
  const lines = useUsageLines(slot, workflowNodes)
  const used = slot !== null && slotHoldCount(slot) > 0
  const removal = useModelRemoval()

  const saveMutation = useMutation({
    mutationFn: () => updateModelSlot(slot?.id ?? 0, { model: model.trim(), contentRatingTierId: ratingTierId }),
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      await refresh({ judgeChanged: affectsJudge() })
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '저장하지 못했어.', en: 'Could not save.' }), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: (replacement: ModelReplacement) => deleteModelSlot(slot?.id ?? 0, replacement),
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '지웠어.', en: 'Deleted.' }), tone: 'info' })
      await refresh({ judgeChanged: affectsJudge() })
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '지우지 못했어.', en: 'Could not delete.' }), tone: 'error' }),
  })
  const remove = async () => {
    if (!slot) return
    const replacement = await removal.choose([slot])
    if (replacement) deleteMutation.mutate(replacement)
  }
  const busy = saveMutation.isPending || deleteMutation.isPending
  const changed = slot !== null && (model.trim() !== slot.model || ratingTierId !== slot.contentRatingTierId)
  // TypeSafe judges only read text.
  const seesMedia = slot !== null && slot.providerType !== 'decision_typesafe'

  return (
    <Modal
      open={slot !== null}
      onClose={onClose}
      title={slot ? slot.providerLabel : ''}
      size="md"
      dirty={changed}
      onSave={model.trim() && changed && !busy ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody>
        <Field
          label={t({ ko: '모델', en: 'Model' })}
          info={slot !== null && slotUseCount(slot, workflowNodes) > 0 ? t({ ko: '바꾸면 이 모델을 쓰는 곳이 모두 따라 바뀌어.', en: 'Everything using this model follows the change.' }) : undefined}
        >
          <ConnectionModelSelect value={model} models={modelsQuery.data?.models ?? EMPTY_MODELS} defaultModel={slot?.model ?? null} onChange={setModel} />
        </Field>
        {seesMedia ? (
          <Field
            className="mt-3"
            label={t({ ko: '허용 등급', en: 'Content rating' })}
            info={t({ ko: '이 등급을 넘는 이미지·영상은 이 모델에 보내지 않아. 프로필에서 따로 정하면 그쪽이 우선이야.', en: 'Images and videos above this rating are never sent to this model. A profile’s own setting takes precedence.' })}
          >
            <ContentRatingSelect ariaLabel={t({ ko: '허용 등급', en: 'Content rating' })} value={ratingTierId} onChange={(choice) => setRatingTierId(choice === 'model' ? null : choice)} />
          </Field>
        ) : null}
      </ModalBody>
      <EditorFooter
        onDelete={() => void remove()}
        deleteLabel={t({ ko: '모델 삭제', en: 'Delete model' })}
        deleteDisabled={busy}
        deleteTip={used ? <span className="whitespace-pre-line">{`${t({ ko: '쓰는 곳이 있어. 지울 때 대신 쓸 모델을 골라.', en: 'In use: deleting asks for a model to take over.' })}\n${lines.join('\n')}`}</span> : null}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={Boolean(model.trim()) && changed && !busy}
        saving={saveMutation.isPending}
      />
      {removal.dialog}
    </Modal>
  )
}

/** Summary and suggestion representative models can be left to follow the chat model. */
const FOLLOWS_CHAT_KEYS: readonly ModelRouteKey[] = ['summary', 'suggest']

/** Parts whose representative model may stay empty: translation (none) and the judge (no default judge). */
const EMPTY_KEYS: readonly ModelRouteKey[] = ['translation', 'judge']

/** Only the judge (and named representative models) may point at a TypeSafe decision model. */
const routeTakesTypesafe = (key: ModelRouteKey | null) => key === null || key === 'judge'

/** One representative model: its name, where it points, whether its part has a prompt, and who uses it. */
export function ModelRouteRow({ slot, workflowNodes, onOpen }: { slot: ModelSlot; workflowNodes: number; onOpen: (slot: ModelSlot) => void }) {
  const { t } = useI18n()
  const routeName = useRouteName()
  const lines = useUsageLines(slot, workflowNodes)
  const uses = slotUseCount(slot, workflowNodes)
  const target = slot.followsChat
    ? <span className="truncate text-xs text-muted-foreground">{t({ ko: '대화 따라감', en: 'Follows chat' })}</span>
    : slot.model
      ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-xs text-muted-foreground">{slot.providerLabel}</span>
          <span className="truncate font-mono text-xs">{slot.model}</span>
        </span>
      )
      : slot.routeKey === 'translation'
        ? <span className="truncate text-xs text-muted-foreground">{t({ ko: '없음', en: 'None' })}</span>
        : <ResourceRowStatus>{t({ ko: '비어 있음', en: 'Empty' })}</ResourceRowStatus>

  return (
    <ResourceRow
      leading={<Route className={cn(slot.routeKey === 'judge' && 'text-resource-judge')} />}
      name={routeName(slot)}
      extra={(
        <>
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden>→</span>
          {target}
        </>
      )}
      aside={(
        <>
          {slot.prompt ? <ResourceRowStat icon={FileText} tip={t({ ko: '기본 프롬프트', en: 'Default prompt' })}>{null}</ResourceRowStat> : null}
          {uses > 0 ? <ResourceRowStat icon={Link2} tip={<span className="whitespace-pre-line">{lines.join('\n')}</span>}>{uses}</ResourceRowStat> : null}
        </>
      )}
      onOpen={() => onOpen(slot)}
    />
  )
}

export type ModelRouteModalState = { mode: 'create' } | { mode: 'edit'; slot: ModelSlot } | null

/** What the default prompt does for each part. */
function usePromptInfo(): Record<ModelRouteKey, string> {
  const { t } = useI18n()
  return {
    chat: t({ ko: '새 프로필이 이 프롬프트로 시작해.', en: 'New profiles start with this prompt.' }),
    summary: t({ ko: '요약 프롬프트가 빈 프로필은 이걸 써. 비우면 내장 요약 지침을 써.', en: 'Profiles without a summary prompt use this. Empty keeps the built-in one.' }),
    translation: t({ ko: '번역 지침이 빈 프로필은 이걸 말투·용어 메모로 써.', en: 'Profiles without translation notes use this as their voice and term notes.' }),
    suggest: t({ ko: '모든 답장 추천에 지시로 붙어.', en: 'Added as direction to every reply suggestion.' }),
    judge: t({ ko: 'LLM 판단 모델에 늘 붙는 지침이야. TypeSafe 판단에는 안 붙어.', en: 'Standing guidance for LLM judges. TypeSafe judges never get it.' }),
  }
}

/**
 * Creates a named representative model, or changes one: where it points (everything that picked it follows), its
 * part's default prompt (built-in ones), its own content rating ceiling, its name (named ones). Named ones nothing
 * uses can be deleted.
 */
export function ModelRouteEditorModal({ state, slots, workflowNodes, onClose }: {
  state: ModelRouteModalState
  slots: ModelSlot[]
  workflowNodes: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const refresh = useRefreshModelRows()
  const routeName = useRouteName()
  const promptInfo = usePromptInfo()
  const slot = state?.mode === 'edit' ? state.slot : null
  const key = slot?.routeKey ?? null
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [prompt, setPrompt] = useState('')
  const [ratingTierId, setRatingTierId] = useState<number | null>(null)
  useEffect(() => {
    if (!state) return
    setName(slot?.routeName ?? '')
    setTarget(slot?.targetSlotId ? String(slot.targetSlotId) : '')
    setPrompt(slot?.prompt ?? '')
    setRatingTierId(slot?.contentRatingTierId ?? null)
  }, [state, slot])

  const groups = connectionGroups(slots.filter((entry) => entry.kind === 'model' && entry.providerType !== null && (routeTakesTypesafe(key) || entry.providerType !== 'decision_typesafe')))
  const lines = useUsageLines(slot, workflowNodes)
  const used = slot !== null && slotUseCount(slot, workflowNodes) > 0
  const held = slot !== null && slotHoldCount(slot) > 0
  const removal = useModelRemoval()
  const allowsEmpty = key !== null && (FOLLOWS_CHAT_KEYS.includes(key) || EMPTY_KEYS.includes(key))
  const targetId = target ? Number(target) : null

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!slot) return createModelRoute({ name: name.trim(), targetSlotId: targetId, contentRatingTierId: ratingTierId })
      return updateModelRoute(slot.id, {
        ...(key === null ? { name: name.trim() } : { prompt }),
        targetSlotId: targetId,
        contentRatingTierId: ratingTierId,
      })
    },
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '저장했어.', en: 'Saved.' }), tone: 'info' })
      await refresh({ judgeChanged: modelAffectsJudge(slot) })
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '저장하지 못했어.', en: 'Could not save.' }), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: (replacement: ModelReplacement) => deleteModelSlot(slot?.id ?? 0, replacement),
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '지웠어.', en: 'Deleted.' }), tone: 'info' })
      await refresh({ judgeChanged: modelAffectsJudge(slot) })
      onClose()
    },
    onError: (error) => showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '지우지 못했어.', en: 'Could not delete.' }), tone: 'error' }),
  })
  const remove = async () => {
    if (!slot) return
    const replacement = await removal.choose([slot])
    if (replacement) deleteMutation.mutate(replacement)
  }
  const busy = saveMutation.isPending || deleteMutation.isPending
  const changed = slot === null
    ? name.trim() !== '' || target !== ''
    : (key === null && name.trim() !== (slot.routeName ?? '')) || targetId !== slot.targetSlotId || prompt !== slot.prompt || ratingTierId !== slot.contentRatingTierId
  const valid = (key !== null || name.trim() !== '') && (allowsEmpty || targetId !== null)
  const save = valid && changed && !busy ? () => saveMutation.mutate() : undefined
  const emptyLabel = key !== null && FOLLOWS_CHAT_KEYS.includes(key) ? t({ ko: '대화 따라감', en: 'Follows chat' }) : t({ ko: '없음', en: 'None' })

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      title={slot ? routeName(slot) : t({ ko: '대표모델 추가', en: 'Add representative model' })}
      size="md"
      dirty={changed}
      onSave={save}
    >
      <ModalBody spacing="sm">
        {key === 'judge' ? <UnconfiguredConsumersAlert slot={slot} /> : null}
        {key === null ? (
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </Field>
        ) : null}
        <Field
          label={t({ ko: '대상 모델', en: 'Target model' })}
          info={used ? t({ ko: '바꾸면 이 대표모델을 고른 곳이 모두 새 모델로 이어져.', en: 'Everything that picked this representative model moves to the new model.' }) : undefined}
        >
          <Select variant="settings" value={target} aria-label={t({ ko: '대상 모델', en: 'Target model' })} onChange={(event) => setTarget(event.target.value)}>
            {allowsEmpty || target === '' ? <option value="" disabled={!allowsEmpty}>{allowsEmpty ? emptyLabel : t({ ko: '선택', en: 'Select' })}</option> : null}
            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.rows.map((row) => <option key={row.id} value={String(row.id)} disabled={row.ready === false}>{row.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        {key !== null ? (
          <Field label={t({ ko: '기본 프롬프트', en: 'Default prompt' })} info={promptInfo[key]}>
            <Textarea variant="settings" autoGrow rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </Field>
        ) : null}
        {key !== 'judge' || (targetId !== null && slots.find((entry) => entry.id === targetId)?.providerType !== 'decision_typesafe') ? (
          <Field
            label={t({ ko: '허용 등급', en: 'Content rating' })}
            info={t({ ko: '이 대표모델로 가는 요청에 쓰는 등급이야. 비우면 대상 모델 설정을 따라. 프로필에서 따로 정하면 그쪽이 우선이야.', en: 'The ceiling for requests through this representative model; unset follows the target model. A profile’s own setting takes precedence.' })}
          >
            <ContentRatingSelect
              ariaLabel={t({ ko: '허용 등급', en: 'Content rating' })}
              value={ratingTierId === null ? 'model' : ratingTierId === ROUTE_NO_CEILING ? null : ratingTierId}
              followLabel={t({ ko: '대상 모델 따름', en: 'Follow the target model' })}
              onChange={(choice) => setRatingTierId(choice === 'model' ? null : choice === null ? ROUTE_NO_CEILING : choice)}
            />
          </Field>
        ) : null}
      </ModalBody>
      <EditorFooter
        onDelete={slot && key === null ? () => void remove() : undefined}
        deleteLabel={t({ ko: '대표모델 삭제', en: 'Delete representative model' })}
        deleteDisabled={busy}
        deleteTip={held ? <span className="whitespace-pre-line">{`${t({ ko: '쓰는 곳이 있어. 지울 때 대신 쓸 모델을 골라.', en: 'In use: deleting asks for a model to take over.' })}\n${lines.join('\n')}`}</span> : null}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={Boolean(save)}
        saving={saveMutation.isPending}
      />
      {removal.dialog}
    </Modal>
  )
}

/** The models picked for a connection in its editor, in order. */
export type ConnectionModelsDraft = { models: string[] }

/**
 * The connection editor's model checklist: what the server lists, plus the connection's saved rows and models typed in.
 * A saved row that something holds shows who; unchecking it asks for a replacement when the editor saves.
 */
export function ConnectionModelChecklist({ value, listed, saved, loading, onRefresh, onChange }: {
  value: ConnectionModelsDraft
  /** Model ids the server lists. */
  listed: string[]
  /** The connection's saved rows (empty for a new connection). */
  saved: ModelSlot[]
  loading: boolean
  onRefresh: () => void
  onChange: (next: ConnectionModelsDraft) => void
}) {
  const { t } = useI18n()
  const describe = useDescribeUse()
  const [typed, setTyped] = useState('')
  const all = [...new Set([...saved.map((slot) => slot.model), ...value.models, ...listed])]
  const toggle = (model: string, checked: boolean) => {
    onChange({ models: checked ? [...value.models, model].sort((a, b) => all.indexOf(a) - all.indexOf(b)) : value.models.filter((entry) => entry !== model) })
  }
  const add = () => {
    const model = typed.trim()
    if (!model) return
    if (!value.models.includes(model)) onChange({ models: [...value.models, model] })
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
        const holds = row ? slotHoldCount(row) : 0
        const checked = value.models.includes(model)
        const id = `connection-model-${model}`
        return (
          <ListRow
            key={model}
            size="sm"
            leading={<Checkbox id={id} checked={checked} onCheckedChange={(next) => toggle(model, next === true)} />}
            trailing={row && holds > 0 ? (
              <Tip content={<span className="whitespace-pre-line">{`${t({ ko: '쓰는 곳이 있어. 빼면 저장할 때 대신 쓸 모델을 골라.', en: 'In use: unchecking asks for a model to take over on save.' })}\n${describe(row, 0, true).join('\n')}`}</span>}>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"><Link2 className="size-3" aria-hidden />{holds}</span>
              </Tip>
            ) : null}
          >
            <label htmlFor={id} className={cn('min-w-0 flex-1 cursor-pointer truncate font-mono text-xs', !checked && 'text-muted-foreground')}>{model}</label>
          </ListRow>
        )
      })}
      <div className="flex items-center gap-2 pt-2">
        <Input
          variant="settings"
          mono={Boolean(typed)}
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
