import { Badge } from '@/components/ui/badge'
import { Eraser } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { LlmPresetOptionCollections, LlmPresetOptionRecord } from '@/lib/api-settings-llm'
import type { GraphExecutionArtifactRecord, ModulePortDefinition } from '@/lib/api-module-graph'
import { hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import { TechnicalReferenceHint, getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { compareGraphArtifactsNewestFirst, getModuleNodeDisplayLabel, getVisibleModuleOutputPorts, isAdvancedOutputPortsEnabled, normalizeModulePortDescription, parseHandleId, type ModuleGraphNode } from '../module-graph-shared'

export type ResolvedEdgeEndpoint = {
  node: ModuleGraphNode | null
  port: ModulePortDefinition | null
  portKey: string | null
}

export type NodeOutputArtifactGroup = {
  portKey: string
  portLabel: string
  portType: ModulePortDefinition['data_type'] | null
  artifacts: GraphExecutionArtifactRecord[]
}

export type LlmPresetCollectionKey = keyof LlmPresetOptionCollections

export function getLlmPresetTypeOptions(t: ReturnType<typeof useI18n>['t']): Array<{ value: LlmPresetCollectionKey; label: string }> {
  return [
    { value: 'systemPromptPresets', label: t({ ko: '시스템 프롬프트', en: 'System prompt' }) },
    { value: 'promptPresets', label: t({ ko: '프롬프트', en: 'Prompt' }) },
    { value: 'structuredOutputJsonPresets', label: t({ ko: '구조화 출력 JSON', en: 'Structured output JSON' }) },
  ]
}

// Flat: inputs are hairline rows, edge / node blocks have no surface.
export const NODE_INSPECTOR_INPUT_SURFACE_CLASS = 'space-y-2 border-b border-line py-3 last:border-b-0'
export const NODE_INSPECTOR_EDGE_SURFACE_CLASS = 'space-y-3'
export const NODE_INSPECTOR_NODE_SURFACE_CLASS = 'min-w-0'

export function normalizeLlmPresetType(value: unknown): LlmPresetCollectionKey {
  return value === 'systemPromptPresets' || value === 'structuredOutputJsonPresets'
    ? value
    : 'promptPresets'
}

export function getLlmPresetEntries(collections: LlmPresetOptionCollections | undefined, presetType: LlmPresetCollectionKey) {
  return [...(collections?.[presetType] ?? [])]
    .filter((preset): preset is LlmPresetOptionRecord => Boolean(preset?.name?.trim()))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

export function summarizeLlmPresetContent(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 220 ? `${normalized.slice(0, 219)}…` : normalized
}

/** Resolve whether one node input is already satisfied by a connection or value. */
export function isNodeInputSatisfied(node: ModuleGraphNode, port: ModulePortDefinition) {
  const connectedInputKeys = new Set(node.data.connectedInputKeys ?? [])
  return connectedInputKeys.has(port.key) || hasMeaningfulValue(node.data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)
}

/** Find optional UI-schema metadata for one node input port. */
export function findNodeUiField(node: ModuleGraphNode, portKey: string) {
  return node.data.module.ui_schema?.find((field) => field.key === portKey)
}

/** Render compact badges for one module port so graph and inspector use the same nouns. */
export function PortBadges({ port, missingRequired = false }: { port: ModulePortDefinition; missingRequired?: boolean }) {
  const { t } = useI18n()

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge variant="outline">{getModuleGraphPortTypeLabel(t, port.data_type)}</Badge>
      {port.required ? <Badge variant="outline">{t({ ko: '필수', en: 'Required' })}</Badge> : null}
      {missingRequired ? <Badge variant="secondary">{t({ ko: '입력 필요', en: 'Input required' })}</Badge> : null}
      {port.multiple ? <Badge variant="outline">{t({ ko: '다중', en: 'Multiple' })}</Badge> : null}
    </div>
  )
}

/** Render the shared heading block for an editable node port. */
export function PortHeader({
  nodeId,
  port,
  hasExplicitValue,
  missingRequired,
  onClear,
}: {
  nodeId: string
  port: ModulePortDefinition
  hasExplicitValue: boolean
  missingRequired: boolean
  onClear: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <Tip content={normalizeModulePortDescription(port.description)}>
            <div className="text-sm font-medium text-foreground">{port.label}</div>
          </Tip>
          <TechnicalReferenceHint title={`node ${nodeId}\nport ${port.key}`} label={t({ ko: '포트 내부 키 보기', en: 'Show internal port key' })} />
        </div>
        <PortBadges port={port} missingRequired={missingRequired} />
      </div>
      <IconButton size="icon-sm" variant="ghost" onClick={onClear} disabled={!hasExplicitValue} label={t({ ko: '값 지우기', en: 'Clear value' })}>
        <Eraser />
      </IconButton>
    </div>
  )
}

export function isConfigOnlyNodeField(node: ModuleGraphNode, fieldKey: string) {
  const uiField = findNodeUiField(node, fieldKey)
  const port = (node.data.module.exposed_inputs ?? []).find((inputPort) => inputPort.key === fieldKey)
  const value = node.data.inputValues?.[fieldKey] ?? port?.default_value ?? uiField?.default_value
  return isPowerLoraLoaderUiField(uiField) || hasPowerLoraLoaderEntries(value)
}

export function getEditableNodeInputPorts(node: ModuleGraphNode) {
  return (node.data.module.exposed_inputs ?? []).filter((port) => !isConfigOnlyNodeField(node, port.key))
}

/** Find editable UI-only fields that are not backed by module input ports. */
export function getStandaloneNodeUiFields(node: ModuleGraphNode) {
  const portKeys = new Set((node.data.module.exposed_inputs ?? []).map((port) => port.key))
  return (node.data.module.ui_schema ?? []).filter((field) => !portKeys.has(field.key) || isConfigOnlyNodeField(node, field.key))
}

/** Resolve a selected edge endpoint back into its node and module port metadata. */
export function resolveEdgeEndpoint(nodes: ModuleGraphNode[], nodeId: string, handleId: string | null | undefined, direction: 'in' | 'out'): ResolvedEdgeEndpoint {
  const node = nodes.find((item) => item.id === nodeId) ?? null
  const parsedHandle = parseHandleId(handleId)
  const portKey = parsedHandle?.portKey ?? null

  if (!node || !portKey) {
    return { node, port: null, portKey }
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  const port = portList.find((item) => item.key === portKey) ?? null

  return {
    node,
    port,
    portKey,
  }
}

/** Render an edge endpoint summary so selected connections are understandable without raw handle ids. */
export function EdgeEndpointCard({
  heading,
  endpoint,
  role,
}: {
  heading: string
  endpoint: ResolvedEdgeEndpoint
  role: string
}) {
  const { t } = useI18n()

  return (
    <Panel tone="container" padding="none" className="px-3 py-3">
      <Text as="div" variant="overline">{heading}</Text>
      <div className="mt-2 flex items-center gap-1">
        <div className="text-sm font-medium text-foreground">{endpoint.node ? getModuleNodeDisplayLabel(endpoint.node) : t({ ko: '알 수 없는 노드', en: 'Unknown node' })}</div>
        {endpoint.node?.id ? <TechnicalReferenceHint title={`node ${endpoint.node.id}`} label={t({ ko: '노드 내부 식별자 보기', en: 'Show internal node identifier' })} /> : null}
      </div>
      <div className="mt-3 text-xs font-medium text-foreground">{t({ ko: '{role} 포트', en: '{role} port' }, { role })}</div>
      {endpoint.port ? (
        <>
          <div className="mt-1 flex items-center gap-1">
            <Tip content={normalizeModulePortDescription(endpoint.port.description)}>
              <div className="text-sm text-foreground">{endpoint.port.label}</div>
            </Tip>
            <TechnicalReferenceHint title={`port ${endpoint.port.key}`} label={t({ ko: '포트 내부 키 보기', en: 'Show internal port key' })} />
          </div>
          <PortBadges port={endpoint.port} />
        </>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{endpoint.portKey ? t({ ko: '포트 세부 정보', en: 'Port details' }) : t({ ko: '포트 정보를 찾지 못했어.', en: 'Could not find port information.' })}</span>
          {endpoint.portKey ? <TechnicalReferenceHint title={`port ${endpoint.portKey}`} label={t({ ko: '포트 내부 키 보기', en: 'Show internal port key' })} /> : null}
        </div>
      )}
    </Panel>
  )
}

/** Group one selected node's execution artifacts by output port for inspector display. */
export function groupNodeOutputArtifacts(node: ModuleGraphNode, artifacts: GraphExecutionArtifactRecord[]) {
  const visibleOutputPorts = getVisibleModuleOutputPorts(node.data.module, node.data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(node.data.inputValues),
    connectedInputKeys: node.data.connectedInputKeys,
    connectedOutputKeys: node.data.connectedOutputKeys,
  })
  const visibleOutputPortKeys = new Set(visibleOutputPorts.map((port) => port.key))
  const outputPortMap = new Map(visibleOutputPorts.map((port, index) => [port.key, { port, index }]))
  const groupedArtifacts = artifacts.reduce<Map<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
    if (!visibleOutputPortKeys.has(artifact.port_key)) {
      return acc
    }

    const current = acc.get(artifact.port_key) ?? []
    current.push(artifact)
    acc.set(artifact.port_key, current)
    return acc
  }, new Map())

  return Array.from(groupedArtifacts.entries())
    .map(([portKey, portArtifacts]) => {
      const outputPort = outputPortMap.get(portKey)?.port ?? null
      return {
        portKey,
        portLabel: outputPort?.label ?? portKey,
        portType: outputPort?.data_type ?? (portArtifacts[0]?.artifact_type === 'file' ? null : portArtifacts[0]?.artifact_type ?? null),
        artifacts: [...portArtifacts].sort(compareGraphArtifactsNewestFirst),
      } satisfies NodeOutputArtifactGroup
    })
    .sort((left, right) => {
      const leftOrder = outputPortMap.get(left.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      const rightOrder = outputPortMap.get(right.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.portLabel.localeCompare(right.portLabel, 'ko')
    })
}
