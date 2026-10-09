import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CHAT_TASK_LIMITS, type ChatTask } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { ChatTaskStore } from '../../services/codex-chat/chatTasks'
import { proposalStatuses } from '../../services/codex-chat/chatPageContext'

const result = (value: unknown, extra: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...extra })
const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] })
const view = (task: ChatTask) => ({ id: task.id, goal: task.goal, status: task.status, wait: task.wait, reason: task.reason, steps: task.steps.map((step, index) => ({ step: index + 1, ...step })), budget: task.budget, used: task.used })

/**
 * Long tasks in a 1:1 chat: the model proposes a plan (a card the person approves), then marks steps, says what it waits
 * for and finishes. The server, not the model, starts every next turn (see ChatTaskRunner).
 */
export function registerChatTaskTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.kind !== 'direct') return
  const live = () => {
    const task = ChatTaskStore.live(chat.threadId)
    if (!task) throw new Error('진행 중인 작업이 없어. task_propose로 플랜부터 제안해.')
    return task
  }

  server.tool('task_propose', 'Propose a multi-step task for this chat as a plan card. Use it when the person asks for something that takes several turns (e.g. "make a new character profile with images"). Nothing runs until the person approves the card; after that the app keeps sending you the next turn automatically. Steps that end in a card the person must save get approval: true. One task per chat.', {
    goal: z.string().max(CHAT_TASK_LIMITS.goal),
    steps: z.array(z.object({ title: z.string().max(CHAT_TASK_LIMITS.stepTitle), approval: z.boolean().optional() })).min(1).max(CHAT_TASK_LIMITS.steps),
    budget: z.object({ continuations: z.number().int().positive().max(CHAT_TASK_LIMITS.continuations).optional(), images: z.number().int().positive().max(CHAT_TASK_LIMITS.images).optional() }).optional().describe('Turns and images the task may use; defaults 30 and 16.'),
  }, async ({ goal, steps, budget }) => {
    try {
      if (!chat.replyId) throw new Error('Proposals need an active chat reply.')
      const current = ChatTaskStore.live(chat.threadId)
      if (current && current.status !== 'awaiting_plan') throw new Error(`이 채팅에는 진행 중인 작업 #${current.id}이 있어. 끝내거나 사용자가 중단한 뒤에 새로 제안해.`)
      if (current) ChatTaskStore.update(current.id, { status: 'cancelled', reason: '새 플랜으로 바뀌었어.' })
      const task = ChatTaskStore.create(chat.threadId, goal, steps, budget)
      const proposal = ChatProposalStore.add(chat, { kind: 'task_plan', taskId: task.id, goal: task.goal, steps: task.steps.map(({ title, approval }) => ({ title, ...(approval ? { approval } : {}) })), budget: task.budget })
      return result({ taskId: task.id, proposalId: proposal.id, status: 'awaiting_plan', note: 'The plan card is shown; nothing runs until the person approves it. End your reply here.' }, { structuredContent: { proposal } })
    } catch (error) { return failure(error) }
  })

  server.tool('get_proposal_status', 'Read what the person did with this chat\'s review cards: saved (with the new id), dismissed, or still open. Give proposal_ids, or leave them out for the latest cards.', {
    proposal_ids: z.array(z.number().int().positive()).max(20).optional(),
  }, async ({ proposal_ids }) => {
    try { return result({ proposals: proposalStatuses(chat.threadId, proposal_ids) }) } catch (error) { return failure(error) }
  })

  server.tool('task_status', 'Read this chat\'s current task: goal, steps with status, what it waits for, budget used.', {}, async () => {
    try { return result(view(live())) } catch (error) { return failure(error) }
  })

  server.tool('task_update', 'Mark one step of the current task: doing, done or skipped, with a short note.', {
    step: z.number().int().positive(), status: z.enum(['doing', 'done', 'skipped']), note: z.string().max(CHAT_TASK_LIMITS.note).optional(),
  }, async ({ step, status, note }) => {
    try {
      const task = live()
      if (task.status === 'awaiting_plan') throw new Error('플랜이 아직 승인되지 않았어.')
      if (step > task.steps.length) throw new Error(`단계는 1~${task.steps.length}야.`)
      const steps = task.steps.map((entry, index) => index === step - 1 ? { ...entry, status, ...(note ? { note } : {}) } : status === 'doing' && entry.status === 'doing' ? { ...entry, status: 'todo' as const } : entry)
      return result(view(ChatTaskStore.update(task.id, { steps })!))
    } catch (error) { return failure(error) }
  })

  server.tool('task_wait', 'Pause the current task until something outside your reply happens: approval (a card you made must be saved), job (generation still running), page (the person must reopen or reconnect the page), user (you need the person\'s answer). The app resumes you when it happens (user: when the person answers in the chat; page: when the person sends with the page connected, or resumes). Call it, then end your reply.', {
    for: z.enum(['approval', 'job', 'page', 'user']), reason: z.string().max(CHAT_TASK_LIMITS.note),
  }, async ({ for: wait, reason }) => {
    try {
      const task = live()
      if (task.status === 'awaiting_plan') throw new Error('플랜이 아직 승인되지 않았어.')
      return result(view(ChatTaskStore.update(task.id, { status: 'waiting', wait, reason })!))
    } catch (error) { return failure(error) }
  })

  server.tool('task_finish', 'End the current task: done when every step is finished, failed when it cannot be completed. Give a one-line summary.', {
    outcome: z.enum(['done', 'failed']), summary: z.string().max(CHAT_TASK_LIMITS.note),
  }, async ({ outcome, summary }) => {
    try {
      const task = live()
      return result(view(ChatTaskStore.update(task.id, { status: outcome, reason: summary })!))
    } catch (error) { return failure(error) }
  })
}
