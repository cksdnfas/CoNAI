import type { ChatRecipient, ChatToolCall } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { parseBlockEdits } from './chatBlockState'
import { OwnedLorebookStore, parsePinnedMemories, pinnedMemoryEntries } from './chatLorebookFiles'
import { renderSummary, type ChatSummarySegment } from './chatMemory'
import { ChatProfileStore } from './chatProfiles'
import { CodexChatStore, parseMessageRouting } from './codexChatStore'
import { validateChatMediaAttachments } from './chatMediaAttachments'

export const CHAT_IMPORT_MAX_BYTES = 32 * 1024 * 1024
const MAX_MESSAGES = 20_000
const MAX_TEXT = 200_000
const MAX_ALTERNATIVES = 20
/** Imported tool results are reduced to their short summary: the full output would reach the model as a tool's answer. */
const TOOL_SUMMARY_MAX = 300
const TOOL_ARGUMENTS_MAX = 4000

export class ChatImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})
const textOf = (value: unknown, limit = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, limit) : '')
const nullableText = (value: unknown, limit = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, limit) : null)
const intOrNull = (value: unknown, min: number, max: number) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : null)
const STATUSES = new Set(['completed', 'failed', 'interrupted'])

/**
 * A tool call as it is kept: what ran, its short summary, and the library images it showed that this viewer may see
 * — never its full output, nor history or job ids (they would claim other records as this chat's results).
 */
function importToolCall(value: unknown, visible: (hash: string) => boolean): ChatToolCall | null {
  const call = object(value)
  if (typeof call.id !== 'string' || typeof call.tool !== 'string') return null
  const hashes = Array.isArray(call.compositeHashes) ? call.compositeHashes.filter((item): item is string => typeof item === 'string' && /^[a-f0-9]{48}$/.test(item)).slice(0, 100) : []
  const args = call.arguments ?? null
  return {
    id: call.id.slice(0, 120),
    tool: call.tool.slice(0, 120),
    status: call.status === 'failed' ? 'failed' : 'completed',
    arguments: JSON.stringify(args).length <= TOOL_ARGUMENTS_MAX ? args : null,
    summary: nullableText(call.summary, TOOL_SUMMARY_MAX),
    historyIds: [],
    compositeHashes: hashes.filter(visible),
  }
}

function importToolCalls(value: unknown, visible: (hash: string) => boolean) {
  return Array.isArray(value) ? value.slice(0, 200).flatMap((call) => importToolCall(call, visible) ?? []) : []
}

/** A profile the chat had: the same id under the same name, else one of that name; null when there is none. */
function findProfile(id: unknown, profileName: unknown) {
  const name = typeof profileName === 'string' ? profileName.trim() : ''
  const byId = typeof id === 'number' ? ChatProfileStore.find(id) : null
  if (byId && (!name || byId.name === name)) return byId
  return (name ? ChatProfileStore.list().find((profile) => profile.name === name) : undefined) ?? null
}

/** How the empty chat is made, with the caller's access checks: a direct chat with a profile, or a room. */
export type ChatImportTarget = {
  direct: (profileId: number) => { id: number }
  group: (profileIds: number[], representativeId: number) => { id: number }
}

/**
 * A chat exported as CoNAI JSON, back in as a new chat of the same profile (a room: of the same members): messages
 * with their variants, quotes, flags and app media; files only when they are still the importer's; the pinned
 * memories, author's note, chat settings, display block edits and summary. Tool results come back as their short
 * summaries only. A Codex chat (or member) starts a new Codex thread that is told the recent past on its first turn.
 */
