import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Circle, CircleCheck, CircleDot, CircleMinus, CircleStop, Pause, Play, Users } from 'lucide-react'
import { CHAT_TASK_DEFAULT_BUDGET, CHAT_TASK_LIMITS, type ChatProposal, type ChatRoutineRouting, type ChatTask, type ChatTaskAssignee, type ChatTaskRouting, type ChatTaskStep, type ChatTaskSummary } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { approveChatTaskPlan, CHAT_PROFILES_QUERY_KEY, chatTaskQueryKey, dismissChatProposal, getChatTask, listChatProfiles, setChatTaskState } from '@/lib/api-codex-chat'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ProposalFooter, ProposalFrame } from './chat-proposal-parts'
import { codexChatThreadQueryKey } from './codex-chat-context'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'

type PlanProposal = Extract<ChatProposal, { kind: 'task_plan' }>
const LIVE = new Set<ChatTask['status']>(['running', 'waiting', 'paused'])

/**
 * The chat's newest task, refreshed when the server announces a change; polled every few seconds while it is live only
 * when the event stream is down. The shared runtime bridge owns event refreshes.
 */
export function useChatTask(threadId: number | null) {
  const { status: streamStatus } = useRuntimeEventStream()
  return useQuery({
    queryKey: chatTaskQueryKey(threadId),
    queryFn: () => getChatTask(threadId as number),
    enabled: threadId !== null,
    refetchInterval: (query) => resolveStreamFallbackInterval(streamStatus, query.state.data && LIVE.has(query.state.data.status) ? 5000 : false),
  })
}

function StepIcon({ status, current }: { status: ChatTaskStep['status']; current: boolean }) {
  if (status === 'done') return <CircleCheck className="size-3.5 shrink-0 text-success" />
  if (status === 'skipped') return <CircleMinus className="size-3.5 shrink-0 text-muted-foreground" />
  if (current) return <CircleDot className="size-3.5 shrink-0 text-primary" />
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/60" />
}

function useWaitLabel() {
  const { t } = useI18n()
  return (task: Pick<ChatTask, 'status' | 'wait'>) => {
    if (task.status === 'paused') return t({ ko: '멈춤', en: 'Paused' })
    if (task.status === 'running') return t({ ko: '진행 중', en: 'Running' })
    if (task.status === 'done') return t({ ko: '완료', en: 'Done' })
    if (task.status === 'failed') return t({ ko: '실패', en: 'Failed' })
    if (task.status === 'cancelled') return t({ ko: '중단됨', en: 'Stopped' })
    return task.wait === 'approval' ? t({ ko: '승인 대기', en: 'Waiting for approval' })
      : task.wait === 'job' ? t({ ko: '생성 대기', en: 'Waiting for generation' })
        : task.wait === 'page' ? t({ ko: '페이지 대기', en: 'Waiting for the page' })
          : t({ ko: '답 대기', en: 'Waiting for you' })
  }
}

function StateChip({ task }: { task: ChatTask }) {
  const label = useWaitLabel()(task)
  const tone = task.status === 'running' ? 'primary' : task.status === 'waiting' || task.status === 'paused' ? 'warning' : 'muted'
  const chip = <Chip size="sm" tone={tone}><span className="font-semibold">{label}</span></Chip>
  return task.reason ? <Tip content={task.reason}>{chip}</Tip> : chip
}

/** Group rooms: who does a step — one member (avatar and name) or everyone. */
function Assignee({ assignee, compact }: { assignee: ChatTaskAssignee; compact?: boolean }) {
  const { t } = useI18n()
  const profiles = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 })
  if (assignee === 'all') {
    const label = t({ ko: '모두', en: 'Everyone' })
    return compact
      ? <Tip content={label}><Users className="size-3.5 shrink-0 text-muted-foreground" aria-label={label} /></Tip>
      : <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" />{label}</span>
  }
  const profile = profiles.data?.find((entry) => entry.id === assignee)
  if (!profile) return compact ? null : <span />
  const avatar = <ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="xs" />
  return compact
    ? <Tip content={profile.name}>{avatar}</Tip>
    : <span className="inline-flex min-w-0 max-w-28 shrink-0 items-center gap-1 text-xs text-muted-foreground">{avatar}<span className="truncate">{profile.name}</span></span>
}

