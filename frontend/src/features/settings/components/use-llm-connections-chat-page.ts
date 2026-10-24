import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentCliName, ChatPageData, LlmPresetRecord, LlmSettings } from '@conai/shared'
import { useI18n } from '@/i18n'
import { useChatPageRegistration, type WorkflowUndo } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { getAgentCliStatus, getAgentCliUsage } from '@/lib/api-agent-cli'
import type { ModelSlot } from '@/lib/api-codex-chat'
import type { ExternalApiProviderRecord } from '@/lib/api-external-api'
import {
  EXTERNAL_MCP_QUERY_KEY, deleteExternalMcpServer, listExternalMcpServers, patchExternalMcpServer, refreshExternalMcpServer, updateExternalMcpServer,
  type ExternalMcpScope, type ExternalMcpServer, type ExternalMcpTransport,
} from '@/lib/api-external-mcp'
import { updateLlmSettings } from '@/lib/api-settings-llm'
import { chatPageText } from '../settings-chat-actions'
import { buildPresetId, LLM_PRESET_SECTIONS, normalizePresetJson } from './llm-connections-tab-utils'

type LlmPresetKind = (typeof LLM_PRESET_SECTIONS)[number]['key']
/** Non-secret fields of a new outside MCP server; the address, command and secrets stay the person's to type. */
export type ExternalMcpDraftSeed = { id: string; name: string; transport: ExternalMcpTransport; scope: ExternalMcpScope; timeoutSeconds: number }

const AGENTS: AgentCliName[] = ['codex', 'claude']
const SCOPES: ExternalMcpScope[] = ['read', 'organize', 'configure']

/** Codex / Claude Code sign-in and subscription limits as one short line each, from the queries the LLM tab already keeps. */
export function useAgentCliChatData(): ChatPageData {
  const codex = useQuery({ queryKey: ['agent-cli-status', 'codex'], queryFn: () => getAgentCliStatus('codex'), retry: false, staleTime: 30_000 })
  const claude = useQuery({ queryKey: ['agent-cli-status', 'claude'], queryFn: () => getAgentCliStatus('claude'), retry: false, staleTime: 30_000 })
  const statuses = { codex: codex.data, claude: claude.data }
  const codexUsage = useQuery({ queryKey: ['agent-cli-usage', 'codex'], queryFn: () => getAgentCliUsage('codex'), enabled: codex.data?.authenticated === true, retry: false, staleTime: 300_000 })
  const claudeUsage = useQuery({ queryKey: ['agent-cli-usage', 'claude'], queryFn: () => getAgentCliUsage('claude'), enabled: claude.data?.authenticated === true, retry: false, staleTime: 300_000 })
  const usages = { codex: codexUsage.data, claude: claudeUsage.data }
  // pi chats' agent runtime: no sign-in, only whether it is there and loads.
  const pi = useQuery({ queryKey: ['agent-cli-status', 'pi'], queryFn: () => getAgentCliStatus('pi'), retry: false, staleTime: 30_000 }).data
  return {
    ...Object.fromEntries(AGENTS.map((agent) => {
      const status = statuses[agent]
      if (!status) return [agent, null]
      if (!status.installed || !status.authenticated) return [agent, status.installed ? 'not signed in' : 'not installed']
      const limits = (usages[agent]?.windows ?? []).map((window) => `${window.window}${window.model ? ` ${window.model}` : ''} ${Math.round(window.usedPercent)}%${window.resetsAt ? ` until ${window.resetsAt}` : ''}`)
      return [agent, limits.length ? `signed in · ${limits.join(' · ')}` : 'signed in']
    })),
    pi: pi ? (!pi.installed ? 'not installed' : pi.message ? `failed to load: ${chatPageText(pi.message)}` : 'ready') : null,
  }
}

/** The full input of a saved server with a few fields changed; secrets keep their stored values (sent by name only). */
function serverInput(server: ExternalMcpServer, patch: { enabled?: boolean; scope?: ExternalMcpScope; timeoutSeconds?: number }) {
  return {
    id: server.id, name: server.name, enabled: patch.enabled ?? server.enabled, transport: server.transport, url: server.url, command: server.command, args: server.args,
    headers: server.headerNames.map((name) => ({ name })), env: server.envNames.map((name) => ({ name })),
    scope: patch.scope ?? server.scope, timeoutSeconds: patch.timeoutSeconds ?? server.timeoutSeconds, disabledTools: server.disabledTools,
  }
}

