import type { ChatExecutionContext, ChatPageSnapshot } from '@conai/shared'
import { chatGenerationToolName, getMcpToolScope, isChatGenerationTool, type McpRequester } from '../../mcp/context'
import { WorkspaceService } from '../workspaceService'
import { requireFileStoreOwner } from '../fileStoreAccess'
import { resolveChatAccess, resolveChatProfileToolGrant, canUseChatProfile } from './codexChatAccess'
import { ChatGenerationPresetStore } from './chatGenerationPresets'
import { openChatMcpBridge } from './chatMcpBridge'
import { ChatProfileStore, sessionRuntimeOf, type ChatProfile } from './chatProfiles'
import { requestChatModel } from './llmChatContext'
import { resolveChatCompletionTarget, toolsRefusedBy } from './llmChatCompletion'
import { CodexChatStore, type CodexChatThreadRecord } from './codexChatStore'
import { loadChatSettings } from './chatSettings'
import { ChatToolDirectiveError, parseToolDirective, type ResolvedChatToolDirective } from './chatToolDirective'

/** Enumerate the same wrapped MCP registrations as a reply, without the lazy catalog hiding definitions. */
async function listChatComposerTools(requester: McpRequester, profile: ChatProfile, thread?: CodexChatThreadRecord, page?: ChatPageSnapshot) {
  if (!loadChatSettings().enabled || !profile.isEnabled || !canUseChatProfile(resolveChatAccess(requester.accountId), profile)) throw new ChatToolDirectiveError('이 프로필로 채팅할 권한이 없어.', 403, null)
  if (thread && !CodexChatStore.findThread(thread.id, requester.accountId)) throw new ChatToolDirectiveError('채팅을 찾을 수 없어.', 404, null)
  const empty = () => ({ presets: [], tools: [], presetTools: new Map<number, string>() })
  if (thread?.kind === 'group') return empty()
  const model = profile.engine === 'llm' && !sessionRuntimeOf(profile) ? requestChatModel(profile) : null
  if (model && toolsRefusedBy(resolveChatCompletionTarget(model.providerName, { model: model.model }))) return empty()
  const { scopes, toolAllowlist } = resolveChatProfileToolGrant(profile, resolveChatAccess(requester.accountId), thread?.id)
  const chatContext: ChatExecutionContext = { threadId: thread?.id ?? 0, profileId: profile.id, kind: 'direct', page }
  const workspaces = thread ? undefined : (() => {
    // Match chatWorkspaces: without shared-file access a turn has no project tools.
    try {
      const owner = requireFileStoreOwner(requester)
      return profile.workspaces.filter(link => WorkspaceService.exists(link.id)).map(link => ({
        project: WorkspaceService.get(owner, link.id), bindingRevision: `profile:${link.write ? 1 : 0}`, write: link.write, source: 'profile' as const,
      }))
    } catch { return [] }
  })()
  const linkedPresets = ChatGenerationPresetStore.resolve(profile.generationPresetIds)
  const bridge = await openChatMcpBridge(requester, scopes, toolAllowlist, {
    generationPresetIds: profile.generationPresetIds, chatContext, toolCatalog: false,
    source: profile.engine === 'codex' ? 'codex-chat' : 'llm-chat', composerPreview: true, profilePreview: !thread, workspaces,
  })
  try {
    const offered = new Set(bridge.tools.map(tool => tool.function.name))
    const presetTools = new Map(linkedPresets.flatMap((preset, index) => offered.has(chatGenerationToolName(index)) ? [[preset.id, chatGenerationToolName(index)] as const] : []))
    const presets = linkedPresets.filter(preset => presetTools.has(preset.id))
      .map(({ id, name, instruction, kind }) => ({ id, name, instruction, kind }))
    const tools = bridge.tools.filter(tool => !isChatGenerationTool(tool.function.name))
      .map(tool => ({ name: tool.function.name, description: tool.function.description ?? '', scope: getMcpToolScope(tool.function.name) }))
    return { presets, tools, presetTools }
  } finally { await bridge.close() }
}

export async function getChatComposerTools(requester: McpRequester, target: { threadId?: number; profileId?: number }) {
  const thread = target.threadId === undefined ? undefined : CodexChatStore.findThread(target.threadId, requester.accountId)
  if (target.threadId !== undefined && !thread) throw new ChatToolDirectiveError('채팅을 찾을 수 없어.', 404, null)
  if (thread?.kind === 'group') return { presets: [], tools: [] }
  const profileId = thread?.profile_id ?? target.profileId
  const profile = profileId ? ChatProfileStore.find(profileId, thread?.id) : null
  if (!profile) throw new ChatToolDirectiveError('프로필을 찾을 수 없어.', 404, null)
  const { presets, tools } = await listChatComposerTools(requester, profile, thread ?? undefined)
  return { presets, tools }
}

export async function resolveChatToolDirective(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, value: unknown, page?: ChatPageSnapshot): Promise<ResolvedChatToolDirective | undefined> {
  if (value === undefined) return undefined
  const input = parseToolDirective(value)
  if (thread.kind === 'group') throw new ChatToolDirectiveError('도구 지시는 1:1 채팅에서만 사용할 수 있어.')
  const available = await listChatComposerTools(requester, profile, thread, page)
  if ('presetId' in input) {
    const preset = available.presets.find(item => item.id === input.presetId)
    if (!preset) throw new ChatToolDirectiveError('선택한 생성 프리셋은 이 채팅에서 사용할 수 없어. 프리셋 목록을 새로 확인해줘.')
    return { snapshot: { presetId: preset.id, name: preset.name }, tool: available.presetTools.get(preset.id)! }
  }
  if (isChatGenerationTool(input.tool) || !available.tools.some(item => item.name === input.tool)) throw new ChatToolDirectiveError('선택한 도구는 이 채팅에서 사용할 수 없어. 도구 목록을 새로 확인해줘.')
  return { snapshot: { tool: input.tool }, tool: input.tool }
}

export async function retryChatToolDirective(requester: McpRequester, thread: CodexChatThreadRecord, profile: ChatProfile, snapshot: import('@conai/shared').ChatToolDirectiveSnapshot | undefined) {
  if (!snapshot) return undefined
  try { return await resolveChatToolDirective(requester, thread, profile, 'presetId' in snapshot ? { presetId: snapshot.presetId } : snapshot) }
  catch (error) {
    if (error instanceof ChatToolDirectiveError) return undefined
    throw error
  }
}