const currentStep = (steps: ChatTaskStep[]) => {
  const doing = steps.findIndex((step) => step.status === 'doing')
  return doing >= 0 ? doing : steps.findIndex((step) => step.status === 'todo')
}

function StepList({ steps, current, task }: { steps: Array<{ title: string; status: ChatTaskStep['status']; approval?: boolean; note?: string; assignee?: ChatTaskAssignee }>; current: number; task?: ChatTask }) {
  const { t } = useI18n()
  const assigned = steps.some((step) => step.assignee !== undefined)
  return (
    <ol className="space-y-0.5">
      {steps.map((step, index) => (
        <li key={index} className={cn('grid items-center gap-2 py-0.5 text-sm', assigned ? 'grid-cols-[1rem_minmax(0,1fr)_auto_auto]' : 'grid-cols-[1rem_minmax(0,1fr)_auto]', step.status === 'done' && 'text-muted-foreground', index === current && 'font-semibold')}>
          <StepIcon status={step.status} current={index === current} />
          <span className="min-w-0 truncate" title={step.note}>{step.title}</span>
          {index === current && task && task.status !== 'running' ? <StateChip task={task} /> : step.approval && step.status === 'todo' ? <Chip size="sm" tone="warning"><span className="font-semibold">{t({ ko: '승인', en: 'Approval' })}</span></Chip> : <span />}
          {assigned ? step.assignee !== undefined ? <Assignee assignee={step.assignee} /> : <span /> : null}
        </li>
      ))}
    </ol>
  )
}

/** The plan card: the goal, the steps (those that end in a card are marked) and the budget. Approving starts it. */
export function TaskPlanCard({ proposal, threadId }: { proposal: PlanProposal; threadId?: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [state, setState] = useState<'open' | 'approved' | 'dismissed'>(proposal.savedId !== undefined && proposal.savedId !== null ? 'approved' : proposal.dismissed ? 'dismissed' : 'open')
  const refresh = async () => {
    if (threadId === undefined) return
    await Promise.all([queryClient.invalidateQueries({ queryKey: chatTaskQueryKey(threadId) }), queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })])
  }
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '처리하지 못했어.', en: 'Could not do that.' })), tone: 'error' })
  const approve = useMutation({ mutationFn: () => approveChatTaskPlan(proposal.id), onSuccess: async () => { setState('approved'); await refresh() }, onError })
  const dismiss = useMutation({ mutationFn: () => dismissChatProposal(proposal.id), onSuccess: async () => { setState('dismissed'); await refresh() }, onError })
  const busy = approve.isPending || dismiss.isPending
  const [unfolded, setUnfolded] = useState(false)
  // A decided plan folds to one line; the live steps are on the bar above the composer.
  if (state !== 'open' && !unfolded) return (
    <DisclosureButton open={false} onClick={() => setUnfolded(true)}>
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <span className="shrink-0 font-semibold">{t({ ko: '작업 플랜', en: 'Task plan' })}</span>
        <span className="min-w-0 truncate">{proposal.goal}</span>
        <span className="shrink-0">· {t({ ko: '{count}단계', en: '{count} steps' }, { count: proposal.steps.length })} · {state === 'approved' ? t({ ko: '승인됨', en: 'Approved' }) : t({ ko: '무시함', en: 'Dismissed' })}</span>
      </span>
    </DisclosureButton>
  )
  return (
    <ProposalFrame>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{t({ ko: '작업 플랜', en: 'Task plan' })}</span>
        <span className="min-w-0 truncate text-sm font-semibold">{proposal.goal}</span>
      </div>
      <StepList steps={proposal.steps.map((step) => ({ ...step, status: 'todo' as const }))} current={-1} />
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-2xs text-muted-foreground tabular-nums">
        <span>{t({ ko: '이어가기 ≤ {count}회', en: '≤ {count} turns' }, { count: proposal.budget.continuations })}</span>
        <span>{t({ ko: '이미지 ≤ {count}장', en: '≤ {count} images' }, { count: proposal.budget.images })}</span>
        {proposal.budget.tokens !== undefined ? <span>{t({ ko: '토큰 ≤ {count} · 턴 사이 확인', en: '≤ {count} tokens · checked between turns' }, { count: proposal.budget.tokens })}</span> : null}
      </div>
      <ProposalFooter className="justify-end">
        {state === 'open' ? (
          <>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>{t({ ko: '무시', en: 'Dismiss' })}</Button>
            <Button size="xs" disabled={busy} onClick={() => approve.mutate()}>{approve.isPending ? <Spinner className="size-3" /> : null}{t({ ko: '승인', en: 'Approve' })}</Button>
          </>
        ) : <>
          <span className="text-xs text-muted-foreground">{state === 'approved' ? t({ ko: '승인됨', en: 'Approved' }) : t({ ko: '무시함', en: 'Dismissed' })}</span>
          <IconButton size="icon-xs" variant="ghost" label={t({ ko: '접기', en: 'Fold' })} onClick={() => setUnfolded(false)}><ChevronUp /></IconButton>
        </>}
      </ProposalFooter>
    </ProposalFrame>
  )
}

