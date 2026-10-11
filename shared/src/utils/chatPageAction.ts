import type { ChatPageAction, ChatPageActionProposal, ChatPageData, ChatPageSchema } from '../types/chatPageAction'
import type { ChatPageSnapshot } from '../types/chatPage'

// Node schemas include nested properties/enums inside a page collection; schema recursion stays capped at eight.
export const CHAT_PAGE_ACTION_LIMITS = { actions: 24, bytes: 320000, text: 200000, depth: 20, array: 512 } as const
function own(value: object, key: PropertyKey) { return Object.prototype.hasOwnProperty.call(value, key) }
const privateKey = /password|secret|credential|api[ _-]?key|authorization|bearer|token|headers|(?:file|source|output|save|artifact)[ _-]?(?:path|directory)|(?:^|[_.-])(?:code|script|url|endpoint)(?:$|[_.-])|filename_prefix|비밀번호|인증키|저장.?경로/i
export function isPrivateChatPageKey(key: string) { return privateKey.test(key) || ['__proto__', 'prototype', 'constructor', 'dataUrl', 'base64', 'encoded'].includes(key) }

/** Copy only bounded JSON. Media and protected settings stay in the native page, outside model context. */
export function copyChatPageData(value: unknown, depth = 0): ChatPageData {
  if (depth > CHAT_PAGE_ACTION_LIMITS.depth) throw new Error('페이지 데이터가 너무 깊어.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length <= CHAT_PAGE_ACTION_LIMITS.text && !/^data:|^https?:\/\//i.test(value.trim())) return value
  if (Array.isArray(value) && value.length <= CHAT_PAGE_ACTION_LIMITS.array) return value.map((item) => copyChatPageData(item, depth + 1))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 512) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (isPrivateChatPageKey(key)) throw new Error(`보호된 페이지 항목이야: ${key}`)
      return [key, copyChatPageData(item, depth + 1)]
    }))
  }
  throw new Error('지원하지 않는 페이지 데이터야.')
}

