import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CHAT_TASK_LIMITS, resolveMemberName, type ChatTask, type ChatTaskAssignee } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { ChatTaskStore } from '../../services/codex-chat/chatTasks'
import { proposalStatuses } from '../../services/codex-chat/chatPageContext'
import { placesForRequest } from '../../services/codex-chat/chatLinkedFiles'
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles'
import { CodexChatStore } from '../../services/codex-chat/codexChatStore'
import { ChatGroupStore } from '../../services/codex-chat/chatGroupStore'

const result = (value: unknown, extra: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...extra })
const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] })
type Member = { id: number; name: string }
/** A step's assignee by name for the model (`all`: every member). */
const assigneeName = (assignee: ChatTaskAssignee, members: Member[]) => assignee === 'all' ? 'all' : members.find((member) => member.id === assignee)?.name ?? `#${assignee}`
const view = (task: ChatTask, members: Member[] = []) => ({
  id: task.id, goal: task.goal, status: task.status, wait: task.wait, reason: task.reason,
  steps: task.steps.map(({ assignee, heard: _heard, ...step }, index) => ({ step: index + 1, ...step, ...(assignee !== undefined ? { assignee: assigneeName(assignee, members) } : {}) })),
  budget: task.budget, used: task.used,
})

/** `all`, `모두` and `everyone` mean every member; any other name must be one of the room's members. */
function resolveAssignee(name: string | undefined, members: Member[], self: number): ChatTaskAssignee {
  const wanted = name?.trim()
  if (!wanted) return self
  if (['all', 'everyone', '모두', '@모두', '@all'].includes(wanted.toLowerCase())) return 'all'
  const id = resolveMemberName(wanted, members)
  if (id === null) throw new Error(`Unknown member "${wanted}". Members: ${members.map((member) => member.name).join(', ')}, or "all".`)
  return id
}

/** Whether the chat has a linked folder or file marked 쓰기 (documents are work a plan can be for). */
function writesLinkedFiles(context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat || chat.page) return false
  try {
    const thread = CodexChatStore.findThread(chat.threadId, context.requester?.accountId ?? null)
    return thread ? placesForRequest({ thread, profile: ChatProfileStore.find(chat.profileId) }).some((place) => place.write) : false
  } catch { return false }
}

/**
 * Long tasks in a chat or a group room: the model proposes a plan (a card the person approves), then marks steps, says
 * what it waits for and finishes. The server, not the model, starts every next turn (see ChatTaskRunner); in a room
 * each step names the member it wakes, or every member in turn.
 */
