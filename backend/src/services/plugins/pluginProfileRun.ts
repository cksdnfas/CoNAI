import type { PluginLlmInput, PluginLlmJob, PluginProfileRun } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import type { ChatProfile } from '../codex-chat/chatProfiles'
import { CodexChatStore } from '../codex-chat/codexChatStore'
import { ensureAutomationRoom, wakeChatRoom } from '../codex-chat/chatRoomWake'
import { resolveProfileModel } from '../codex-chat/chatModelRoles'
import { attachJobResults } from '../codex-chat/codexChatMedia'
import { PluginError, sha256 } from './pluginStore'
import { ChatResearchExecution, requireResearchProfile } from '../codex-chat/chatResearch'
import { buildChatProfileReplyMessages } from '../codex-chat/chatProfileReply'
import { beginDirectReply } from '../codex-chat/chatReplies'
import { generateLlmGroupReply } from '../codex-chat/llmChatService'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import fs from 'node:fs'
import path from 'node:path'
import { piChatPrivateRoot } from '../codex-chat/piChatCompletion'

const running = new Set<string>()

/** Read only the replies created by this run; generated media/job references can finish after the model's text. */
export function refreshPluginProfileRun(run: PluginProfileRun, requester: McpRequester): PluginProfileRun {
  if (!CodexChatStore.findThread(run.threadId, requester.accountId)) throw new PluginError('프로필 실행 대화를 찾을 수 없어.', 404)
  if (run.research) requireRequesterPermission(requester, 'posts.view')
  const tools: PluginProfileRun['tools'] = []
  let bytes = 0, toolsTruncated = false
  const replies = run.messageIds.flatMap(id => { const reply = CodexChatStore.findMessage(run.threadId, id); return reply ? [reply] : [] })
  for (const reply of attachJobResults(replies).messages) {
    for (const call of reply.tool_calls) {
      const entry = { id: call.id.slice(0, 160), name: call.tool.slice(0, 128), status: call.status,
        summary: (call.summary ?? '').slice(0, 300), output: (call.output ?? '').slice(0, 600),
        historyIds: call.historyIds.slice(0, 20), compositeHashes: call.compositeHashes.slice(0, 20),
        audioCandidateIds: (call.audioCandidateIds ?? []).slice(0, 20), pendingJobIds: (call.pendingJobIds ?? []).slice(0, 20),
        proposalId: call.proposal?.id ?? null, failedJobs: (call.failedJobs ?? []).slice(0, 20).map(job => ({ jobId: job.jobId, message: job.failureMessage.slice(0, 300) })),
        ...(call.deferred ? { deferred: { state: call.deferred.state, error: call.deferred.error?.slice(0, 300) ?? null } } : {}) }
      const size = Buffer.byteLength(JSON.stringify(entry))
      if (tools.length >= 32 || bytes + size > 24 * 1024) { toolsTruncated = true; continue }
      tools.push(entry); bytes += size
    }
  }
  return { ...run, tools, toolsTruncated }
}

