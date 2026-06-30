import type {
  GraphWorkflowExposedInput,
  ModuleDefinitionRecord,
} from '@/lib/api-module-graph'
import type { TranslationInput, TranslationParams } from '@/i18n'
import type { AppSettings } from '@/types/settings'
import { hasMeaningfulValue } from './components/module-graph-field-shared'
import type { WorkflowValidationIssue } from './components/workflow-validation-panel'
import { isFinalResultModule } from './module-graph-module-helpers'

export type ValidationNodeRecord = {
  id: string
  module: ModuleDefinitionRecord | null
  inputValues: Record<string, unknown>
  disabled?: boolean
}

export type ValidationEdgeRecord = {
  targetNodeId: string
  targetPortKey: string
}

type ValidationTranslator = (input: TranslationInput, params?: TranslationParams) => string

/** Build one canonical workflow-exposed-input id from node and port keys. */
export function buildWorkflowExposedInputId(nodeId: string, portKey: string) {
  return `${nodeId}:${portKey}`
}

/** Resolve system capability validation issues from current application settings. */
function resolveSystemCapabilityIssue(module: ModuleDefinitionRecord, translate: ValidationTranslator, settings?: AppSettings | null) {
  if (module.engine_type !== 'system' || !settings) {
    return null
  }

  const operationKey = typeof module.internal_fixed_values?.operation_key === 'string'
    ? module.internal_fixed_values.operation_key
    : typeof module.template_defaults?.operation_key === 'string'
      ? module.template_defaults.operation_key
      : null

  if (operationKey === 'system.extract_tags_from_image' && !settings.tagger.enabled) {
    return translate({ ko: 'WD Tagger 기능이 비활성화돼 있어.', en: 'WD Tagger is disabled.' })
  }

  if (operationKey === 'system.extract_artist_from_image' && !settings.kaloscope.enabled) {
    return translate({ ko: 'Kaloscope 기능이 비활성화돼 있어.', en: 'Kaloscope is disabled.' })
  }

  return null
}

