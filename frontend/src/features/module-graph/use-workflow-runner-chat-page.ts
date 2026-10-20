import { copyChatPageData, isPrivateChatPageKey, libraryImageRef, type ChatPageField } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction } from '@/features/codex-chat/page-action-helpers'
import type { GraphExecutionRecord, GraphWorkflowExposedInput, GraphWorkflowRecord } from '@/lib/api-module-graph'
import { useI18n } from '@/i18n'
import { getImageDraftRevision } from '@/features/image-generation/image-generation-shared'

type RunnerChat = {
  graph: GraphWorkflowRecord | null
  definitions: GraphWorkflowExposedInput[]
  values: Record<string, unknown>
  change: (id: string, value: unknown) => void
  clear: (id: string) => void
  enabled: boolean
  /** The Run button would work now (permission, validation and no run being requested). */
  canRun: boolean
  run: () => void
  /** The selected workflow's newest runs, newest first. */
  recentRuns: GraphExecutionRecord[]
}

const isImageInput = (input: GraphWorkflowExposedInput) => input.data_type === 'image' || input.data_type === 'mask'
const imageHash = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { composite_hash?: unknown }).composite_hash === 'string' ? (value as { composite_hash: string }).composite_hash : ''
const empty = (value: unknown) => value === undefined || value === null || value === ''

export function useWorkflowRunnerChatPage({ graph, definitions, values, change, clear, enabled, canRun, run, recentRuns }: RunnerChat) {
  const { t } = useI18n()
  const fields: ChatPageField[] = []
  for (const input of definitions) {
    if (fields.length >= 64 || isPrivateChatPageKey(`${input.id}.${input.port_key}.${input.label}`) || ['audio', 'video'].includes(input.data_type)) continue
    const value = Object.hasOwn(values, input.id) ? values[input.id] : input.default_value ?? ''
    // Images run from the library: the field holds the picked image's composite hash.
    if (isImageInput(input)) { fields.push({ id: input.id, label: input.label, type: 'text', value: imageHash(value), allowEmpty: true }); continue }
    try {
      const safe = copyChatPageData(value)
      const json = input.data_type === 'json' || (safe !== null && typeof safe === 'object' && !Array.isArray(safe))
      const display = json ? JSON.stringify(safe) : safe ?? ''
      if (typeof display !== 'string' && typeof display !== 'number' && typeof display !== 'boolean' && !(Array.isArray(display) && display.every((part) => typeof part === 'string'))) continue
      fields.push({ id: input.id, label: input.label, type: input.options?.length && input.options.length <= 100 ? 'select' : input.data_type === 'boolean' ? 'boolean' : input.data_type === 'number' ? 'number' : 'text', value: display, ...(input.options?.length && input.options.length <= 100 ? { options: input.options } : {}) })
    } catch { /* Protected composite inputs stay in their ordinary native widget. */ }
  }
  const runs = recentRuns.slice(0, 5).map((execution) => ({
    id: execution.id, status: execution.status, trigger: execution.trigger_type ?? null,
    ...(execution.queue_position ? { queuePosition: execution.queue_position } : {}),
    created: execution.created_date, ...(execution.completed_at ? { completed: execution.completed_at } : {}),
    ...(execution.error_message ? { error: execution.error_message.slice(0, 120) } : {}),
  }))
  useChatPageRegistration(graph && enabled ? {
    kind: 'workflow_runner', title: t({ ko: '워크플로 실행 입력 · {name}', en: 'Workflow run inputs · {name}' }, { name: graph.name }).slice(0, 160), resourceId: String(graph.id), priority: 10, fields,
    localRevision: getImageDraftRevision(values),
    data: { selected: { id: graph.id, name: graph.name, description: graph.description ?? '', nodeCount: graph.graph.nodes.length, edgeCount: graph.graph.edges.length }, runs },
    actions: [pageAction('workflow.run', t({ ko: '워크플로 실행', en: 'Run workflow' }), t({ ko: '현재 입력으로 실행. 결과는 get_graph_workflow_execution.', en: 'Run with the current inputs. Results: get_graph_workflow_execution.' }), undefined, 'save')],
    apply: (patch) => {
      const parsed = Object.entries(patch).map(([id, value]) => {
        const input = definitions.find((item) => item.id === id)!
        if (isImageInput(input)) return [id, String(value).trim() ? libraryImageRef(input, value) : undefined] as const
        if (input.options?.length && !input.options.includes(String(value))) throw new Error('실행 입력의 선택 목록에 없는 값이야.')
        return [id, input.data_type === 'json' ? copyChatPageData(JSON.parse(String(value))) : value] as const
      })
      for (const [id, value] of parsed) {
        if (value === undefined) clear(id)
        else change(id, value)
      }
    },
    applyAction: (id, _args, assertCurrent) => {
      if (id !== 'workflow.run') throw new Error('등록되지 않은 실행 작업이야.')
      assertCurrent()
      const missing = definitions.find((input) => input.required && empty(Object.hasOwn(values, input.id) ? values[input.id] : input.default_value))
      if (missing) throw new Error(`필수 입력 '${missing.label}' 값을 먼저 넣어줘.`)
      if (!canRun) throw new Error('지금은 이 워크플로를 실행할 수 없어. 권한이나 노드 검사 결과를 확인해줘.')
      run()
    },
  } : null)
}
