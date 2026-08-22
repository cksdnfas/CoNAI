import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { GripVertical, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MiniMaxH3DirectorDasiwaInput } from '@/features/image-generation/components/minimax-h3-director-dasiwa-input'
import { useI18n } from '@/i18n'
import { PowerLoraLoaderInput, hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import { WORKFLOW_INPUT_ENABLED_KEY, isWorkflowInputSourceModule } from '../module-graph-workflow-inputs'
import {
  InlineWorkflowInputEditor,
  NodeArtifactOutputs,
} from './module-graph-node-card-layouts'
import {
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  SourceNodeOutputPorts,
  buildModuleUiFieldMap,
  getInputPortState,
  stopNodeActionEvent,
  stopNodeInteraction,
} from './module-graph-port-cells'
import {
  getModuleBaseDisplayName,
  getModuleColor,
  getModuleNodeDisplayLabelFromData,
  getVisibleModuleOutputPorts,
  hasCustomModuleNodeLabel,
  isAdvancedOutputPortsEnabled,
  isFinalResultModule,
  type ModuleGraphNode,
} from '../module-graph-shared'
import { ModuleGraphNodeCustomControls, useModuleGraphNodeCustomControls } from './module-graph-node-custom-controls'
import { resolveModuleGraphNodeDynamicInputPortKeys, resolveModuleGraphNodeLayout } from './module-graph-node-card-operation-registry'
import { ModuleGraphNodeLayoutRenderer } from './module-graph-node-layout-renderer'

function normalizeBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'true') return true
    if (normalizedValue === 'false') return false
  }

  return false
}