export function importChatThread(requester: McpRequester, raw: Buffer, target: ChatImportTarget) {
  let file: Json
  try {
    file = object(JSON.parse(raw.toString('utf8').replace(/^﻿/, '')))
  } catch {
    throw new ChatImportError('CoNAI 대화 JSON을 읽지 못했어.')
  }
  if (file.format !== 'conai-chat' || file.version !== 1) throw new ChatImportError('CoNAI에서 내보낸 대화 JSON이 아니야.')
  const thread = object(file.thread)
  const messages = Array.isArray(file.messages) ? file.messages.slice(0, MAX_MESSAGES).map(object) : []
  if (messages.length === 0) throw new ChatImportError('가져올 메시지가 없어.')
  // Old profile id → this instance's profile, for the chat's profile and (in a room) each member and speaker.
  const profileIds = new Map<number, number>()
  let created: { id: number }
  if (thread.kind === 'group') {
    const members = Array.isArray(file.members) ? file.members.slice(0, 20).map(object) : []
    const missing: string[] = []
    for (const member of members) {
      const found = findProfile(member.id, member.name)
      if (found && typeof member.id === 'number') profileIds.set(member.id, found.id)
      else missing.push(typeof member.name === 'string' ? member.name : String(member.id))
    }
    if (missing.length) throw new ChatImportError(`이 방의 참가자 프로필을 찾을 수 없어: ${missing.join(', ')}`, 409)
    const representative = typeof thread.profile_id === 'number' ? profileIds.get(thread.profile_id) : undefined
    if (profileIds.size < 2 || representative === undefined) throw new ChatImportError('이 방의 참가자 목록이 없어. 새로 내보낸 파일로 가져와줘.', 409)
    created = target.group([...profileIds.values()], representative)
  } else {
    const profile = findProfile(thread.profile_id, file.profileName)
    if (!profile) throw new ChatImportError(typeof file.profileName === 'string' ? `이 대화의 프로필(${file.profileName})을 찾을 수 없어. 같은 이름의 프로필을 먼저 만들어줘.` : '이 대화의 프로필을 찾을 수 없어.', 409)
    created = target.direct(profile.id)
  }
  const notes: string[] = []
  const owner = fileOwnerKey(requester.accountId)
  const ownsFile = (id: unknown) => {
    if (typeof id !== 'string') return false
    try { FileStoreService.validateAttachments(owner, [id]); return true } catch { return false }
  }
  // Library media goes through the same check as attaching it by hand: access, visibility, still there.
  const mediaSeen = new Map<string, ReturnType<typeof validateChatMediaAttachments>[number] | null>()
  const mediaOf = (hash: string) => {
    if (!mediaSeen.has(hash)) {
      try { mediaSeen.set(hash, validateChatMediaAttachments(requester, [hash], 0)[0] ?? null) } catch { mediaSeen.set(hash, null) }
    }
    return mediaSeen.get(hash) ?? null
  }
  const visible = (hash: string) => mediaOf(hash) !== null

  const db = getUserSettingsDb()
  try {
  db.transaction(() => {
    // The new chat's greeting gives way to the imported transcript.
    CodexChatStore.clearThread(created.id, '')
    const ids = new Map<number, number>()
    const insert = db.prepare(`INSERT INTO codex_chat_messages (thread_id, role, content, display_content, tool_calls, status, error, flags, finish_reason,
      media_attachments, alternatives, active_alternative, created_date, speaker_profile_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const attach = db.prepare('INSERT INTO chat_file_attachments (message_id, file_id) VALUES (?, ?)')
    let droppedFiles = 0
    let droppedToolOutputs = 0
    const pending: Array<{ copyId: number; routing: unknown }> = []
    for (const message of messages) {
      const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : null
      const oldId = intOrNull(message.id, 1, Number.MAX_SAFE_INTEGER)
      if (!role || oldId === null) continue
      const toolCalls = importToolCalls(message.tool_calls, visible)
      if (Array.isArray(message.tool_calls) && message.tool_calls.some((call) => typeof object(call).output === 'string')) droppedToolOutputs += 1
      const alternatives = Array.isArray(message.alternatives) ? message.alternatives.slice(0, MAX_ALTERNATIVES).map(object).map((alternative) => ({
        content: textOf(alternative.content),
        display_content: nullableText(alternative.display_content),
        tool_calls: importToolCalls(alternative.tool_calls, visible),
        created_at: textOf(alternative.created_at, 40),
        status: STATUSES.has(alternative.status as string) ? alternative.status : 'completed',
        error: nullableText(alternative.error, 2000),
        finish_reason: nullableText(alternative.finish_reason, 40),
      })) : []
      const active = intOrNull(message.active_alternative, 0, Math.max(0, alternatives.length - 1)) ?? 0
      const media = Array.isArray(message.mediaAttachments) ? message.mediaAttachments.slice(0, 20).map(object)
        .flatMap((item) => (typeof item.compositeHash === 'string' && /^[a-f0-9]{48}$/.test(item.compositeHash) ? mediaOf(item.compositeHash) ?? [] : [])) : []
      const copyId = Number(insert.run(
        created.id, role, textOf(message.content), nullableText(message.display_content), toolCalls.length ? JSON.stringify(toolCalls) : null,
        STATUSES.has(message.status as string) ? message.status : 'completed', nullableText(message.error, 2000),
        Array.isArray(message.flags) ? JSON.stringify(message.flags.slice(0, 20)) : null, nullableText(message.finish_reason, 40),
        media.length ? JSON.stringify(media) : null, alternatives.length ? JSON.stringify(alternatives) : null, active,
        typeof message.created_date === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d/.test(message.created_date) ? message.created_date.slice(0, 30) : new Date().toISOString().replace('T', ' ').slice(0, 19),
        role === 'assistant' && typeof message.speaker_profile_id === 'number' ? profileIds.get(message.speaker_profile_id) ?? null : null,
      ).lastInsertRowid)
      ids.set(oldId, copyId)
      for (const file of Array.isArray(message.attachments) ? message.attachments.slice(0, 20).map(object) : []) {
        if (ownsFile(file.id)) attach.run(copyId, file.id)
        else droppedFiles += 1
      }
      if (message.routing) pending.push({ copyId, routing: message.routing })
    }
    // Quotes point at the copies; a quoted message that did not come along reads as unavailable.
    const setRouting = db.prepare('UPDATE codex_chat_messages SET routing = ? WHERE id = ?')
    for (const { copyId, routing: value } of pending) {
      const routing = parseMessageRouting(JSON.stringify(value))
      if (!routing) continue
      delete routing.replyId
      // A room's recipients are member profile ids; one that did not come along is dropped.
      routing.recipients = routing.recipients.flatMap((recipient): ChatRecipient[] => {
        if (typeof recipient !== 'number') return [recipient]
        const mapped = profileIds.get(recipient)
        return mapped === undefined ? [] : [mapped]
      })
      if (routing.replyTo?.speakerProfileId != null) routing.replyTo = { ...routing.replyTo, speakerProfileId: profileIds.get(routing.replyTo.speakerProfileId) ?? null }
      if (routing.replyTo) {
        const quoted = ids.get(routing.replyTo.messageId)
        routing.replyTo = quoted ? { ...routing.replyTo, messageId: quoted } : { ...routing.replyTo, excerpt: '', media: undefined, unavailable: true }
      }
      setRouting.run(JSON.stringify(routing), copyId)
    }

    const edits = parseBlockEdits(typeof thread.block_edits === 'string' ? thread.block_edits : null)
      .flatMap((edit) => (edit.afterMessageId === 0 || ids.has(edit.afterMessageId) ? [{ ...edit, afterMessageId: ids.get(edit.afterMessageId) ?? 0, profileId: undefined }] : []))
    db.prepare(`UPDATE codex_chat_threads SET title = ?, context_turns = ?, summary_enabled = ?, author_note = ?, author_note_depth = ?, max_tokens = ?,
      block_edits = ? WHERE id = ?`).run(
      textOf(thread.title, 60) || '가져온 대화',
      intOrNull(thread.context_turns, 1, 200), intOrNull(thread.summary_enabled, 0, 1),
      nullableText(thread.author_note, 4000), intOrNull(thread.author_note_depth, 0, 20), intOrNull(thread.max_tokens, 1, 1_000_000),
      edits.length ? JSON.stringify(edits) : null, created.id,
    )
    // An export from before the lorebook carries pinned memories: they become the chat book's always-on entries.
    const memories = parsePinnedMemories(typeof thread.memories === 'string' ? thread.memories : Array.isArray(thread.memories) ? JSON.stringify(thread.memories) : null)
    if (memories.length > 0) OwnedLorebookStore.addChatBookEntries(created.id, pinnedMemoryEntries(memories.slice(0, 50)))

    // The summary: its segments when the file has them, else the old single summary as a plot up to where it reached.
    const insertSegment = db.prepare('INSERT INTO chat_summary_segments (thread_id, level, from_message_id, until_message_id, content, backed) VALUES (?, ?, ?, ?, ?, ?)')
    const segments = Array.isArray(file.summarySegments) ? file.summarySegments.slice(0, 5000).map(object) : []
    for (const segment of segments) {
      const content = textOf(segment.content, 20_000).trim()
      const until = intOrNull(segment.until_message_id, 0, Number.MAX_SAFE_INTEGER)
      if (!content || until === null || (until !== 0 && !ids.has(until))) continue
      const from = intOrNull(segment.from_message_id, 0, Number.MAX_SAFE_INTEGER) ?? 0
      insertSegment.run(created.id, segment.level === 1 ? 1 : 0, ids.get(from) ?? 0, ids.get(until) ?? 0, content, segment.backed === 0 ? 0 : 1)
    }
    const oldUntil = intOrNull(thread.summary_until_message_id, 0, Number.MAX_SAFE_INTEGER)
    if (segments.length === 0 && typeof thread.summary === 'string' && thread.summary.trim()) {
      insertSegment.run(created.id, 1, 0, oldUntil ? ids.get(oldUntil) ?? 0 : 0, thread.summary.trim().slice(0, 20_000), 0)
    }
    const stored = db.prepare('SELECT * FROM chat_summary_segments WHERE thread_id = ?').all(created.id) as ChatSummarySegment[]
    const until = stored.reduce<number | null>((max, segment) => (max === null || segment.until_message_id > max ? segment.until_message_id : max), null)
    db.prepare('UPDATE codex_chat_threads SET summary = ?, summary_until_message_id = ?, summary_updated_date = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id = ?')
      .run(renderSummary(stored) || null, until, until, created.id)

    if (droppedFiles) notes.push(`이 계정에 없는 첨부 파일 ${droppedFiles}개는 뺐어.`)
    if (droppedToolOutputs) notes.push('도구 결과는 요약만 남겼어.')
    if (ids.size < messages.length) notes.push(`읽을 수 없는 메시지 ${messages.length - ids.size}개는 건너뛰었어.`)
  }).immediate()
  } catch (error) {
    // No half-imported chat is left behind.
    CodexChatStore.deleteThread(created.id)
    throw error
  }
  return { threadId: created.id, notes }
}
