/**
 * A goal the chat works through over several turns: a plan the person approves once, then steps the server keeps
 * moving (approvals, finished jobs and finished replies each start the next turn) until done, paused or out of budget.
 */
export type ChatTaskStepStatus = 'todo' | 'doing' | 'done' | 'skipped'
export type ChatTaskStep = { title: string; status: ChatTaskStepStatus; /** The step ends in a card the person saves. */ approval?: boolean; note?: string }
export type ChatTaskStatus = 'awaiting_plan' | 'running' | 'waiting' | 'paused' | 'done' | 'failed' | 'cancelled'
/** What a waiting task waits for. */
export type ChatTaskWait = 'approval' | 'job' | 'page' | 'user'
export type ChatTaskBudget = { continuations: number; images: number }

export type ChatTask = {
  id: number
  threadId: number
  goal: string
  steps: ChatTaskStep[]
  status: ChatTaskStatus
  wait: ChatTaskWait | null
  /** Why it waits, paused or ended, in the person's words. */
  reason: string | null
  budget: ChatTaskBudget
  used: ChatTaskBudget
  createdAt: string
  updatedAt: string
}

export const CHAT_TASK_DEFAULT_BUDGET: ChatTaskBudget = { continuations: 30, images: 16 }
export const CHAT_TASK_LIMITS = { steps: 12, stepTitle: 120, goal: 300, note: 300, continuations: 100, images: 64 } as const

/** The plan card: approving it starts the task. */
export type ChatTaskPlanProposal = {
  kind: 'task_plan'
  taskId: number
  goal: string
  steps: Array<{ title: string; approval?: boolean }>
  budget: ChatTaskBudget
  savedId?: number | null
}

/** What a chat list row shows of the chat's unfinished task. */
export type ChatTaskSummary = { status: ChatTaskStatus; wait: ChatTaskWait | null; done: number; total: number; step: string | null }

/** Marks a request the server sent to move a task on; shown as one thin line instead of a user message. */
export type ChatTaskRouting = { id: number; step: number | null; total: number; title: string | null; event: string }
