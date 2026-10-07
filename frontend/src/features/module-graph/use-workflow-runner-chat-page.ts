import { copyChatPageData, isPrivateChatPageKey, type ChatPageField } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import type { GraphWorkflowExposedInput, GraphWorkflowRecord } from '@/lib/api-module-graph'
import { useI18n } from '@/i18n'

export function useWorkflowRunnerChatPage(graph: GraphWorkflowRecord | null, definitions: GraphWorkflowExposedInput[], values: Record<string, unknown>, change: (id: string, value: unknown) => void, enabled: boolean) {
  const { t } = useI18n()
  const fields: ChatPageField[] = []
  for (const input of definitions) {
    if (fields.length >= 64 || isPrivateChatPageKey(`${input.id}.${input.port_key}.${input.label}`) || ['image', 'mask', 'audio', 'video'].includes(input.data_type)) continue
    const value = Object.hasOwn(values, input.id) ? values[input.id] : input.default_value ?? ''
    try {
      const safe = copyChatPageData(value)
      const json = input.data_type === 'json' || (safe !== null && typeof safe === 'object' && !Array.isArray(safe))
      const display = json ? JSON.stringify(safe) : safe ?? ''
      if (typeof display !== 'string' && typeof display !== 'number' && typeof display !== 'boolean' && !(Array.isArray(display) && display.every((part) => typeof part === 'string'))) continue
      fields.push({ id: input.id, label: input.label, type: input.options?.length && input.options.length <= 100 ? 'select' : input.data_type === 'boolean' ? 'boolean' : input.data_type === 'number' ? 'number' : 'text', value: display, ...(input.options?.length && input.options.length <= 100 ? { options: input.options } : {}) })
    } catch { /* Protected composite inputs stay in their ordinary native widget. */ }
  }
  useChatPageRegistration(graph && enabled ? {
    kind: 'workflow_runner', title: t({ ko: '워크플로 실행 입력 · {name}', en: 'Workflow run inputs · {name}' }, { name: graph.name }).slice(0, 160), resourceId: String(graph.id), priority: 10, fields,
    localRevision: JSON.stringify(values), data: { selected: { id: graph.id, name: graph.name, description: graph.description ?? '', nodeCount: graph.graph.nodes.length, edgeCount: graph.graph.edges.length } },
    apply: (patch) => {
      const parsed = Object.entries(patch).map(([id, value]) => {
        const input = definitions.find((item) => item.id === id)!
        if (input.options?.length && !input.options.includes(String(value))) throw new Error('실행 입력의 선택 목록에 없는 값이야.')
        return [id, input.data_type === 'json' ? copyChatPageData(JSON.parse(String(value))) : value] as const
      })
      for (const [id, value] of parsed) change(id, value)
    },
  } : null)
}
