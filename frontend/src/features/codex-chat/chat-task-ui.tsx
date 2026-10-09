import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle, CircleCheck, CircleDot, CircleMinus, Pause, Play, Square } from 'lucide-react'
import type { ChatProposal, ChatRoutineRouting, ChatTask, ChatTaskRouting, ChatTaskStep, ChatTaskSummary } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { approveChatTaskPlan, chatTaskQueryKey, dismissChatProposal, getChatTask, setChatTaskState } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'
import { getErrorMessage } from '@/lib/error-message'
import { createRuntimeEventStream } from '@/lib/runtime-event-stream'
import { cn } from '@/lib/utils'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'

type PlanProposal = Extract<ChatProposal, { kind: 'task_plan' }>
const LIVE = new Set<ChatTask['status']>(['running', 'waiting', 'paused'])

/**
 * The chat's newest task, refreshed when the server announces a change; polled every few seconds while it is live only
 * when the event stream is down. Several parts of one screen use it, so a refresh already on its way is joined, not
 * cancelled and sent again.
 */
export function useChatTask(threadId: number | null) {
  const queryClient = useQueryClient()
  const { status: streamStatus } = useRuntimeEventStream()
  useEffect(() => {
    return createRuntimeEventStream({
      onEnvelope: (envelope) => {
        if (envelope.name !== 'chat.task.updated') return
        // Every task change moves the progress ring of its chat in the list.
        void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }, { cancelRefetch: false })
        if ((envelope.payload as { threadId?: number })?.threadId !== threadId) return
        void queryClient.invalidateQueries({ queryKey: chatTaskQueryKey(threadId) }, { cancelRefetch: false })
        void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) }, { cancelRefetch: false })
      },
      onStatusChange: () => {}, onResync: () => {}, onSessionExpired: () => {},
    })
  }, [queryClient, threadId])
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
  const tone = task.status === 'running' ? 'bg-primary/15 text-primary' : task.status === 'waiting' || task.status === 'paused' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
  const chip = <span className={cn('shrink-0 rounded-full px-2 py-px text-2xs font-semibold', tone)}>{label}</span>
  return task.reason ? <Tip content={task.reason}>{chip}</Tip> : chip
}

const currentStep = (steps: ChatTaskStep[]) => {
  const doing = steps.findIndex((step) => step.status === 'doing')
  return doing >= 0 ? doing : steps.findIndex((step) => step.status === 'todo')
}

function StepList({ steps, current, task }: { steps: Array<{ title: string; status: ChatTaskStep['status']; approval?: boolean; note?: string }>; current: number; task?: ChatTask }) {
  const { t } = useI18n()
  return (
    <ol className="space-y-0.5">
      {steps.map((step, index) => (
        <li key={index} className={cn('grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 py-0.5 text-sm', step.status === 'done' && 'text-muted-foreground', index === current && 'font-semibold')}>
          <StepIcon status={step.status} current={index === current} />
          <span className="min-w-0 truncate" title={step.note}>{step.title}</span>
          {index === current && task && task.status !== 'running' ? <StateChip task={task} /> : step.approval && step.status === 'todo' ? <span className="rounded-full bg-warning/15 px-2 py-px text-2xs font-semibold text-warning">{t({ ko: '승인', en: 'Approval' })}</span> : <span />}
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
  return (
    <div className="space-y-2.5 rounded-md border border-line px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{t({ ko: '작업 플랜', en: 'Task plan' })}</span>
        <span className="min-w-0 truncate text-sm font-semibold">{proposal.goal}</span>
      </div>
      <StepList steps={proposal.steps.map((step) => ({ ...step, status: 'todo' as const }))} current={-1} />
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-2xs text-muted-foreground tabular-nums">
        <span>{t({ ko: '이어가기 ≤ {count}회', en: '≤ {count} turns' }, { count: proposal.budget.continuations })}</span>
        <span>{t({ ko: '이미지 ≤ {count}장', en: '≤ {count} images' }, { count: proposal.budget.images })}</span>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
        {state === 'open' ? (
          <>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>{t({ ko: '무시', en: 'Dismiss' })}</Button>
            <Button size="xs" disabled={busy} onClick={() => approve.mutate()}>{approve.isPending ? <Spinner className="size-3" /> : null}{t({ ko: '승인', en: 'Approve' })}</Button>
          </>
        ) : <span className="text-xs text-muted-foreground">{state === 'approved' ? t({ ko: '승인됨', en: 'Approved' }) : t({ ko: '무시함', en: 'Dismissed' })}</span>}
      </div>
    </div>
  )
}

/** The live checklist under the latest reply while a task is under way. */
export function ChatTaskChecklist({ threadId }: { threadId: number }) {
  const task = useChatTask(threadId).data
  if (!task || !LIVE.has(task.status)) return null
  return (
    <div className="ml-10 max-w-xl border-t border-line pt-2">
      <StepList steps={task.steps} current={currentStep(task.steps)} task={task} />
    </div>
  )
}

/** The bar above the composer: current step, progress, pause/resume and stop. */
export function ChatTaskStrip({ threadId }: { threadId: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const task = useChatTask(threadId).data
  const change = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') => setChatTaskState(threadId, action),
    onSuccess: (next) => queryClient.setQueryData(chatTaskQueryKey(threadId), next),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '작업을 바꾸지 못했어.', en: 'Could not change the task.' })), tone: 'error' }),
  })
  if (!task || !LIVE.has(task.status)) return null
  const index = currentStep(task.steps)
  const done = task.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length
  const canResume = task.status === 'paused' || (task.status === 'waiting' && (task.wait === 'user' || task.wait === 'page'))
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2.5 text-xs">
      <span className="min-w-0 truncate font-semibold">{index >= 0 ? task.steps[index].title : task.goal}</span>
      <StateChip task={task} />
      <span className="h-0.5 min-w-10 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round((done / Math.max(1, task.steps.length)) * 100)}%` }} /></span>
      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{done}/{task.steps.length}</span>
      {canResume
        ? <IconButton size="icon-xs" variant="ghost" label={t({ ko: '이어가기', en: 'Resume' })} disabled={change.isPending} onClick={() => change.mutate('resume')}><Play /></IconButton>
        : <IconButton size="icon-xs" variant="ghost" label={t({ ko: '일시정지', en: 'Pause' })} disabled={change.isPending || task.status !== 'running' && task.status !== 'waiting'} onClick={() => change.mutate('pause')}><Pause /></IconButton>}
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '중단', en: 'Stop' })} disabled={change.isPending} onClick={() => change.mutate('cancel')}><Square /></IconButton>
    </div>
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

/** A wake an automation (a routine or a workflow) sent: one thin line, the instruction on hover. */
export function ChatRoutineEventLine({ routing, text }: { routing: ChatRoutineRouting; text: string }) {
  const { t } = useI18n()
  const instruction = routineInstruction(text)
  const line = (
    <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-line" />
      <span className="min-w-0 truncate">
        {routing.source === 'routine' ? t({ ko: '루틴', en: 'Routine' }) : t({ ko: '워크플로', en: 'Workflow' })}
        {routing.name ? ` · ${routing.name}` : ''}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
  return instruction ? <Tip content={<span className="whitespace-pre-wrap">{instruction}</span>}>{line}</Tip> : line
}