/** Normalize one composite module field value for its node-native editor. */
function normalizeCompositeNodeValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Render a cleaner module graph node card with source-node specific layout. */
function ModuleGraphNodeCardComponent({ id, data, selected }: NodeProps<ModuleGraphNode>) {
  const { t } = useI18n()
  const { module } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const uiFieldByKey = useMemo(() => buildModuleUiFieldMap(module.ui_schema), [module.ui_schema])
  const powerLoraUiFields = (module.ui_schema ?? []).filter((field) => (
    isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(data.inputValues?.[field.key] ?? field.default_value)
  ))
  const powerLoraUiFieldKeys = new Set(powerLoraUiFields.map((field) => field.key))
  const miniMaxDirectorUiFields = (module.ui_schema ?? []).filter((field) => field.node_editor === 'minimax_h3_director_dasiwa')
  const miniMaxDirectorUiFieldKeys = new Set(miniMaxDirectorUiFields.map((field) => field.key))
  const inputPorts = (module.exposed_inputs ?? []).filter((port) => {
    const uiField = uiFieldByKey.get(port.key)
    const value = data.inputValues?.[port.key] ?? port.default_value ?? uiField?.default_value
    return !powerLoraUiFieldKeys.has(port.key)
      && !miniMaxDirectorUiFieldKeys.has(port.key)
      && !isPowerLoraLoaderUiField(uiField)
      && !hasPowerLoraLoaderEntries(value)
  })
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'
  const connectedInputKeys = new Set(data.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(data.connectedOutputKeys ?? [])
  const isWorkflowInputSource = isWorkflowInputSourceModule(module)
  const isWorkflowInputWaiting = isWorkflowInputSource
    && normalizeBooleanFlag(data.inputValues?.[WORKFLOW_INPUT_ENABLED_KEY])
    && inputPorts.some((port) => getInputPortState(data, port, connectedInputKeys).requiredMissing)
  const sourceOutputPorts = isWorkflowInputSource ? outputPorts : []
  const missingRequiredInputCount = inputPorts.filter((port) => getInputPortState(data, port, connectedInputKeys).requiredMissing).length

  const nodeDisplayLabel = getModuleNodeDisplayLabelFromData(data)
  const moduleBaseLabel = getModuleBaseDisplayName(module)
  const usesCustomNodeLabel = hasCustomModuleNodeLabel(data)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label ?? '')
  const missingStatusLabel = isWorkflowInputWaiting
    ? t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })
    : isWorkflowInputSource ? t({ ko: '값 필요', en: 'Value required' }) : t({ ko: '입력 필요', en: 'Input required' })
  useEffect(() => {
    if (!isEditingLabel) {
      setLabelDraft(data.label ?? '')
    }
  }, [data.label, isEditingLabel])

  useEffect(() => {
    if (!selected) {
      setIsEditingLabel(false)
    }
  }, [selected])

  const statusLabel =
    data.disabled === true
      ? t({ ko: '비활성', en: 'Disabled' })
      : executionStatus === 'completed'
      ? t({ ko: '완료', en: 'Completed' })
      : executionStatus === 'failed'
        ? t({ ko: '실패', en: 'Failed' })
        : executionStatus === 'blocked'
          ? t({ ko: '차단됨', en: 'Blocked' })
          : executionStatus === 'skipped'
            ? t({ ko: '건너뜀', en: 'Skipped' })
          : missingRequiredInputCount > 0
            ? missingStatusLabel
            : null
  const skippedReasonLabel =
    data.executionSkipReason === 'disabled'
      ? t({ ko: '비활성 건너뜀', en: 'Disabled skip' })
      : data.executionSkipReason === 'source-node-skipped'
        ? t({ ko: '상위 건너뜀', en: 'Upstream skipped' })
        : data.executionSkipReason === 'source-output-disabled'
          ? t({ ko: '출력 차단', en: 'Output blocked' })
          : data.executionSkipReason === 'inactive-branch'
            ? t({ ko: '비활성 분기', en: 'Inactive branch' })
            : t({ ko: '건너뜀', en: 'Skipped' })
  const activationLabel =
    data.disabled === true
      ? t({ ko: '비활성', en: 'Disabled' })
      : executionStatus === 'failed'
        ? t({ ko: '실패 지점', en: 'Failed node' })
        : executionStatus === 'blocked'
          ? t({ ko: '이후 차단', en: 'Blocked downstream' })
          : executionStatus === 'skipped'
            ? skippedReasonLabel
          : isWorkflowInputWaiting
            ? t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })
            : missingRequiredInputCount > 0
            ? t({ ko: '입력 {count}개 필요', en: '{count} inputs needed' }, { count: missingRequiredInputCount })
            : data.activationHint === 'conditional-input'
              ? t({ ko: '조건 입력', en: 'Conditional input' })
              : t({ ko: '실행 가능', en: 'Runnable' })
  const activationTitle =
    data.disabled === true
      ? t({ ko: '이 노드는 실행 중 건너뛰고 출력도 비활성 처리돼.', en: 'This node is skipped during execution and its outputs are disabled.' })
      : isWorkflowInputWaiting
        ? t({ ko: '저장된 워크플로우 실행 때 이 값을 입력받도록 노출돼 있어. 실행 전 입력값을 확인해야 해.', en: 'This value is exposed for saved-workflow runs. Confirm the runtime input before execution.' })
        : missingRequiredInputCount > 0
        ? t({ ko: '필수 입력이 비어 있거나 연결되지 않아 실행 전 확인이 필요해.', en: 'One or more required inputs are empty or unconnected and need review before execution.' })
        : executionStatus === 'skipped'
          ? data.executionSkipReason === 'disabled'
            ? t({ ko: '이전 실행에서 이 노드는 비활성 상태라 실행하지 않고 모든 출력을 비활성 처리했어.', en: 'In the selected run this node was disabled, so execution skipped it and disabled all outputs.' })
            : data.executionSkipReason === 'source-node-skipped'
              ? t({ ko: '이전 실행에서 상위 노드가 먼저 건너뛰어져 이 노드도 실행되지 않았어.', en: 'In the selected run an upstream node was skipped first, so this node did not run.' })
              : data.executionSkipReason === 'source-output-disabled'
                ? t({ ko: '이전 실행에서 연결된 상위 출력이 비활성 처리되어 이 노드가 실행되지 않았어.', en: 'In the selected run a connected upstream output was disabled, so this node did not run.' })
                : t({ ko: '이전 실행에서 IF 분기 결과가 이 노드로 이어지지 않아 건너뛰었어.', en: 'In the selected run the IF branch result did not lead to this node, so it was skipped.' })
        : data.activationHint === 'conditional-input'
          ? t({ ko: 'IF 분기 출력이 연결되어 실행 때 조건 결과에 따라 건너뛸 수 있어.', en: 'An IF branch output feeds this node, so execution may skip it depending on the branch result.' })
          : t({ ko: '현재 연결과 값 기준으로 실행 경로에 들어갈 수 있어.', en: 'Current wiring and values allow this node to enter the execution path.' })

  const statusBorderColor =
    data.disabled === true
      ? '#94a3b8'
      : executionStatus === 'completed'
      ? '#7bd88f'
      : executionStatus === 'failed'
        ? '#ff8a80'
        : executionStatus === 'blocked'
          ? '#ffd180'
          : executionStatus === 'skipped'
            ? '#94a3b8'
          : missingRequiredInputCount > 0
            ? '#f59e0b'
            : `${accentColor}66`
  const isFinalResult = isFinalResultModule(module)
  const nodeLayoutKey = resolveModuleGraphNodeLayout(module)
  const customControlState = useModuleGraphNodeCustomControls({ connectedInputKeys, data, id, inputPorts, uiFieldByKey })
  const visibleOutputPorts = getVisibleModuleOutputPorts(module, data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(data.inputValues),
    connectedInputKeys,
    connectedOutputKeys,
  })
  const visibleOutputPortKeys = new Set(visibleOutputPorts.map((port) => port.key))
  const visibleInputPorts = inputPorts.filter((port) => !customControlState.hiddenInputPortKeys.has(port.key))
  const usesRegisteredLayout = nodeLayoutKey !== 'default'
  const renderedInputPorts = isWorkflowInputSource
    ? []
    : (usesRegisteredLayout ? inputPorts : visibleInputPorts)
  const renderedOutputPorts = isWorkflowInputSource
    ? sourceOutputPorts
    : (usesRegisteredLayout ? outputPorts : visibleOutputPorts)
  const renderedHandleSignature = [
    ...renderedInputPorts.map((port) => `in:${port.key}`),
    ...resolveModuleGraphNodeDynamicInputPortKeys(module, data).map((portKey) => `in:${portKey}`),
    ...renderedOutputPorts.map((port) => `out:${port.key}`),
  ].join('|')

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, renderedHandleSignature, updateNodeInternals])

  return (
    <div
      className={`${miniMaxDirectorUiFields.length > 0 ? 'w-[560px] max-w-[560px]' : 'w-[340px] max-w-[340px]'} rounded-sm border bg-surface-container px-2.5 py-2 text-foreground shadow-lg ${data.disabled === true ? 'opacity-60 grayscale' : ''}`}
      style={{
        borderColor: selected ? accentColor : statusBorderColor,
        boxShadow: selected ? `0 0 0 2px ${accentColor}66, 0 0 0 1px ${accentColor}22` : `0 0 0 1px ${accentColor}22`,
      } as CSSProperties}
      title={`${nodeDisplayLabel}\n${t({ ko: '기본 타입: {label}', en: 'Base type: {label}' }, { label: moduleBaseLabel })}\n${t({ ko: '모듈 ID: {id}', en: 'Module ID: {id}' }, { id: module.id })}${module.description ? `\n${module.description}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="module-graph-drag-handle flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm border border-border/70 bg-background/50 text-muted-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            {isEditingLabel ? (
              <Input
                value={labelDraft}
                autoFocus
                onChange={(event) => setLabelDraft(event.target.value)}
                onMouseDown={stopNodeInteraction}
                onClick={stopNodeInteraction}
                onBlur={() => {
                  data.onNodeLabelChange?.(id, labelDraft)
                  setIsEditingLabel(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    data.onNodeLabelChange?.(id, labelDraft)
                    setIsEditingLabel(false)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setLabelDraft(data.label ?? '')
                    setIsEditingLabel(false)
                  }
                }}
                placeholder={moduleBaseLabel}
                className={`nodrag nowheel h-8 text-sm ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
              />
            ) : (
              <button
                type="button"
                className="max-w-full cursor-pointer truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                onClick={(event) => {
                  if (!selected) {
                    return
                  }
                  stopNodeActionEvent(event)
                  setIsEditingLabel(true)
                }}
                title={selected ? t({ ko: '클릭해서 이름 변경', en: 'Click to rename' }) : undefined}
              >
                {nodeDisplayLabel}
              </button>
            )}
            {usesCustomNodeLabel ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{moduleBaseLabel}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {data.plannedExecutionOrder ? <Badge variant="outline" title={t({ ko: '계획 실행 순서', en: 'Planned execution order' })}>#{data.plannedExecutionOrder}</Badge> : null}
          <Badge variant="outline" title={activationTitle}>{activationLabel}</Badge>
          {isFinalResult ? <Badge variant="secondary">{t({ ko: '최종 결과', en: 'Final result' })}</Badge> : null}
          {data.executionReuseState === 'reused' ? <Badge variant="outline">{t({ ko: '캐시', en: 'Cache' })}</Badge> : null}
          {data.executionArtifactCount ? <Badge variant="outline">A {data.executionArtifactCount}</Badge> : null}
          {statusLabel && statusLabel !== activationLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
        </div>
      </div>

      {(data.onExecuteNode || data.onForceExecuteNode) ? (
        <div className="nodrag nowheel mt-2 flex flex-wrap gap-1.5">
          {data.onExecuteNode ? (
            <Button
              type="button"
              size="icon-sm"
              className="h-7 w-7"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onExecuteNode?.()
              }}
              title={t({ ko: '실행', en: 'Run' })}
              aria-label={t({ ko: '실행', en: 'Run' })}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {data.onForceExecuteNode ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="h-7 w-7"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onForceExecuteNode?.()
              }}
              title={t({ ko: '재실행', en: 'Rerun' })}
              aria-label={t({ ko: '재실행', en: 'Rerun' })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <ModuleGraphNodeCustomControls data={data} state={customControlState} />

      {miniMaxDirectorUiFields.length > 0 ? (
        <div
          className="nodrag nowheel mt-2 space-y-3 border-t border-border/30 pt-3"
          onMouseDown={stopNodeInteraction}
          onClick={stopNodeInteraction}
        >
          {miniMaxDirectorUiFields.map((field) => (
            <div key={field.key} className="space-y-2">
              {miniMaxDirectorUiFields.length > 1 ? (
                <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{field.label}</div>
              ) : null}
              <MiniMaxH3DirectorDasiwaInput
                value={normalizeCompositeNodeValue(data.inputValues?.[field.key] ?? field.default_value)}
                visibleFields={field.node_visible_fields}
                numericBounds={field.node_numeric_bounds}
                onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
              />
            </div>
          ))}
        </div>
      ) : null}

      {isWorkflowInputSource ? <SourceNodeOutputPorts nodeId={id} ports={sourceOutputPorts} connectedOutputKeys={connectedOutputKeys} accentColor={accentColor} /> : null}
      {isWorkflowInputSource ? <InlineWorkflowInputEditor id={id} data={data} /> : null}

      {!isWorkflowInputSource ? (
        <ModuleGraphNodeLayoutRenderer
          id={id}
          data={data}
          layoutKey={nodeLayoutKey}
          accentColor={accentColor}
          connectedInputKeys={connectedInputKeys}
          connectedOutputKeys={connectedOutputKeys}
          uiFieldByKey={uiFieldByKey}
          visibleInputPorts={visibleInputPorts}
          visibleOutputPorts={visibleOutputPorts}
        />
      ) : null}

      {powerLoraUiFields.length > 0 ? (
        <div className="nodrag nowheel mt-1.5 space-y-1 border-t border-border/20 pt-1.5" onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction}>
          <div className="px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">LoRA</div>
          {powerLoraUiFields.map((field) => {
            const value = data.inputValues?.[field.key] ?? field.default_value
            return (
              <PowerLoraLoaderInput
                key={field.key}
                field={field}
                value={value}
                variant="compact"
                onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
              />
            )
          })}
        </div>
      ) : null}

      <NodeArtifactOutputs
        data={data}
        moduleName={module.name}
        isFinalResult={isFinalResult}
        visibleOutputPortKeys={visibleOutputPortKeys}
      />
    </div>
  )
}

/** Memoized so position-only canvas updates skip re-rendering unchanged node cards. */
export const ModuleGraphNodeCard = memo(ModuleGraphNodeCardComponent)