/**
 * Settings › LLM › 연결 for a connected chat: the connections and their models, the representative models (대표모델) that
 * route each part to one of them, the outside MCP servers and the Codex / Claude Code sign-in. Changes are review cards; connection keys and server secrets
 * never reach the chat. Lists sit at the top of `data`, so a long one shows as a count until read_page_data reads it.
 */
export function useLlmConnectionsChatPage({ providers, slots, onPointRoute, onDraftMcpServer }: {
  providers: ExternalApiProviderRecord[]
  slots: ModelSlot[]
  /** Points a representative model at a model row (null: none, or follow the chat model). */
  onPointRoute: (routeId: number, targetSlotId: number | null) => Promise<unknown>
  onDraftMcpServer: (seed: ExternalMcpDraftSeed | null) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const servers = useQuery({ queryKey: EXTERNAL_MCP_QUERY_KEY, queryFn: listExternalMcpServers }).data ?? []
  const agentCli = useAgentCliChatData()

  const providerName = new Map(providers.map((provider) => [provider.provider_name, provider.display_name || provider.provider_name]))
  const data: Record<string, ChatPageData> = {
    models: slots.filter((slot) => slot.kind === 'model').map((slot) => ({ id: slot.id, connection: providerName.get(slot.providerName) ?? slot.providerName, model: slot.model, ...(slot.ready === false ? { ready: false } : {}) })),
    routes: slots.filter((slot) => slot.kind === 'route').map((slot) => ({ id: slot.id, name: slot.routeName ?? '', ...(slot.routeKey ? { part: slot.routeKey } : {}), target: slot.followsChat ? 'chat' : slot.targetSlotId, ...(slot.prompt ? { hasPrompt: true } : {}) })),
    externalMcp: servers.map((server) => ({
      id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, scope: server.scope, timeoutSeconds: server.timeoutSeconds,
      state: server.enabled ? server.status.state : 'off', ...(server.status.state === 'error' ? { error: chatPageText(server.status.error) } : {}),
      tools: server.status.tools.slice(0, 40).map((tool) => (tool.enabled ? tool.remoteName : `${tool.remoteName} (off)`)),
    })),
    agentCli,
  }

  const actions = [
    ...(slots.length ? [
      pageAction('settings.default_model', t({ ko: '대표모델 대상 바꾸기', en: 'Point a representative model' }), t({
        ko: 'data.routes의 대표모델 하나(routeId, 없으면 대화)가 data.models의 id 하나(slotId)를 가리키게 해. 그 대표모델을 고른 곳이 모두 따라가. slotId 0 = 비움(요약·답장 추천은 대화 따라감, 번역·판단은 없음).',
        en: 'Point one representative model of data.routes (routeId, default the chat one) at one id of data.models (slotId); everything that picked it follows. slotId 0 clears it (summary and suggestions then follow chat, translation and judge are none).',
      }), pageObject({ routeId: pageNumber(1, undefined, true), slotId: pageNumber(0, undefined, true) }, ['slotId']), 'save'),
      pageAction('settings.default_judge', t({ ko: '판단 대표모델 바꾸기', en: 'Point the judge representative model' }), t({ ko: '판단 대표모델이 data.models의 id 하나를 가리키게 해(on false = 비움). 모델을 따로 고르지 않은 판단·게시판 평가·주제 관련도가 이걸 써.', en: 'Point the judge representative model at one id of data.models (on false clears it). Judges, board evaluations and topic relevance without a model of their own use it.' }), pageObject({ slotId: pageNumber(1, undefined, true), on: { type: 'boolean' } }, ['slotId']), 'save'),
    ] : []),
    ...(servers.length ? [pageAction('settings.mcp_server', t({ ko: '외부 MCP 서버 바꾸기', en: 'Change an outside MCP server' }), t({
      ko: 'data.externalMcp 서버 하나. update: enabled·scope(프로필 도구 범위에 있어야 씀)·제한 시간·도구별 켜기. reconnect: 다시 연결. remove: 삭제. 주소·명령·비밀은 사람이 바꿔.',
      en: 'One server of data.externalMcp. update: enabled, scope (profiles need it), timeout, per-tool switches. reconnect. remove. Address, command and secrets stay with a person.',
    }), pageObject({
      server: pageChoice(servers.map((server) => server.id)), operation: pageChoice(['update', 'reconnect', 'remove']),
      enabled: { type: 'boolean' }, scope: pageChoice(SCOPES), timeoutSeconds: pageNumber(5, 600, true),
      tools: pageArray(pageObject({ name: pageText(200), enabled: { type: 'boolean' } }, ['name', 'enabled']), 200),
    }, ['server', 'operation']), 'save')] : []),
    pageAction('settings.mcp_server_draft', t({ ko: '외부 MCP 서버 추가 편집기 열기', en: 'Open the add-server editor' }), t({
      ko: '추가 편집기를 이름·ID(영소문자·숫자 16자)·방식·범위·제한 시간으로 채워 열어. 주소·명령·비밀 값은 사람이 넣고 저장해.',
      en: 'Open the add editor filled with name, id (lowercase letters and digits, 16 max), transport, scope, timeout. A person types the address or command and secrets, then saves.',
    }), pageObject({ id: pageText(16), name: pageText(60), transport: pageChoice(['http', 'stdio']), scope: pageChoice(SCOPES), timeoutSeconds: pageNumber(5, 600, true) }, ['id', 'name', 'transport'])),
  ]

  const changeServer = async (args: Record<string, ChatPageData>) => {
    const server = servers.find((entry) => entry.id === args.server)
    if (!server) throw new Error('목록에 없는 외부 MCP 서버야.')
    if (args.operation === 'remove') await deleteExternalMcpServer(server.id)
    else if (args.operation === 'reconnect') {
      if (!server.enabled) throw new Error('꺼진 서버야. 먼저 켜줘.')
      await refreshExternalMcpServer(server.id)
    } else {
      const tools = Array.isArray(args.tools) ? args.tools as Array<{ name: string; enabled: boolean }> : []
      const known = new Set(server.status.tools.map((tool) => tool.remoteName))
      const unknown = tools.find((tool) => !known.has(tool.name))
      if (unknown) throw new Error(`이 서버에 없는 도구야: ${unknown.name}`)
      const configChanged = typeof args.scope === 'string' || typeof args.timeoutSeconds === 'number'
      if (configChanged) {
        await updateExternalMcpServer(server.id, serverInput(server, {
          enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
          scope: typeof args.scope === 'string' ? args.scope as ExternalMcpScope : undefined,
          timeoutSeconds: typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : undefined,
        }))
      } else if (typeof args.enabled === 'boolean') await patchExternalMcpServer(server.id, { enabled: args.enabled })
      for (const tool of tools) await patchExternalMcpServer(server.id, { tool: { remoteName: tool.name, enabled: tool.enabled } })
      if (!configChanged && typeof args.enabled !== 'boolean' && tools.length === 0) throw new Error('바꿀 항목이 없어.')
    }
    await queryClient.invalidateQueries({ queryKey: EXTERNAL_MCP_QUERY_KEY })
  }

  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '설정 · LLM 연결', en: 'Settings · LLM connections' }), resourceId: 'llm', priority: 5, fields: [], data, actions,
    apply: () => {},
    applyAction: async (id, args, assertCurrent): Promise<WorkflowUndo | void> => {
      assertCurrent()
      const modelOf = (slotId: ChatPageData) => {
        const slot = slots.find((entry) => entry.kind === 'model' && entry.id === slotId)
        if (!slot) throw new Error('data.models에 없는 모델이야.')
        return slot.id
      }
      if (id === 'settings.default_model') {
        const route = typeof args.routeId === 'number' ? slots.find((entry) => entry.kind === 'route' && entry.id === args.routeId) : slots.find((entry) => entry.routeKey === 'chat')
        if (!route) throw new Error('data.routes에 없는 대표모델이야.')
        await onPointRoute(route.id, args.slotId === 0 ? null : modelOf(args.slotId))
        return
      }
      if (id === 'settings.default_judge') {
        const route = slots.find((entry) => entry.routeKey === 'judge')
        if (!route) throw new Error('판단 대표모델이 없어.')
        await onPointRoute(route.id, args.on === false ? null : modelOf(args.slotId))
        return
      }
      if (id === 'settings.mcp_server') return changeServer(args)
      if (id === 'settings.mcp_server_draft') {
        const seed: ExternalMcpDraftSeed = {
          id: String(args.id).toLowerCase(), name: String(args.name), transport: args.transport as ExternalMcpTransport,
          scope: (args.scope as ExternalMcpScope | undefined) ?? 'read', timeoutSeconds: typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : 60,
        }
        onDraftMcpServer(seed)
        return { isCurrent: () => true, restore: () => onDraftMcpServer(null) }
      }
      throw new Error('이 화면에 없는 작업이야.')
    },
  }, { preserveOnSearchChange: true })
}

