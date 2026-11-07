import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { CHAT_TASK_LIMITS, resolveMemberName, type ChatTask, type ChatTaskAssignee } from '@conai/shared'
import type { McpRequestContext } from '../context'
import { ChatProposalStore } from '../../services/codex-chat/chatProposals'
import { ChatTaskRunner, ChatTaskStore } from '../../services/codex-chat/chatTasks'
import { proposalStatuses } from '../../services/codex-chat/chatPageContext'
import { placesForRequest } from '../../services/codex-chat/chatLinkedFiles'
import { ChatProfileStore } from '../../services/codex-chat/chatProfiles'
import { CodexChatStore } from '../../services/codex-chat/codexChatStore'
import { ChatGroupStore } from '../../services/codex-chat/chatGroupStore'
import { errorResult as failure, textResult as result } from '../toolResults'
import { isPluginProfileRun } from '../../services/plugins/pluginServerTools'
import { resolveChatAccess, resolveChatProfileToolGrant } from '../../services/codex-chat/codexChatAccess'

type Member = { id: number; name: string }
/** A step's assignee by name for the model (`all`: every member). */
const assigneeName = (assignee: ChatTaskAssignee, members: Member[]) => assignee === 'all' ? 'all' : members.find((member) => member.id === assignee)?.name ?? `#${assignee}`
const view = (task: ChatTask, members: Member[] = []) => ({
  id: task.id, goal: task.goal, status: task.status, wait: task.wait, waitIds: task.waitIds ?? [], reason: task.reason,
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
  const profile = isPluginProfileRun(chat.threadId) ? ChatProfileStore.find(chat.profileId) : null
  const scopes = profile && context.requester ? resolveChatProfileToolGrant(profile, resolveChatAccess(context.requester.accountId)).scopes : context.scopes
  if (scopes.length === 0 && !chat.page && !context.generationPresetIds?.length && !writesLinkedFiles(context) && !ChatTaskStore.live(chat.threadId)) return
  const live = () => {
    const task = ChatTaskStore.live(chat.threadId)
    if (!task) throw new Error('진행 중인 작업이 없어. task_propose로 플랜부터 제안해.')
    return task
  }
  const members = (): Member[] => group ? ChatGroupStore.members(chat.threadId).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? []) : []
  const stepInput = group
    ? z.object({ title: z.string().max(CHAT_TASK_LIMITS.stepTitle), approval: z.boolean().optional().describe('True if this step ends in a card the person must save.'), assignee: z.string().max(80).optional().describe('Who does this step: a member\'s name, or "all" (every member once, in room order). Default: you.') })
    : z.object({ title: z.string().max(CHAT_TASK_LIMITS.stepTitle), approval: z.boolean().optional().describe('True if this step ends in a card the person must save.') })
  const proposeDescription = group
    ? 'Return a plan card for requested multi-turn work; end your reply. Only approval starts it; the app then wakes assigned members in order. One task per room: finish or have the user stop an existing task before proposing another.'
    : 'Return a plan card for requested multi-turn work; end your reply. Only approval starts it; the app then sends turns automatically. One task per chat: finish or have the user stop an existing task before proposing another.'

  server.registerTool('task_propose', { description: proposeDescription, inputSchema: z.object({
    goal: z.string().max(CHAT_TASK_LIMITS.goal),
    steps: z.array(stepInput).min(1).max(CHAT_TASK_LIMITS.steps),
    budget: z.object({ continuations: z.number().int().positive().max(CHAT_TASK_LIMITS.continuations).optional(), images: z.number().int().positive().max(CHAT_TASK_LIMITS.images).optional(), tokens: z.number().int().positive().max(CHAT_TASK_LIMITS.tokens).optional() }).optional().describe('Turns and images default to 30 and 16. Optional tokens caps cumulative input + output (including auxiliary calls), checked between automatic turns, not a hard billing cap.'),
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

  server.registerTool('get_proposal_status', { description: 'Read this chat\'s review-card outcomes: saved (with new id), dismissed or still open. For an ongoing task waiting on approval, use task_wait rather than polling.', inputSchema: z.object({
    proposal_ids: z.array(z.number().int().positive()).max(20).optional().describe('Specific cards; omit for the latest cards.'),
  }) }, async ({ proposal_ids }) => {
    try { return result({ proposals: proposalStatuses(chat.threadId, proposal_ids) }) } catch (error) { return failure(error) }
  })

  // API LLM chats get the tool list with every request: the step tools come only once a plan is approved (the next
  // request after the approval lists them). Codex and Claude sessions list tools once per session, so they keep all.
  const running = ChatTaskStore.live(chat.threadId)
  if (context.source === 'llm-chat' && (!running || running.status === 'awaiting_plan')) return

  server.registerTool('task_status', { description: 'Read this chat\'s current task: goal, steps with status, what it waits for, budget used.', inputSchema: z.object({}) }, async () => {
    try { return result(view(live(), members())) } catch (error) { return failure(error) }
  })

  server.registerTool('task_update', { description: 'Update a current task step; returns task state. If the step is invalid or task inactive, inspect task_status before correcting.', inputSchema: z.object({
    step: z.number().int().positive().describe('One-based step number.'), status: z.enum(['doing', 'done', 'skipped']), note: z.string().max(CHAT_TASK_LIMITS.note).optional(),
  }) }, async ({ step, status, note }) => {
    try {
      const task = ChatTaskStore.requireActive(live().id)
      if (step > task.steps.length) throw new Error(`단계는 1~${task.steps.length}야.`)
      const steps = task.steps.map((entry, index) => index === step - 1 ? { ...entry, status, ...(note ? { note } : {}) } : status === 'doing' && entry.status === 'doing' ? { ...entry, status: 'todo' as const } : entry)
      return result(view(ChatTaskStore.update(task.id, { steps })!, members()))
    } catch (error) { return failure(error) }
  })

  server.registerTool('task_wait', { description: 'Suspend the task and return its state; end your reply, do not poll. The app checks outcomes now and resumes only when all selected targets resolve; unrelated work has no effect. Cannot override a user pause; the user must resume it.', inputSchema: z.object({
    // A room has no page connection to wait for.
    for: (group ? z.enum(['approval', 'job', 'user']) : z.enum(['approval', 'job', 'page', 'user'])).describe('approval: review cards; job: generation; page: reconnection; user: answer.'),
    reason: z.string().max(CHAT_TASK_LIMITS.note),
    proposal_ids: z.array(z.number().int().positive()).min(1).optional().describe('approval only: IDs from results; omit for non-plan cards from this reply only.'),
    job_ids: z.array(z.number().int().positive()).min(1).optional().describe('job only: IDs from results; omit for linked jobs from this reply only. Earlier-reply or saved asset-card jobs require explicit IDs.'),
  }) }, async ({ for: wait, reason, proposal_ids, job_ids }) => {
    try {
      const task = live()
      if ((proposal_ids !== undefined && wait !== 'approval') || (job_ids !== undefined && wait !== 'job')) throw new Error('대기 종류에 맞는 대상 ID만 지정해줘.')
      return result(view(ChatTaskRunner.wait(task.id, wait, reason, chat.replyId, proposal_ids ?? job_ids), members()))
    } catch (error) { return failure(error) }
  })

  server.registerTool('task_finish', { description: 'End the current task: done when every step is finished, failed when it cannot be completed. Give a one-line summary.', inputSchema: z.object({
    outcome: z.enum(['done', 'failed']), summary: z.string().max(CHAT_TASK_LIMITS.note),
  }) }, async ({ outcome, summary }) => {
    try {
      const task = ChatTaskStore.requireActive(live().id)
      if (outcome === 'done' && (task.status === 'waiting' || task.steps.some((step) => step.status !== 'done' && step.status !== 'skipped'))) throw new Error('대기 중이거나 끝나지 않은 단계가 있어. 결과를 확인하고 단계를 정리한 뒤 완료해줘.')
      return result(view(ChatTaskStore.update(task.id, { status: outcome, reason: summary })!, members()))
    } catch (error) { return failure(error) }
  })
}