/** Use the same engine, tool catalog, profile grants, reviews and cancellation as a native profile chat. */
export async function runPluginProfile(params: {
  pluginId: string; pluginName: string; requester: McpRequester; profile: ChatProfile; input: PluginLlmInput; signal: AbortSignal
}): Promise<NonNullable<PluginLlmJob['result']>> {
  const { pluginId, pluginName, requester, profile, input, signal } = params
  const key = `plugin:${pluginId}:profile:${profile.id}`
  const lock = `${requester.accountId ?? 'bootstrap'}:${key}`
  if (running.has(lock)) throw new PluginError('이 플러그인의 프로필이 아직 실행 중이야. 기존 작업이 끝난 뒤 호출해줘.', 409)
  running.add(lock)
  try {
    signal.throwIfAborted()
    if (input.research) {
      const runtime = requireResearchProfile(profile)
      requireRequesterPermission(requester, 'posts.view')
      const research = new ChatResearchExecution(input.research, runtime)
      const roomKey = `${key}:research:${sha256(JSON.stringify([input.research.slotId, input.research.activityId, input.requestId]))}`
      const room = await ensureAutomationRoom(requester, profile.id, roomKey, `${pluginName} · ${profile.name} · Research`)
      signal.throwIfAborted()
      const userId = CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: input.message, display_content: null, tool_calls: [], status: 'completed', error: null })
      const delivery = beginDirectReply(room, profile.id, [], CodexChatStore.findMessage(room.id, userId) ?? null, signal, () => {})
      let piDir: string | undefined
      const validate = () => {
        requireRequesterPermission(requester, 'posts.view')
        research.validateSources(requester, profile.id)
      }
      const controller = new AbortController()
      const runSignal = AbortSignal.any([signal, controller.signal])
      // Native engines own internal provider requests: also stop an in-flight run on source revocation.
      const accessTimer = runtime !== 'direct' ? setInterval(() => {
        try { validate() } catch (error) { controller.abort(error) }
      }, 1000) : undefined
      accessTimer?.unref()
      try {
        // The native headless reply executor owns tool rounds, usage, permissions and provider cancellation.
        // Only the stateless persona builder supplies context: no room history, hooks, memory, lore or files.
        // Direct API already checks immediately before every request, without an extra preflight query.
        if (runtime !== 'direct') validate()
        const messages = buildChatProfileReplyMessages({
          profile, message: input.message, history: input.history ?? null, userName: input.userName ?? null, useLorebooks: false,
        })
        if (runtime === 'pi') {
          const root = piChatPrivateRoot()
          fs.mkdirSync(root, { recursive: true, mode: 0o700 })
          piDir = fs.mkdtempSync(path.join(root, 'research-'))
        }
        const reply = runtime === 'codex' ? await (await import('../codex-chat/codexChatService')).runCodexResearchReply({
          requester, profile, chatContext: delivery.context, research, messages, signal: runSignal,
        }) : await generateLlmGroupReply({
          requester, profile, threadId: room.id, chatContext: delivery.context, signal: runSignal, research, emit: () => {},
          generation: { maxTokens: Math.min(input.maxTokens ?? 4096, profile.maxTokens ?? 4096) },
          buildMessages: (_tools, _onMeta, _judged, useSession) => {
            if (piDir) {
              useSession({ runtime: 'pi', dir: piDir, resumeId: null, onDone: () => {} })
              // Pi accepts only the latest user input. Keep explicit caller history, without loading any old session.
              return [...messages.filter(message => message.role === 'system'), { role: 'user', content: JSON.stringify(messages.filter(message => message.role !== 'system')) }]
            }
            return messages
          },
        })
        const messageId = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', ...reply, display_content: null, routing: delivery.routing })
        runSignal.throwIfAborted()
        if (reply.status !== 'completed') throw new PluginError(`Research failed (chat ${room.id}): ${reply.error ?? reply.status}`, 502)
        validate()
        const profileRun = refreshPluginProfileRun({ threadId: room.id, messageIds: [messageId], tools: [], toolsTruncated: false, research: research.result }, requester)
        return { text: reply.content.slice(0, 4000), truncated: reply.content.length > 4000, model: resolveProfileModel(profile, 'chat')?.model ?? '', engine: profile.engine, profileRun }
      } finally {
        if (accessTimer) clearInterval(accessTimer)
        if (piDir) fs.rmSync(piDir, { recursive: true, force: true })
        delivery.close()
      }
    }
    const room = await ensureAutomationRoom(requester, profile.id, key, `${pluginName} · ${profile.name}`)
    signal.throwIfAborted()
    const { CodexChatService } = await import('../codex-chat/codexChatService')
    if (CodexChatService.isRunning(room.id)) throw new PluginError('프로필 대화가 아직 실행 중이야.', 409)
    CodexChatStore.updateThreadContext(room.id, { maxTokens: input.maxTokens === undefined ? null : Math.min(input.maxTokens, profile.maxTokens ?? input.maxTokens) })
    const instruction = [input.history ? `<plugin-history>\n${input.history}\n</plugin-history>` : '',
      input.userName ? `Conversation partner: ${input.userName}` : '', input.message].filter(Boolean).join('\n\n')
    const result = await wakeChatRoom({ requester, threadId: room.id, instruction,
      routing: { source: 'plugin', id: null, name: pluginName }, signal })
    signal.throwIfAborted()
    if (!result.replies.length || result.replies.some(reply => reply.status !== 'completed')) {
      throw new PluginError(`프로필 실행을 완료하지 못했어. 채팅에서 실행 결과를 확인해줘. (대화 ${room.id})`, 502)
    }
    const raw = result.replies.map(reply => reply.display_content ?? reply.content).join('\n\n')
    const text = raw.slice(0, 4000)
    const profileRun = refreshPluginProfileRun({ threadId: room.id, messageIds: result.replies.map(reply => reply.id), tools: [], toolsTruncated: false }, requester)
    return { text, truncated: text.length !== raw.length, model: resolveProfileModel(profile, 'chat')?.model ?? '', engine: profile.engine, profileRun }
  } finally { running.delete(lock) }
}