export function normalizeChatPageSchema(input: unknown, depth = 0): ChatPageSchema {
  const raw = input as ChatPageSchema
  if (!raw || depth > 8 || !['string', 'number', 'boolean', 'object', 'array'].includes(raw.type)) throw new Error('작업 입력 정의가 올바르지 않아.')
  const schema: ChatPageSchema = { type: raw.type }
  if (raw.description !== undefined) { if (typeof raw.description !== 'string' || raw.description.length > 500) throw new Error('작업 설명이 너무 길어.'); schema.description = raw.description }
  for (const key of ['minimum', 'maximum', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (raw[key] !== undefined) { if (!Number.isFinite(raw[key]) || (key !== 'minimum' && key !== 'maximum' && raw[key]! < 0)) throw new Error('작업 입력 범위가 올바르지 않아.'); schema[key] = raw[key] }
  }
  if (raw.integer) schema.integer = true
  if (raw.enum) { if (!Array.isArray(raw.enum) || !raw.enum.length || raw.enum.length > 512 || raw.enum.some((item) => typeof item !== 'string' && typeof item !== 'number')) throw new Error('작업 선택 목록이 올바르지 않아.'); schema.enum = [...raw.enum] }
  if (raw.type === 'object') {
    if (!raw.properties || Object.keys(raw.properties).length > 100) throw new Error('작업 필드 정의가 올바르지 않아.')
    schema.properties = Object.fromEntries(Object.entries(raw.properties).map(([key, item]) => { if (isPrivateChatPageKey(key)) throw new Error('보호된 작업 필드야.'); return [key, normalizeChatPageSchema(item, depth + 1)] }))
    schema.required = raw.required ?? []
    if (!Array.isArray(schema.required) || schema.required.some((key) => !own(schema.properties!, key))) throw new Error('필수 작업 필드가 올바르지 않아.')
  }
  if (raw.type === 'array') schema.items = normalizeChatPageSchema(raw.items, depth + 1)
  return schema
}

export function validateChatPageArguments(schema: ChatPageSchema, input: unknown, path = 'arguments'): ChatPageData {
  let value = input
  // Local models sometimes serialize a structured argument as JSON. Only decode where the schema requires it.
  if ((schema.type === 'object' || schema.type === 'array') && typeof value === 'string') { try { value = JSON.parse(value) } catch { throw new Error(`${path}: JSON 입력이 필요해.`) } }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 객체가 필요해.`)
    const entries = Object.entries(value)
    if (entries.some(([key]) => !own(schema.properties ?? {}, key)) || schema.required?.some((key) => !own(value!, key))) throw new Error(`${path}: 등록된 필드와 필수 입력을 확인해줘.`)
    return Object.fromEntries(entries.map(([key, item]) => [key, validateChatPageArguments(schema.properties![key], item, `${path}.${key}`)]))
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > Math.min(schema.maxItems ?? 512, 512)) throw new Error(`${path}: 항목 개수가 올바르지 않아.`)
    return value.map((item, index) => validateChatPageArguments(schema.items!, item, `${path}[${index}]`))
  }
  if (typeof value !== schema.type || (schema.type === 'string' && (value as string).length > Math.min(schema.maxLength ?? 8000, CHAT_PAGE_ACTION_LIMITS.text)) || (schema.type === 'number' && (!Number.isFinite(value) || (schema.integer && !Number.isSafeInteger(value)) || (schema.minimum !== undefined && (value as number) < schema.minimum) || (schema.maximum !== undefined && (value as number) > schema.maximum))) || (schema.enum && !schema.enum.includes(value as string | number))) throw new Error(`${path}: 입력 형식이나 허용 범위를 확인해줘.`)
  return copyChatPageData(value)
}

/** IDs and route bindings are maintained by the app; snapshots cannot grant arbitrary native actions. */
export const CHAT_PAGE_ACTION_PERMISSIONS: Record<string, string | null> = {
  'page.navigate': null, 'page.refresh': null,
  'prompt.create': 'prompts.edit', 'prompt.update': 'prompts.edit', 'prompt.select': 'prompts.view',
  'preset.create': 'prompts.edit', 'preset.update': 'prompts.edit', 'preset.select': 'prompts.view', 'preset.draft': 'prompts.view', 'preset.insert': 'prompts.view',
  'wildcard.create': 'wildcards.edit', 'wildcard.update': 'wildcards.edit', 'wildcard.select': 'wildcards.view', 'wildcard.draft': 'wildcards.view',
  'comfy.select': 'workflows.view', 'comfy.refresh': 'workflows.view', 'comfy.open_create': 'workflows.edit', 'comfy.open_edit': 'workflows.edit',
  'comfy.author': 'workflows.view', 'comfy.save': 'workflows.edit', 'comfy.register': 'workflows.edit', 'comfy.node': null,
  // The server check uses the editor's own check route (workflows.edit); suggested fields only mark inputs in the draft.
  'comfy.check': 'workflows.edit', 'comfy.suggest_fields': 'workflows.view',
  'media.attach': null, 'media.clear': null,
  'nai.characters': null,
  'workflow.select': 'workflows.view', 'workflow.inputs': 'workflows.view',
  // Workflow runs and autoruns (예약): each applied card calls the same route as its button, as the person.
  'workflow.run': 'generation.execute', 'workflow.schedule_save': 'workflows.edit', 'workflow.schedule_pause': 'generation.execute',
  'workflow.schedule_resume': 'generation.execute', 'workflow.schedule_run_now': 'generation.execute', 'workflow.schedule_delete': 'workflows.edit',
  'workflow.run_cancel': 'generation.execute', 'workflow.runs_cleanup': 'workflows.edit',
  'group.select': 'images.view', 'group.create': 'images.edit', 'group.update': 'images.edit', 'group.auto_collect': 'images.edit',
  // Chat profile editor (settings › chat). Saving goes through the editor's own admin-only API.
  'profile.open_create': null, 'profile.open_edit': null, 'profile.copy': null, 'profile.section': null, 'profile.draft': null, 'profile.save': null, 'profile.assets': 'generation.execute',
  'library.search': 'images.view', 'library.history': 'images.view', 'library.open': 'images.view', 'library.select': 'images.view', 'files.open': 'files.view', 'files.preview': 'files.view',
  // File store: dialogs and the document editor open on screen; names, moves, deletes, restores and document saves are review cards.
  'files.select': 'files.view', 'files.new_folder': 'files.edit', 'files.rename': 'files.edit', 'files.move': 'files.edit', 'files.new_document': 'files.edit', 'files.edit_document': 'files.edit',
  'files.name_save': 'files.edit', 'files.move_save': 'files.edit', 'files.delete': 'files.delete', 'files.restore_version': 'files.edit',
  'files.doc_at': 'files.view', 'files.doc_edit': 'files.edit', 'files.doc_append': 'files.edit', 'files.doc_save': 'files.edit',
  // Settings › Chat › 자원 editors (lorebooks, generation presets, judge presets, blocks, tool presets). Saving uses each editor's own admin API.
  'resource.open': null, 'resource.save': null, 'lorebook.entries': null,
  'chat.open': 'chat.use', 'chat.prepare': 'chat.use',
  'audio.open': 'audio.view', 'audio.filter': 'audio.view', 'audio.select': 'audio.view',
  'sprite.select': null,
  // Sprite tabs: list and form edits are drafts; runs that save to the library are review cards.
  'sprite.add_videos': 'images.edit', 'sprite.remove_videos': 'images.edit', 'sprite.preview': 'images.edit', 'sprite.run': 'images.upload', 'sprite.stop': 'images.edit', 'sprite.download_zip': 'images.view',
  'sprite.add_sheets': 'images.edit', 'sprite.remove_sheets': 'images.edit', 'sprite.sheet': 'images.edit', 'sprite.download': 'images.edit',
  'audio.project': 'audio.view', 'audio.search': 'audio.view',
  // Upload page: re-reading, converting and downloading stay on screen; adding to the library is a review card.
  'upload.reextract': 'images.upload', 'upload.convert': 'images.upload', 'upload.download': 'images.upload', 'upload.library': 'images.upload',
  // Posts board: the editor and the comment box save through the board's own routes.
  'posts.open': 'posts.view', 'posts.category': 'posts.view', 'posts.tag': 'posts.view', 'posts.back': 'posts.view',
  'posts.new': 'posts.write', 'posts.edit': 'posts.write', 'posts.save': 'posts.write', 'posts.comment': 'posts.comment',
  'posts.layout': 'posts.view', 'posts.filter': 'posts.view', 'posts.body_at': 'posts.view', 'posts.body_edit': 'posts.write',
  'posts.delete': 'posts.write', 'posts.restore_revision': 'posts.write', 'posts.comment_update': 'posts.comment', 'posts.comment_delete': 'posts.comment', 'posts.bot_cancel': 'posts.view',
  // Administrators only (the routes check the role; the page offers them only to administrators).
  'posts.comment_hide': 'posts.view', 'posts.category_create': 'posts.view', 'posts.category_update': 'posts.view', 'posts.category_delete': 'posts.view',
  'wallpaper.select': null, 'wallpaper.open_preset': null, 'wallpaper.add_widget': null, 'wallpaper.save': null,
  // Wallpaper editor: draft edits stay in this browser's draft; presets, the schedule and runtime keys save through admin-only routes.
  'wallpaper.update_widget': null, 'wallpaper.arrange': null, 'wallpaper.apply_template': null, 'wallpaper.set_look': null, 'wallpaper.set_canvas': null,
  'wallpaper.history': null, 'wallpaper.open_dialog': null,
  'wallpaper.delete_preset': null, 'wallpaper.save_schedule': null, 'wallpaper.issue_key': null, 'wallpaper.revoke_key': null,
  'metadata.save': 'images.edit',
  // Settings tabs (an administrator's page). Every change saves through that tab's own admin API, so each is a review card.
  'settings.save': null, 'settings.ai_runtime': null, 'settings.ai_runtime_check': null, 'settings.kaloscope_requeue': null, 'settings.rating_tier_add': null,
  'settings.mcp_http': null, 'settings.maintenance': null,
  'settings.chat_options': null, 'settings.default_model': null, 'settings.llm_preset': null, 'settings.mcp_server': null, 'settings.mcp_server_draft': null,
  'settings.usage_period': null, 'settings.judge_filter': null,
  'settings.user_profile': 'chat.use', 'settings.flag': 'chat.use', 'settings.routine': null, 'settings.automation_switch': null,
}
/**
 * What running an action does, decided here and never by the page that registers it:
 * - view: moves or opens something (navigation, tabs, selection, opening an editor). Runs right away.
 * - draft: changes inputs on screen without saving. Runs right away; the person can undo it.
 * - commit: saves, registers or otherwise decides. Always a review card the person applies.
 */
export type ChatPageActionTier = 'view' | 'draft' | 'commit'
const COMMIT_ACTIONS = new Set(['prompt.create', 'prompt.update', 'preset.create', 'preset.update', 'wildcard.create', 'wildcard.update', 'comfy.save', 'comfy.register', 'group.create', 'group.update', 'group.auto_collect', 'profile.save', 'profile.assets', 'resource.save', 'wallpaper.save', 'metadata.save', 'posts.save', 'posts.comment', 'workflow.run', 'workflow.schedule_save', 'workflow.schedule_pause', 'workflow.schedule_resume', 'workflow.schedule_run_now', 'workflow.schedule_delete', 'workflow.run_cancel', 'workflow.runs_cleanup', 'sprite.run', 'sprite.stop', 'upload.library', 'posts.delete', 'posts.restore_revision', 'posts.comment_update', 'posts.comment_delete', 'posts.comment_hide', 'posts.bot_cancel', 'posts.category_create', 'posts.category_update', 'posts.category_delete', 'files.name_save', 'files.move_save', 'files.delete', 'files.restore_version', 'files.doc_save', 'settings.save', 'settings.ai_runtime', 'settings.kaloscope_requeue', 'settings.mcp_http', 'settings.maintenance', 'settings.chat_options', 'settings.default_model', 'settings.llm_preset', 'settings.mcp_server', 'settings.user_profile', 'settings.flag', 'settings.routine', 'settings.automation_switch', 'wallpaper.delete_preset', 'wallpaper.save_schedule', 'wallpaper.issue_key', 'wallpaper.revoke_key'])
const VIEW_ACTIONS = new Set(['page.navigate', 'page.refresh', 'prompt.select', 'preset.select', 'wildcard.select', 'comfy.select', 'comfy.refresh', 'comfy.open_create', 'comfy.open_edit', 'workflow.select', 'group.select', 'profile.open_create', 'profile.open_edit', 'profile.section', 'library.search', 'library.history', 'library.open', 'library.select', 'files.open', 'files.preview', 'comfy.check', 'profile.copy', 'resource.open', 'chat.open', 'chat.prepare', 'audio.open', 'audio.filter', 'audio.select', 'sprite.select', 'wallpaper.select', 'wallpaper.open_preset', 'posts.open', 'posts.category', 'posts.tag', 'posts.back', 'posts.new', 'posts.edit', 'audio.project', 'audio.search', 'sprite.download_zip', 'upload.download', 'posts.layout', 'posts.filter', 'posts.body_at', 'files.select', 'files.new_folder', 'files.rename', 'files.move', 'files.new_document', 'files.edit_document', 'files.doc_at', 'settings.ai_runtime_check', 'settings.usage_period', 'settings.judge_filter', 'wallpaper.open_dialog'])
/** View operations that stay inside the open editor, so unsaved changes there do not block them. */
const IN_PLACE_VIEW_ACTIONS = new Set(['comfy.check', 'profile.section', 'library.select', 'resource.open', 'audio.filter', 'audio.select', 'sprite.select', 'wallpaper.select', 'audio.search', 'sprite.download_zip', 'upload.download', 'posts.layout', 'posts.body_at', 'files.select', 'files.new_folder', 'files.rename', 'files.move', 'files.doc_at', 'settings.ai_runtime_check', 'settings.usage_period', 'settings.judge_filter', 'wallpaper.open_dialog'])
export function chatPageActionTier(id: string): ChatPageActionTier {
  return COMMIT_ACTIONS.has(id) ? 'commit' : VIEW_ACTIONS.has(id) ? 'view' : 'draft'
}
/** A view operation that would leave the screen (and lose its unsaved changes). */
export function chatPageActionLeavesScreen(id: string) {
  return chatPageActionTier(id) === 'view' && !IN_PLACE_VIEW_ACTIONS.has(id)
}
export function chatPageActionAllowed(path: string, id: string): boolean {
  if (!own(CHAT_PAGE_ACTION_PERMISSIONS, id)) return false
  if (id.startsWith('page.')) return true
  if (id.startsWith('profile.')) return path === '/settings'
  if (id.startsWith('library.')) return path === '/'
  if (id.startsWith('files.')) return path === '/files'
  if (id.startsWith('resource.') || id.startsWith('lorebook.') || id.startsWith('settings.')) return path === '/settings'
  if (id.startsWith('chat.')) return path === '/chat'
  if (id.startsWith('audio.')) return path === '/audio'
  if (id.startsWith('sprite.')) return path === '/sprite'
  if (id.startsWith('upload.')) return path === '/upload'
  if (id.startsWith('posts.')) return path === '/posts'
  if (id.startsWith('wallpaper.')) return path === '/wallpaper'
  if (id.startsWith('metadata.')) return /^\/images\/[\w.-]+\/metadata$/.test(path)
  if (id.startsWith('prompt.') || id === 'preset.create' || id === 'preset.update' || id === 'preset.select' || id === 'preset.draft') return path === '/prompts'
  if (id.startsWith('wildcard.')) return path === '/wildcards'
  if (id.startsWith('group.')) return /^\/groups(?:\/[\w-]+)?$/.test(path)
  if (id === 'media.attach' || id === 'media.clear' || id === 'preset.insert') return path === '/generation' || /^\/public\/workflows\/[\w-]+$/.test(path)
  if (['comfy.node', 'comfy.refresh', 'comfy.open_create', 'comfy.open_edit', 'comfy.author', 'comfy.register', 'comfy.save', 'comfy.check', 'comfy.suggest_fields'].includes(id)) return path === '/generation' || /^\/public\/workflows\/[\w-]+$/.test(path)
  return path === '/generation'
}
export function normalizeChatPageActions(path: string, input: unknown): ChatPageAction[] {
  if (!Array.isArray(input) || input.length > CHAT_PAGE_ACTION_LIMITS.actions) throw new Error('페이지 작업 목록이 올바르지 않아.')
  const ids = new Set<string>()
  return input.map((raw: ChatPageAction) => {
    if (!chatPageActionAllowed(path, raw?.id) || ids.has(raw.id) || typeof raw.label !== 'string' || !raw.label || raw.label.length > 160 || typeof raw.description !== 'string' || raw.description.length > 1000 || !['draft', 'save'].includes(raw.effect)) throw new Error('등록되지 않았거나 잘못된 페이지 작업이야.')
    ids.add(raw.id)
    if ((raw.effect === 'save') !== COMMIT_ACTIONS.has(raw.id)) throw new Error('작업의 저장 범위가 올바르지 않아.')
    const schema = normalizeChatPageSchema(raw.schema)
    if (schema.type !== 'object') throw new Error('작업 인수는 객체여야 해.')
    return { id: raw.id, label: raw.label, description: raw.description, effect: raw.effect, schema }
  })
}
export function requireChatPageActionState(page: ChatPageSnapshot, proposal: ChatPageActionProposal) {
  if (proposal.expiresAt < Date.now() || page.revision !== proposal.revision) throw new Error('페이지 입력이나 선택이 바뀌었거나 제안이 만료됐어. 다시 요청해줘.')
  const action = page.actions?.find((item) => item.id === proposal.action.id)
  if (!action || JSON.stringify(normalizeChatPageActions(page.path, [action])[0]) !== JSON.stringify(normalizeChatPageActions(page.path, [proposal.action])[0])) throw new Error('현재 페이지에서 사용할 수 없는 작업이야.')
  validateChatPageArguments(action.schema, proposal.arguments)
}
