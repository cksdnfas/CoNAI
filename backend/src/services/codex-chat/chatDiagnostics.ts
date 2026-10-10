import type { McpRequester } from '../../mcp/context'
import { isChatOwnTool } from '../../mcp/context'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { backupDateOf, backupFileName } from './chatBackup'
import { contextHash, legacyContextMeta, limitContextMeta, metadataOnly, type ContextSource } from './chatContextDiagnostics'
import { diagnosticsScopeForProfile, resolveChatAccess, resolveChatProfileToolGrant, type ChatDiagnosticsScope } from './codexChatAccess'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { ChatSummaryStore } from './chatMemory'
import { ChatGroupStore } from './chatGroupStore'
import { buildGroupHeader } from './groupChatContext'
import { constantLine, loreEntryTitle } from './chatLorebook'
import { booksForRequest, buildLoreIndex, buildLoreIndexContent } from './chatLoreContext'
import { blockStateContentText, blockStateText, foldBlockState, parseBlockEdits } from './chatBlockState'
import { userPersonaForThread, userPersonaPrompt } from './chatUserProfiles'
import { flagDirectiveFor, fillCharacterPlaceholders, estimateTokens, fixedContextGuidance, auxiliaryInstructionText, resolveAuthorNote, type ChatContextMeta } from './llmChatContext'
import { loadChatSettings } from './chatSettings'
import { openChatMcpBridge } from './chatMcpBridge'
import { readChatRequestCapture } from './chatRequestCaptures'

export class ChatDiagnosticsError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

function profileOf(thread: CodexChatThreadRecord, message: CodexChatMessageRecord) {
  const id = thread.kind === 'group' ? message.speaker_profile_id : thread.profile_id
  return id ? ChatProfileStore.find(id) : null
}

function scopeFor(accountId: number | null, profile: ChatProfile | null): ChatDiagnosticsScope {
  return diagnosticsScopeForProfile(resolveChatAccess(accountId).diagnostics, profile !== null)
}

function parseMeta(value: string | null | undefined): ChatContextMeta | null {
  try {
    const meta = JSON.parse(value ?? 'null') as ChatContextMeta | null
    return meta && typeof meta.sentMessages === 'number' && Array.isArray(meta.lore) ? metadataOnly(limitContextMeta(meta)) as ChatContextMeta : null
  } catch { return null }
}

/** Thread details and stream messages carry bounded, text-free metadata, including each alternative. */
export function visibleContextMessages(thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], accountId: number | null): CodexChatMessageRecord[] {
  const accessScope = resolveChatAccess(accountId).diagnostics
  const scopes = new Map<number | null, ChatDiagnosticsScope>()
  return messages.map((message) => {
    const profileId = thread.kind === 'group' ? message.speaker_profile_id : thread.profile_id
    let scope = scopes.get(profileId)
    if (scope === undefined) {
      const profile = profileId ? ChatProfileStore.find(profileId) : null
      scope = diagnosticsScopeForProfile(accessScope, profile !== null)
      scopes.set(profileId, scope)
    }
    const filter = (value: string | null | undefined) => {
      const meta = parseMeta(value)
      if (!meta) return null
      return JSON.stringify(scope === 'none' ? legacyContextMeta(meta) : meta.version === 2 ? { ...meta, scope } : meta)
    }
    return { ...message, context_meta: filter(message.context_meta), alternatives: message.alternatives.map((alternative) => ({ ...alternative, context_meta: filter(alternative.context_meta) })) }
  })
}

const CONTENT_SOURCE_KINDS = new Set(['window', 'summary', 'author-note', 'state', 'flags', 'user-persona', 'lore-index', 'constant-lore'])

