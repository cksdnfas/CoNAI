import { copyChatPageData, isPrivateChatPageKey, libraryImageRef, type ChatPageField } from '@conai/shared'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageNumber, pageObject } from '@/features/codex-chat/page-action-helpers'
import { cancelGraphExecution } from '@/lib/api-module-graph'
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
  run: () => Promise<boolean>
  running: boolean
  refresh: () => Promise<unknown>
  /** The selected workflow's newest runs, newest first. */
  recentRuns: GraphExecutionRecord[]
}

const isImageInput = (input: GraphWorkflowExposedInput) => input.data_type === 'image' || input.data_type === 'mask'
const imageHash = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { composite_hash?: unknown }).composite_hash === 'string' ? (value as { composite_hash: string }).composite_hash : ''
const empty = (value: unknown) => value === undefined || value === null || value === ''

export function useWorkflowRunnerChatPage({ graph, definitions, values, change, clear, enabled, canRun, run, running, refresh, recentRuns }: RunnerChat) {
  const { t } = useI18n()
  const fields: ChatPageField[] = []
  for (const input of definitions) {
    if (fields.length >= 64 || isPrivateChatPageKey(`${input.id}.${input.port_key}.${input.label}`)) continue
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
  const active = recentRuns.filter((execution) => execution.status === 'queued' || execution.status === 'running')
  const runs = { active: active.slice(0, 100).map((execution) => ({ id: execution.id, status: execution.status })), finished: recentRuns.filter((execution) => execution.status !== 'queued' && execution.status !== 'running').slice(0, 5).map((execution) => ({ id: execution.id, status: execution.status })) }
  useChatPageRegistration(graph && enabled ? {
    kind: 'workflow_runner', title: t({ ko: '워크플로 실행 입력 · {name}', en: 'Workflow run inputs · {name}' }, { name: graph.name }).slice(0, 160), resourceId: String(graph.id), priority: 10, fields,
    localRevision: getImageDraftRevision(values),
    data: { selected: { id: graph.id, version: graph.version, name: graph.name, description: graph.description ?? '', nodeCount: graph.graph.nodes.length, edgeCount: graph.graph.edges.length }, running, runs },
    actions: [
      pageAction('workflow.run', t({ ko: '워크플로 실행', en: 'Run workflow' }), t({ ko: '현재 입력으로 실행. 결과는 get_graph_workflow_execution.', en: 'Run with the current inputs. Results: get_graph_workflow_execution.' }), undefined, 'save', {}),
      ...(active.length ? [pageAction('workflow.run_cancel', t({ ko: '실행 취소', en: 'Cancel runs' }), '', pageObject({ executionIds: pageArray(pageNumber(1, undefined, true), 100, 1) }, ['executionIds']), 'save')] : []),
    ],
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
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'workflow.run_cancel') {
        const ids = args.executionIds as number[]
        if (!ids.length || ids.some((executionId) => !active.some((execution) => execution.id === executionId))) throw new Error('취소할 실행이 바뀌었어.')
        const results = await Promise.allSettled(ids.map((executionId) => cancelGraphExecution(executionId)))
        const failures = results.flatMap((result, index) => {
          if (result.status === 'rejected') return [`#${ids[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
          return result.value.success ? [] : [`#${ids[index]}: ${result.value.message}`]
        })
        try {
          await refresh()
        } catch (error) {
          if (failures.length) throw new Error(`${t({ ko: '취소 실패', en: 'Cancellation failed' })}: ${failures.join(', ')}; ${t({ ko: '새로고침 실패', en: 'Refresh failed' })}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
          throw error
        }
        if (failures.length) throw new Error(`${t({ ko: '취소 실패', en: 'Cancellation failed' })}: ${failures.join(', ')}`)
        return
      }
      if (id !== 'workflow.run') throw new Error('등록되지 않은 실행 작업이야.')
      const missing = definitions.find((input) => input.required && empty(Object.hasOwn(values, input.id) ? values[input.id] : input.default_value))
      if (missing) throw new Error(`필수 입력 '${missing.label}' 값을 먼저 넣어줘.`)
      if (!canRun) throw new Error('지금은 이 워크플로를 실행할 수 없어. 권한이나 노드 검사 결과를 확인해줘.')
      if (!await run()) throw new Error('워크플로 실행을 시작하지 못했어.')
    },
  } : null)
}