/** Build validation issues for one workflow graph based on nodes, edges, and runtime inputs. */
export function buildWorkflowValidationIssues(params: {
  nodes: ValidationNodeRecord[]
  edges: ValidationEdgeRecord[]
  exposedInputs: GraphWorkflowExposedInput[]
  runtimeInputValues?: Record<string, unknown>
  settings?: AppSettings | null
  translate: ValidationTranslator
}) {
  const { nodes, edges, exposedInputs, runtimeInputValues = {}, settings, translate } = params
  const issues: WorkflowValidationIssue[] = []
  const connectedInputMap = new Map<string, Set<string>>()
  const connectedInputCountMap = new Map<string, Map<string, number>>()
  const exposedInputMap = new Map(exposedInputs.map((inputDefinition) => [buildWorkflowExposedInputId(inputDefinition.node_id, inputDefinition.port_key), inputDefinition]))

  for (const edge of edges) {
    const current = connectedInputMap.get(edge.targetNodeId) ?? new Set<string>()
    current.add(edge.targetPortKey)
    connectedInputMap.set(edge.targetNodeId, current)

    const nodeCounts = connectedInputCountMap.get(edge.targetNodeId) ?? new Map<string, number>()
    nodeCounts.set(edge.targetPortKey, (nodeCounts.get(edge.targetPortKey) ?? 0) + 1)
    connectedInputCountMap.set(edge.targetNodeId, nodeCounts)
  }

  const activeNodes = nodes.filter((node) => node.disabled !== true)
  const finalResultNodes = activeNodes.filter((node) => node.module && isFinalResultModule(node.module))
  if (finalResultNodes.length === 0) {
    issues.push({
      id: 'missing-final-result-node',
      nodeLabel: translate({ ko: '워크플로우', en: 'Workflow' }),
      severity: 'error',
      activationState: 'final-result-required',
      title: translate({ ko: '최종 결과 노드가 없어', en: 'No final-result node' }),
      detail: translate({ ko: '실행 결과를 최종 결과로 확정하려면 최종 결과 시스템 노드를 최소 하나 추가해줘.', en: 'Add at least one final-result system node to finalize execution output.' }),
    })
  }

  for (const node of activeNodes) {
    const nodeLabel = node.module?.name ?? translate({ ko: '알 수 없는 모듈', en: 'Unknown module' })

    if (!node.module) {
      issues.push({
        id: `missing-module:${node.id}`,
        nodeId: node.id,
        nodeLabel,
        severity: 'error',
        activationState: 'definition-missing',
        title: translate({ ko: '모듈 정의를 찾지 못했어', en: 'Could not find the module definition' }),
        detail: translate({ ko: '이 노드가 참조하는 모듈이 현재 목록에 없어. 저장된 워크플로우와 모듈 카탈로그를 확인해봐.', en: 'The module referenced by this node is missing from the current list. Check the saved workflow and module catalog.' }),
      })
      continue
    }

    const capabilityIssue = resolveSystemCapabilityIssue(node.module, translate, settings)
    if (capabilityIssue) {
      issues.push({
        id: `capability:${node.id}`,
        nodeId: node.id,
        nodeLabel,
        severity: 'error',
        activationState: 'system-capability-disabled',
        title: translate({ ko: '시스템 기능이 비활성화돼 있어', en: 'A system capability is disabled' }),
        detail: capabilityIssue,
      })
    }

    const connectedInputKeys = connectedInputMap.get(node.id) ?? new Set<string>()
    const connectedInputCounts = connectedInputCountMap.get(node.id) ?? new Map<string, number>()

    if (isFinalResultModule(node.module)) {
      const finalInputCount = connectedInputCounts.get('value') ?? 0
      if (finalInputCount === 0) {
        issues.push({
          id: `final-result-unconnected:${node.id}`,
          nodeId: node.id,
          portKey: 'value',
          nodeLabel,
          severity: 'error',
          activationState: 'missing-required-input',
          title: translate({ ko: '최종 결과 노드 입력이 비어 있어', en: 'The final-result node input is empty' }),
          detail: translate({ ko: '최종 결과 노드는 값 입력에 최종 결과로 확정할 업스트림 출력을 정확히 1개 연결해야 해.', en: 'A final-result node must have exactly one upstream output connected to its value input.' }),
        })
      } else if (finalInputCount > 1) {
        issues.push({
          id: `final-result-multi-input:${node.id}`,
          nodeId: node.id,
          portKey: 'value',
          nodeLabel,
          severity: 'error',
          activationState: 'missing-required-input',
          title: translate({ ko: '최종 결과 노드에 입력이 너무 많아', en: 'The final-result node has too many inputs' }),
          detail: translate({ ko: '최종 결과 노드는 값 입력에 업스트림 출력을 1개만 연결할 수 있어.', en: 'A final-result node can only accept one upstream output on its value input.' }),
        })
      }
    }
    for (const port of node.module.exposed_inputs ?? []) {
      if (!port.required) {
        continue
      }

      const exposedInput = exposedInputMap.get(buildWorkflowExposedInputId(node.id, port.key))
      const runtimeValue = exposedInput ? runtimeInputValues[exposedInput.id] : undefined
      const hasConnectedValue = connectedInputKeys.has(port.key)
        || hasMeaningfulValue(node.inputValues?.[port.key])
        || hasMeaningfulValue(port.default_value)
        || hasMeaningfulValue(exposedInput?.default_value)
      const hasRuntimeValue = hasMeaningfulValue(runtimeValue)

      if (hasConnectedValue || hasRuntimeValue) {
        continue
      }

      issues.push({
        id: `missing-input:${node.id}:${port.key}`,
        nodeId: node.id,
        portKey: port.key,
        nodeLabel,
        severity: exposedInput ? 'warning' : 'error',
        activationState: exposedInput ? 'runtime-input-waiting' : 'missing-required-input',
        title: `${exposedInput ? translate({ ko: '실행 입력 대기', en: 'Runtime input waiting' }) : translate({ ko: '필수 입력 누락', en: 'Required input missing' })} · ${port.label}`,
        detail: exposedInput
          ? translate({ ko: '{label} ({key}) 입력은 노드 카드에서도 실행 입력 대기 상태로 표시돼. 저장은 가능하지만 실행 전 값 확인이 필요해.', en: 'The {label} ({key}) input is also shown as runtime-input waiting on the node card. Saving is allowed, but you should confirm the value before execution.' }, { label: port.label, key: port.key })
          : translate({ ko: '{label} ({key}) 입력이 연결되지 않았고 값도 비어 있어. 이 상태로는 실행 경로가 고립돼.', en: 'The {label} ({key}) input is not connected and has no value. In this state, the execution path is isolated.' }, { label: port.label, key: port.key }),
      })
    }
  }

  return issues
}