/** Resolve only individual references, never reassemble an old request using today's settings. */
export async function getChatDiagnostics(requester: McpRequester, threadId: number, messageId: number, alternative?: unknown) {
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new ChatDiagnosticsError('채팅을 찾을 수 없어.', 404)
  const messages = CodexChatStore.listMessages(threadId)
  const message = messages.find((entry) => entry.id === messageId && entry.role === 'assistant')
  if (!message) throw new ChatDiagnosticsError('답변을 찾을 수 없어.', 404)
  const profile = profileOf(thread, message)
  const scope = scopeFor(requester.accountId, profile)
  if (!loadChatSettings().enabled || !loadChatSettings().diagnostics.enabled || scope === 'none') throw new ChatDiagnosticsError('진단을 볼 권한이 없어.', 403)
  const index = alternative === undefined ? message.active_alternative : Number(alternative)
  if (!Number.isSafeInteger(index) || index < 0 || (message.alternatives.length ? index >= message.alternatives.length : index !== 0)) {
    throw new ChatDiagnosticsError('답변 변형을 찾을 수 없어.', 404)
  }
  const variant = message.alternatives[index] ?? message
  const meta = parseMeta(variant.context_meta)
  if (!meta) throw new ChatDiagnosticsError('이 답변에는 진단 기록이 없어.', 404)
  const texts: Array<ContextSource & { text?: string; promptText?: string; changedSince?: boolean; unavailable?: boolean; bookId?: number; entryId?: string }> = []
  if (scope !== 'view' && profile && meta.version === 2) {
    const user = userPersonaForThread(thread)
    const render = (text: string) => fillCharacterPlaceholders(text, profile, user)
    const profiles = thread.kind === 'group' ? ChatGroupStore.members(threadId).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? []) : [profile]
    const books = [...new Map(profiles.flatMap((member) => booksForRequest({ thread, profile: member })).map((book) => [book.id, book])).values()]
    const segments = ChatSummaryStore.list(threadId)
    const push = (source: ContextSource, text: string | undefined, extra: { bookId?: number; entryId?: string } = {}, displayText = text) => {
      texts.push({ ...source, ...extra, ...(text === undefined ? { unavailable: true } : { text: displayText, ...(scope === 'prompts' && displayText !== text ? { promptText: text } : {}), changedSince: contextHash(text) !== source.hash }) })
    }
    let definitions: Map<string, string> | undefined
    if (scope === 'prompts' && meta.sources?.some((source) => source.kind === 'tool-definition')) {
      const grant = resolveChatProfileToolGrant(profile, resolveChatAccess(requester.accountId))
      const bridge = await openChatMcpBridge(requester, grant.scopes, grant.toolAllowlist, {
        generationPresetIds: profile.generationPresetIds, allowEmpty: true,
        chatContext: { threadId, profileId: profile.id, kind: thread.kind },
      })
      try { definitions = new Map(bridge.tools.map((tool) => [tool.function.name, JSON.stringify(tool)])) }
      finally { await bridge.close() }
    }
    for (const source of [...(meta.sources ?? []), ...(scope === 'prompts' ? meta.auxiliarySources ?? [] : [])]) {
      if (scope !== 'prompts' && !CONTENT_SOURCE_KINDS.has(source.kind)) continue
      let text: string | undefined
      let displayText: string | undefined
      switch (source.kind) {
        case 'window': text = messages.find((entry) => entry.id === source.id)?.content; break
        case 'summary': text = thread.summary?.trim(); break
        case 'author-note': text = resolveAuthorNote(thread, profile, user).text; break
        case 'state': {
          const folded = foldBlockState(profile, messages, parseBlockEdits(thread.block_edits), thread.kind === 'group' ? profile.id : undefined)
          text = folded ? blockStateText(profile.style.blocks, folded.state) : ''
          displayText = folded ? blockStateContentText(profile.style.blocks, folded.state) : ''
          break
        }
        case 'flags': {
          const target = messages.find((entry) => entry.id === source.id && entry.role === 'user')
          text = target ? flagDirectiveFor([target], profile, user) : undefined
          break
        }
        case 'user-persona': text = userPersonaPrompt(user); break
        case 'lore-index': {
          const toolOffered = meta.sources?.some((item) => item.kind === 'tool-definition' && item.id === 'read_lore_file') ?? false
          text = buildLoreIndex(books, (value) => estimateTokens(profile.id, value), render, toolOffered)
          displayText = buildLoreIndexContent(books, (value) => estimateTokens(profile.id, value), render, toolOffered)
          break
        }
        case 'constant-lore': {
          const constants = (meta.loreEntries ?? []).filter((entry) => entry.reason === 'constant')
          const current = constants.map((entry) => books.find((book) => book.id === entry.bookId)?.entries.find((item) => item.id === entry.entryId))
          if (current.every((entry) => !!entry)) text = current.map((entry) => constantLine(render(loreEntryTitle(entry!)), render(entry!.content))).join('\n')
          break
        }
        case 'system-prompt': text = render(profile.systemPrompt); break
        case 'prompt-section': case 'example': case 'last-instruction': {
          const section = profile.promptSections.find((item) => item.id === source.id)
          text = section ? render(section.kind === 'post' ? section.content.trim() : section.content) : undefined
          break
        }
        case 'guidance': text = fixedContextGuidance(profile, meta.sources?.some((item) => item.kind === 'tool-definition' && !isChatOwnTool(String(item.id))) ?? false); break
        case 'tool-definition': text = definitions?.get(String(source.id)); break
        case 'group-header': text = buildGroupHeader({ thread, members: profiles, self: profile, user }); break
        case 'summary-instruction': case 'translation-instruction': text = auxiliaryInstructionText(profile, user, String(source.id)); break
      }
      push(source, text, {}, displayText)
    }
    for (const entry of meta.loreEntries ?? []) {
      const current = books.find((book) => book.id === entry.bookId)?.entries.find((item) => item.id === entry.entryId)
      push({ kind: 'lore', id: entry.entryId, hash: entry.hash ?? '' }, current ? render(current.content) : undefined, { bookId: entry.bookId, entryId: entry.entryId })
    }
    for (const recall of meta.recall ?? []) {
      push({ kind: 'recall', id: recall.segmentId, hash: recall.hash }, segments.find((segment) => segment.id === recall.segmentId)?.content.trim())
    }
  }
  // Permission and profile changes during an awaited tool-catalog read must take effect immediately too.
  if (!loadChatSettings().diagnostics.enabled || scopeFor(requester.accountId, profileOf(thread, message)) !== scope) throw new ChatDiagnosticsError('진단 권한이 변경됐어.', 403)
  return { format: 'conai-chat-diagnostics', version: 2, threadId, messageId, alternative: index, scope, meta,
    ...(scope === 'view' ? {} : { texts }), ...(scope === 'prompts' ? { raw: readChatRequestCapture(messageId, index) } : {}) }
}

/** Export the same redacted response into this requester's own store. */
export async function exportChatDiagnostics(requester: McpRequester, threadId: number, messageId: number, alternative?: unknown) {
  const result = await getChatDiagnostics(requester, threadId, messageId, alternative)
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  const message = CodexChatStore.listMessages(threadId).find((entry) => entry.id === messageId)
  if (!thread || !message || scopeFor(requester.accountId, profileOf(thread, message)) !== result.scope) throw new ChatDiagnosticsError('진단 권한이 변경됐어.', 403)
  const owner = fileOwnerKey(requester.accountId)
  const date = backupDateOf(undefined)
  const root = FileStoreService.ensureFolder(owner, null, '채팅 진단')
  const day = FileStoreService.ensureFolder(owner, root.id, date)
  const name = backupFileName(thread.title, threadId).replace(`(#${threadId})`, `(#${threadId}-${messageId})`)
  const file = FileStoreService.writeText(owner, day.id, name, JSON.stringify(result, null, 2))
  return { file, path: `채팅 진단/${date}/${name}` }
}