/** Settings › LLM › 프롬프트 for a connected chat: the workflow text presets of each kind, and saving or deleting one. */
export function useLlmPromptPresetsChatPage(presets: Pick<LlmSettings, LlmPresetKind>) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const presetKinds = LLM_PRESET_SECTIONS.map((section) => section.key)
  const data: Record<string, ChatPageData> = Object.fromEntries(presetKinds.map((kind) => [kind, presets[kind].map((preset) => ({ id: preset.id, name: preset.name, content: chatPageText(preset.content, 300) }))]))

  const savePreset = async (args: Record<string, ChatPageData>) => {
    const kind = args.kind as LlmPresetKind
    const section = LLM_PRESET_SECTIONS.find((entry) => entry.key === kind)
    const current = presets[kind]
    const existing = typeof args.id === 'string' && args.id ? current.find((preset) => preset.id === args.id) : undefined
    if (typeof args.id === 'string' && args.id && !existing) throw new Error('목록에 없는 프리셋이야.')
    let next: LlmPresetRecord[]
    if (args.operation === 'delete') {
      if (!existing) throw new Error('지울 프리셋의 id가 필요해.')
      next = current.filter((preset) => preset.id !== existing.id)
    } else {
      const name = (typeof args.name === 'string' ? args.name : existing?.name ?? '').trim()
      let content = typeof args.content === 'string' ? args.content : existing?.content ?? ''
      if (!name || !content.trim()) throw new Error('프리셋 이름과 내용이 필요해.')
      if (section?.expectsJson) {
        try { content = normalizePresetJson(content) } catch { throw new Error('구조화 출력 프리셋의 내용은 JSON이어야 해.') }
      }
      if (current.some((preset) => preset.id !== existing?.id && preset.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`같은 이름의 프리셋이 이미 있어: ${name}`)
      const now = new Date().toISOString()
      const record: LlmPresetRecord = { id: existing?.id ?? buildPresetId(), name, content, createdAt: existing?.createdAt ?? now, updatedAt: now }
      next = existing ? current.map((preset) => (preset.id === existing.id ? record : preset)) : [...current, record]
    }
    queryClient.setQueryData(['app-settings'], await updateLlmSettings({ [kind]: next } as Partial<LlmSettings>))
    void queryClient.invalidateQueries({ queryKey: ['llm-preset-options'] })
  }

  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '설정 · 워크플로 프롬프트', en: 'Settings · Workflow prompts' }), resourceId: 'llm', priority: 5, fields: [], data,
    actions: [pageAction('settings.llm_preset', t({ ko: 'LLM 프리셋 저장·삭제', en: 'Save or delete an LLM preset' }), t({
      ko: 'kind 목록(data의 같은 이름)의 프리셋. save: id 있으면 수정, 없으면 추가(name·content). structuredOutputJsonPresets 내용은 JSON.',
      en: 'A preset of the kind list (same key in data). save: with id edits, without adds (name, content). structuredOutputJsonPresets content is JSON.',
    }), pageObject({ kind: pageChoice(presetKinds), operation: pageChoice(['save', 'delete']), id: pageText(80), name: pageText(120), content: pageText(20000) }, ['kind', 'operation']), 'save')],
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id !== 'settings.llm_preset') throw new Error('이 화면에 없는 작업이야.')
      await savePreset(args)
    },
  }, { preserveOnSearchChange: true })
}