/** Explicit approval of new total limits; cumulative usage is never reset by resuming. */
function TaskBudgetResume({ task, busy, onResume }: { task: ChatTask; busy: boolean; onResume: (budget: ChatTask['budget']) => void }) {
  const { t } = useI18n()
  const [budget, setBudget] = useState<ChatTask['budget']>(() => ({
    continuations: Math.min(CHAT_TASK_LIMITS.continuations, task.used.continuations >= task.budget.continuations ? task.used.continuations + CHAT_TASK_DEFAULT_BUDGET.continuations : task.budget.continuations),
    images: Math.min(CHAT_TASK_LIMITS.images, task.used.images >= task.budget.images ? task.used.images + CHAT_TASK_DEFAULT_BUDGET.images : task.budget.images),
    ...(task.budget.tokens === undefined ? {} : { tokens: Math.min(CHAT_TASK_LIMITS.tokens, Math.max(task.budget.tokens, (task.used.tokens ?? 0) + 1)) }),
  }))
  const keys: Array<keyof ChatTask['budget']> = task.budget.tokens === undefined ? ['continuations', 'images'] : ['continuations', 'images', 'tokens']
  const capped = keys.some((key) => (task.used[key] ?? 0) >= CHAT_TASK_LIMITS[key])
  const valid = keys.every((key) => Number.isSafeInteger(budget[key]) && (budget[key] ?? 0) >= (task.budget[key] ?? 0) && (budget[key] ?? 0) > (task.used[key] ?? 0) && (budget[key] ?? 0) <= CHAT_TASK_LIMITS[key])
  if (capped) return <p className="mb-2 text-xs text-muted-foreground">{t({ ko: '작업 최대 예산에 도달했어. 현재 작업을 중단한 뒤 새 플랜을 승인해줘.', en: 'This task reached its maximum budget. Stop it before approving a new plan.' })}</p>
  return (
    <form className="mb-2 flex flex-wrap items-end gap-2 border-b border-line pb-2" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) onResume(budget) }}>
      <p className="w-full text-xs text-muted-foreground">{t({ ko: '예산을 다 썼어. 지금까지 사용한 양을 포함한 새 총한도를 승인하면 이어갈게.', en: 'Budget exhausted. Approve new total limits, including usage so far, to resume.' })}</p>
      {keys.map((key) => (
        <label key={key} className="flex flex-col gap-1 text-xs">
          <span>{key === 'continuations' ? t({ ko: '이어가기 총한도', en: 'Total turns' }) : key === 'images' ? t({ ko: '이미지 총한도', en: 'Total images' }) : t({ ko: '토큰 총한도', en: 'Total tokens' })} · {t({ ko: '{count} 사용', en: '{count} used' }, { count: task.used[key] ?? 0 })}</span>
          <Input className="h-7 w-32" type="number" min={Math.max(task.budget[key] ?? 0, (task.used[key] ?? 0) + 1)} max={CHAT_TASK_LIMITS[key]} step={1} value={budget[key]} disabled={busy} onChange={(event) => setBudget((current) => ({ ...current, [key]: Number(event.target.value) }))} />
        </label>
      ))}
      <Button size="xs" type="submit" disabled={busy || !valid}>{t({ ko: '예산 승인 후 재개', en: 'Approve budget and resume' })}</Button>
    </form>
  )
}