export function registerChatTaskTools(server: McpServer, context: McpRequestContext) {
  const chat = context.chatContext
  if (!chat) return
  const group = chat.kind === 'group'
  // A profile with nothing to work with (no scopes, no page, no generation presets, no linked place it may write) has
  // no use for a plan; its tools would only cost every request and break models that cannot take tools. A task already
  // running keeps them.
  if (context.scopes.length === 0 && !chat.page && !context.generationPresetIds?.length && !writesLinkedFiles(context) && !ChatTaskStore.live(chat.threadId)) return
  const live = () => {
    const task = ChatTaskStore.live(chat.threadId)
    if (!task) throw new Error('진행 중인 작업이 없어. task_propose로 플랜부터 제안해.')
    return task
  }
  const members = (): Member[] => group ? ChatGroupStore.members(chat.threadId).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? []) : []
  const stepInput = group
    ? z.object({ title: z.string().max(CHAT_TASK_LIMITS.stepTitle), approval: z.boolean().optional(), assignee: z.string().max(80).optional().describe('Who does this step: a member\'s name, or "all" (every member once, in room order). Default: you.') })
    : z.object({ title: z.string().max(CHAT_TASK_LIMITS.stepTitle), approval: z.boolean().optional() })
  const proposeDescription = group
    ? 'Propose a multi-step task for this room as a plan card, each step with the member who does it. Use it when the person asks for work that takes several turns (e.g. "plan the autumn event and draft the plan document in the linked folder"). Nothing runs until the person approves the card; after that the app wakes each step\'s member in turn (an "all" step wakes every member once, in room order). Steps that end in a card the person must save get approval: true. One task per room.'
    : 'Propose a multi-step task for this chat as a plan card. Use it when the person asks for something that takes several turns (e.g. "make a new character profile with images", "draft a plan document in the linked folder"). Nothing runs until the person approves the card; after that the app keeps sending you the next turn automatically. Steps that end in a card the person must save get approval: true. One task per chat.'

  server.registerTool('task_propose', { description: proposeDescription, inputSchema: z.object({
    goal: z.string().max(CHAT_TASK_LIMITS.goal),
    steps: z.array(stepInput).min(1).max(CHAT_TASK_LIMITS.steps),
    budget: z.object({ continuations: z.number().int().positive().max(CHAT_TASK_LIMITS.continuations).optional(), images: z.number().int().positive().max(CHAT_TASK_LIMITS.images).optional() }).optional().describe('Turns and images the task may use; defaults 30 and 16.'),
  }) }, async ({ goal, steps, budget }) => {
    try {
      if (!chat.replyId) throw new Error('Proposals need an active chat reply.')
      const current = ChatTaskStore.live(chat.threadId)
      if (current && current.status !== 'awaiting_plan') throw new Error(`이 채팅에는 진행 중인 작업 #${current.id}이 있어. 끝내거나 사용자가 중단한 뒤에 새로 제안해.`)
      const roster = members()
      const planned = steps.map((entry) => ({ title: entry.title, approval: entry.approval, ...(group ? { assignee: resolveAssignee((entry as { assignee?: string }).assignee, roster, chat.profileId) } : {}) }))
      if (current) ChatTaskStore.update(current.id, { status: 'cancelled', reason: '새 플랜으로 바뀌었어.' })
      const task = ChatTaskStore.create(chat.threadId, goal, planned, budget)
      const proposal = ChatProposalStore.add(chat, { kind: 'task_plan', taskId: task.id, goal: task.goal, steps: task.steps.map(({ title, approval, assignee }) => ({ title, ...(approval ? { approval } : {}), ...(assignee !== undefined ? { assignee } : {}) })), budget: task.budget })
      return result({ taskId: task.id, proposalId: proposal.id, status: 'awaiting_plan', note: 'The plan card is shown; nothing runs until the person approves it. End your reply here.' }, { structuredContent: { proposal } })
    } catch (error) { return failure(error) }
  })

  server.registerTool('get_proposal_status', { description: 'Read what the person did with this chat\'s review cards: saved (with the new id), dismissed, or still open. Give proposal_ids, or leave them out for the latest cards.', inputSchema: z.object({
    proposal_ids: z.array(z.number().int().positive()).max(20).optional(),
  }) }, async ({ proposal_ids }) => {
    try { return result({ proposals: proposalStatuses(chat.threadId, proposal_ids) }) } catch (error) { return failure(error) }
  })

  server.registerTool('task_status', { description: 'Read this chat\'s current task: goal, steps with status, what it waits for, budget used.', inputSchema: z.object({}) }, async () => {
    try { return result(view(live(), members())) } catch (error) { return failure(error) }
  })

  server.registerTool('task_update', { description: 'Mark one step of the current task: doing, done or skipped, with a short note.', inputSchema: z.object({
    step: z.number().int().positive(), status: z.enum(['doing', 'done', 'skipped']), note: z.string().max(CHAT_TASK_LIMITS.note).optional(),
  }) }, async ({ step, status, note }) => {
    try {
      const task = live()
      if (task.status === 'awaiting_plan') throw new Error('플랜이 아직 승인되지 않았어.')
      if (step > task.steps.length) throw new Error(`단계는 1~${task.steps.length}야.`)
      const steps = task.steps.map((entry, index) => index === step - 1 ? { ...entry, status, ...(note ? { note } : {}) } : status === 'doing' && entry.status === 'doing' ? { ...entry, status: 'todo' as const } : entry)
      return result(view(ChatTaskStore.update(task.id, { steps })!, members()))
    } catch (error) { return failure(error) }
  })

  server.registerTool('task_wait', { description: 'Pause the current task until something outside your reply happens: approval (a card you made must be saved), job (generation still running), page (the person must reopen or reconnect the page), user (you need the person\'s answer). The app resumes you when it happens (user: when the person answers in the chat; page: when the person sends with the page connected, or resumes). Call it, then end your reply.', inputSchema: z.object({
    // A room has no page connection to wait for.
    for: group ? z.enum(['approval', 'job', 'user']) : z.enum(['approval', 'job', 'page', 'user']), reason: z.string().max(CHAT_TASK_LIMITS.note),
  }) }, async ({ for: wait, reason }) => {
    try {
      const task = live()
      if (task.status === 'awaiting_plan') throw new Error('플랜이 아직 승인되지 않았어.')
      return result(view(ChatTaskStore.update(task.id, { status: 'waiting', wait, reason })!, members()))
    } catch (error) { return failure(error) }
  })

  server.registerTool('task_finish', { description: 'End the current task: done when every step is finished, failed when it cannot be completed. Give a one-line summary.', inputSchema: z.object({
    outcome: z.enum(['done', 'failed']), summary: z.string().max(CHAT_TASK_LIMITS.note),
  }) }, async ({ outcome, summary }) => {
    try {
      const task = live()
      return result(view(ChatTaskStore.update(task.id, { status: outcome, reason: summary })!, members()))
    } catch (error) { return failure(error) }
  })
}