/** The bar above the composer: current step, progress, the step list folded under it, pause/resume and stop. */
export function ChatTaskStrip({ threadId }: { threadId: number }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [stepsOpen, setStepsOpen] = useState(false)
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const task = useChatTask(threadId).data
  const change = useMutation({
    mutationFn: ({ action, extension }: { action: 'pause' | 'resume' | 'cancel'; extension?: { taskId: number; budget: ChatTask['budget'] } }) => setChatTaskState(threadId, action, extension),
    onSuccess: (next) => queryClient.setQueryData(chatTaskQueryKey(threadId), next),
    onError: (error) => {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '작업을 바꾸지 못했어.', en: 'Could not change the task.' })), tone: 'error' })
      void queryClient.invalidateQueries({ queryKey: chatTaskQueryKey(threadId) })
    },
  })
  if (!task || !LIVE.has(task.status)) return null
  const index = currentStep(task.steps)
  const done = task.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length
  const canResume = task.status === 'paused' || (task.status === 'waiting' && (task.wait === 'user' || task.wait === 'page'))
  const exhausted = task.used.continuations >= task.budget.continuations || task.used.images >= task.budget.images || (task.budget.tokens !== undefined && (task.used.tokens ?? 0) >= task.budget.tokens)
  return (
    <>
      {stepsOpen ? <div className="mb-2 border-b border-line pb-2"><StepList steps={task.steps} current={index} task={task} /></div> : null}
      <div className="mb-2 flex min-w-0 items-center gap-2.5 text-xs">
        {index >= 0 && task.steps[index].assignee !== undefined ? <Assignee assignee={task.steps[index].assignee} compact /> : null}
        <span className="min-w-0 truncate font-semibold">{index >= 0 ? task.steps[index].title : task.goal}</span>
        <StateChip task={task} />
        <span className="h-0.5 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary transition" style={{ transitionProperty: 'width', width: `${Math.round((done / Math.max(1, task.steps.length)) * 100)}%` }} /></span>
        <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{done}/{task.steps.length}</span>
        <IconButton size="icon-xs" variant="ghost" aria-expanded={stepsOpen} label={stepsOpen ? t({ ko: '단계 접기', en: 'Hide steps' }) : t({ ko: '단계 보기', en: 'Show steps' })} onClick={() => setStepsOpen((current) => !current)}>{stepsOpen ? <ChevronDown /> : <ChevronUp />}</IconButton>
        {canResume
          ? <IconButton size="icon-xs" variant="ghost" label={exhausted ? t({ ko: '예산 승인이 필요해', en: 'Budget approval required' }) : t({ ko: '재개', en: 'Resume' })} disabled={change.isPending || exhausted} onClick={() => change.mutate({ action: 'resume' })}><Play /></IconButton>
          : <IconButton size="icon-xs" variant="ghost" label={t({ ko: '일시정지', en: 'Pause' })} disabled={change.isPending || task.status !== 'running' && task.status !== 'waiting'} onClick={() => change.mutate({ action: 'pause' })}><Pause /></IconButton>}
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '중단', en: 'Stop' })} disabled={change.isPending} onClick={() => void (async () => {
          if (await confirm({ title: t({ ko: '작업 중단', en: 'Stop task' }), description: t({ ko: '이 작업을 중단할까? 남은 단계는 진행하지 않아.', en: 'Stop this task? The remaining steps will not run.' }), confirmLabel: t({ ko: '중단', en: 'Stop' }), tone: 'destructive' })) change.mutate({ action: 'cancel' })
        })()}><CircleStop /></IconButton>
      </div>
      {task.budget.tokens !== undefined ? <p className="text-2xs text-muted-foreground">{t({ ko: '토큰 {used} / {limit} · 턴 사이 확인', en: 'Tokens {used} / {limit} · checked between turns' }, { used: task.used.tokens ?? 0, limit: task.budget.tokens })}</p> : null}
      {canResume && exhausted ? <TaskBudgetResume key={`${task.id}:${task.budget.continuations}:${task.budget.images}:${task.budget.tokens}:${task.used.continuations}:${task.used.images}:${task.used.tokens}`} task={task} busy={change.isPending} onResume={(budget) => change.mutate({ action: 'resume', extension: { taskId: task.id, budget } })} /> : null}
    </>
  )
}

/** A request the server sent to move a task on: one thin line in place of a user message. */
/** Chat list rows: how far the chat's unfinished task is (done steps around a ring); the tooltip names the step and state. */
export function ChatTaskRing({ summary }: { summary: ChatTaskSummary }) {
  const { t } = useI18n()
  const state = useWaitLabel()(summary)
  const circumference = 2 * Math.PI * 9
  const filled = summary.total ? (summary.done / summary.total) * circumference : 0
  const tone = summary.status === 'running' ? 'text-primary' : summary.status === 'waiting' ? 'text-warning' : 'text-muted-foreground'
  const label = [t({ ko: '작업 {done}/{total}', en: 'Task {done}/{total}' }, { done: summary.done, total: summary.total }), summary.step, state].filter(Boolean).join(' · ')
  return (
    <Tip content={label}>
      <svg role="img" aria-label={label} viewBox="0 0 24 24" className={cn('size-3.5 shrink-0', tone)}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={3} strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 12 12)" />
      </svg>
    </Tip>
  )
}

export function ChatTaskEventLine({ routing }: { routing: ChatTaskRouting }) {
  const { t } = useI18n()
  const line = (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-line" />
      <span className="min-w-0 truncate">
        {t({ ko: '작업 이어가기', en: 'Task continues' })}
        {routing.step !== null ? <span className="font-mono tabular-nums"> · {routing.step}/{routing.total}</span> : null}
        {routing.title ? ` · ${routing.title}` : ''}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
  return routing.event ? <Tip content={routing.event}>{line}</Tip> : line
}

/** The instruction an automation sent, without the frame the app adds for the model (everything up to the first blank line). */
function routineInstruction(text: string) {
  const start = text.indexOf('\n\n')
  return (start >= 0 ? text.slice(start + 2) : text).trim()
}

/**
 * The thin line's label per wake source (anything else: workflow). Keyed by string: `agent_result` (an agent's result
 * arriving in the caller room) is not in the shared source union yet.
 */
const ROUTINE_SOURCE_LABELS: Record<string, { ko: string; en: string }> = {
  routine: { ko: '루틴', en: 'Routine' }, post: { ko: '게시판', en: 'Posts' }, plugin: { ko: '플러그인', en: 'Plugin' },
  agent: { ko: '에이전트 요청', en: 'Agent request' }, agent_result: { ko: '에이전트 결과 도착', en: 'Agent result' },
}

/** A wake an automation (a routine or a workflow) sent: one thin line, the instruction on hover. */
export function ChatRoutineEventLine({ routing, text }: { routing: ChatRoutineRouting; text: string }) {
  const { t } = useI18n()
  const instruction = routineInstruction(text)
  const line = (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-line" />
      <span className="min-w-0 truncate">
        {t(ROUTINE_SOURCE_LABELS[routing.source] ?? { ko: '워크플로', en: 'Workflow' })}
        {routing.name ? ` · ${routing.name}` : ''}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
  return instruction ? <Tip content={<span className="whitespace-pre-wrap">{instruction}</span>}>{line}</Tip> : line
}
