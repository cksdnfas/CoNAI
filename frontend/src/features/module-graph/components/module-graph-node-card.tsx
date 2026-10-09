import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { NodeToolbar, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Copy, Ellipsis, Play, Power, RotateCcw, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { getModuleNodeKindVisual } from '../module-graph-node-kind'
import { isWorkflowInputSourceModule } from '../module-graph-workflow-inputs'
import {
  getModuleBaseDisplayName,
  getModuleNodeDisplayLabelFromData,
  getModulePortCompatibility,
  getVisibleModuleOutputPorts,
  isAdvancedOutputPortsEnabled,
  isFinalResultModule,
  type ModuleGraphNode,
} from '../module-graph-shared'
import { hasMeaningfulValue } from './module-graph-field-shared'
import { useModuleGraphCanvasContext, useModuleGraphExecutionLock, useModuleGraphNodeActions } from './module-graph-canvas-context'
import { NODE_CONTROL_CLASS, stopNodeEvent } from './module-graph-node-controls'
import { NodeArtifactOutputs } from './module-graph-node-card-layouts/node-artifact-outputs'
import { ModuleGraphNodeBody } from './module-graph-node-layout-renderer'

type NodeStatus = { tone: 'success' | 'destructive' | 'warning' | 'muted' | 'info'; label: string; detail: string } | null

/** Status shown as one dot in the header (and a border tint for failures and missing inputs). */
function useNodeStatus(data: ModuleGraphNode['data'], missingRequiredCount: number): NodeStatus {
  const { t } = useI18n()
  const executionStatus = data.executionStatus ?? 'idle'
  if (data.disabled === true) {
    return { tone: 'muted', label: t({ ko: '꺼짐', en: 'Off' }), detail: t({ ko: '실행할 때 건너뛰고 출력도 꺼져.', en: 'Skipped when running; its outputs are off.' }) }
  }
  if (executionStatus === 'failed') {
    return { tone: 'destructive', label: t({ ko: '실패', en: 'Failed' }), detail: t({ ko: '선택한 실행에서 여기서 멈췄어.', en: 'The selected run stopped here.' }) }
  }
  if (executionStatus === 'blocked') {
    return { tone: 'warning', label: t({ ko: '차단됨', en: 'Blocked' }), detail: t({ ko: '앞 노드가 실패해서 실행되지 않았어.', en: 'An earlier node failed, so this one did not run.' }) }
  }
  if (executionStatus === 'skipped') {
    const reason = data.executionSkipReason === 'disabled'
      ? t({ ko: '꺼져 있어서 건너뛰었어.', en: 'Skipped because it was off.' })
      : data.executionSkipReason === 'source-node-skipped'
        ? t({ ko: '앞 노드가 건너뛰어져서 실행되지 않았어.', en: 'An earlier node was skipped.' })
        : data.executionSkipReason === 'source-output-disabled'
          ? t({ ko: '연결된 앞 출력이 꺼져 있었어.', en: 'A connected earlier output was off.' })
          : t({ ko: 'IF 분기가 이쪽으로 오지 않았어.', en: 'The IF branch did not lead here.' })
    return { tone: 'muted', label: t({ ko: '건너뜀', en: 'Skipped' }), detail: reason }
  }
  if (executionStatus === 'running') {
    return { tone: 'info', label: t({ ko: '실행 중', en: 'Running' }), detail: t({ ko: '선택한 실행이 지금 이 노드를 처리하고 있어.', en: 'The selected run is working on this node.' }) }
  }
  if (missingRequiredCount > 0) {
    return { tone: 'warning', label: t({ ko: '입력 {count}개 필요', en: '{count} inputs needed' }, { count: missingRequiredCount }), detail: t({ ko: '필수 입력이 비어 있거나 연결되지 않았어.', en: 'Required inputs are empty or not linked.' }) }
  }
  if (executionStatus === 'completed') {
    return {
      tone: 'success',
      label: data.executionReuseState === 'reused' ? t({ ko: '완료 (캐시)', en: 'Done (cached)' }) : t({ ko: '완료', en: 'Done' }),
      detail: data.executionReuseState === 'reused' ? t({ ko: '이전 결과를 다시 썼어.', en: 'Reused an earlier result.' }) : t({ ko: '선택한 실행에서 완료됐어.', en: 'Finished in the selected run.' }),
    }
  }
  return null
}

const STATUS_DOT_CLASS: Record<NonNullable<NodeStatus>['tone'], string> = {
  success: 'bg-success',
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground',
  info: 'bg-info animate-pulse',
}

/** Width of one node: most nodes 260px, request builders and multi-editor nodes a little wider. */
function getNodeWidth(data: ModuleGraphNode['data']) {
  const hasComposite = (data.module.ui_schema ?? []).some((field) => field.node_editor === 'minimax_h3_director_dasiwa')
  return hasComposite ? 290 : 260
}

/** A node card: a header (kind icon, name, status), its ports and values, and the latest output. */
function ModuleGraphNodeCardComponent({ id, data, selected, dragging }: NodeProps<ModuleGraphNode>) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const executionLocked = useModuleGraphExecutionLock()
  const { canExecuteGeneration, canUpdateWorkflows } = useFeaturePermissions()
  const { drag, debugMode, liftedLink } = useModuleGraphCanvasContext()
  const updateNodeInternals = useUpdateNodeInternals()
  const { module } = data
  const visual = getModuleNodeKindVisual(module)
  const KindIcon = visual.icon
  // A lifted link still counts as plugged in at both ends until it is dropped, so ports and rows stay put.
  const liftedInputKey = liftedLink?.targetNodeId === id ? liftedLink.targetPortKey : null
  const liftedOutputKey = liftedLink?.sourceNodeId === id ? liftedLink.sourcePortKey : null
  const connectedInputKeys = useMemo(() => {
    const keys = new Set(data.connectedInputKeys ?? [])
    if (liftedInputKey) keys.add(liftedInputKey)
    return keys
  }, [data.connectedInputKeys, liftedInputKey])
  const connectedOutputKeys = useMemo(() => {
    const keys = new Set(data.connectedOutputKeys ?? [])
    if (liftedOutputKey) keys.add(liftedOutputKey)
    return keys
  }, [data.connectedOutputKeys, liftedOutputKey])
  const visibleOutputPorts = getVisibleModuleOutputPorts(module, data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(data.inputValues),
    connectedInputKeys,
    connectedOutputKeys,
  })
  const missingRequiredCount = isWorkflowInputSourceModule(module)
    ? 0
    : (module.exposed_inputs ?? []).filter((port) => (
        port.required
        && !connectedInputKeys.has(port.key)
        && !hasMeaningfulValue(data.inputValues?.[port.key])
        && !hasMeaningfulValue(port.default_value)
      )).length
  const status = useNodeStatus(data, missingRequiredCount)
  const nodeLabel = getModuleNodeDisplayLabelFromData(data)
  const baseLabel = getModuleBaseDisplayName(module)
  const [isRenaming, setIsRenaming] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label ?? '')

  useEffect(() => {
    if (!isRenaming) setLabelDraft(data.label ?? '')
  }, [data.label, isRenaming])

  // Rows come and go with values (modes, toggles, links): re-measure the connection points after each change.
  useEffect(() => {
    updateNodeInternals(id)
  }, [data, id, updateNodeInternals])

  // While a link is dragged, nodes without any port that could take it step back.
  const dimmedForDrag = useMemo(() => {
    if (!drag || drag.nodeId === id) return false
    if (drag.handleType === 'source') {
      return !(module.exposed_inputs ?? []).some((port) => getModulePortCompatibility(drag.dataType, port.data_type) !== 'incompatible')
    }
    return !visibleOutputPorts.some((port) => getModulePortCompatibility(port.data_type, drag.dataType) !== 'incompatible')
  }, [drag, id, module.exposed_inputs, visibleOutputPorts])

  const commitLabel = () => {
    actions.changeLabel(id, labelDraft)
    setIsRenaming(false)
  }

  const borderColor = selected
    ? 'var(--primary)'
    : status?.tone === 'destructive'
      ? 'color-mix(in srgb, var(--destructive) 70%, transparent)'
      : status?.tone === 'warning' && missingRequiredCount > 0
        ? 'color-mix(in srgb, var(--warning) 45%, transparent)'
        : 'color-mix(in srgb, var(--foreground) 10%, transparent)'

  return (
    <div
      className={cn(
        'rounded-[7px] border bg-surface-container text-foreground shadow-elevation-1 transition-opacity',
        data.disabled === true && 'opacity-55 grayscale',
        dimmedForDrag && 'opacity-30',
      )}
      style={{
        width: getNodeWidth(data),
        borderColor,
        boxShadow: selected ? '0 0 0 1px var(--primary)' : undefined,
      } as CSSProperties}
    >
      <NodeToolbar isVisible={selected && !dragging ? undefined : false} position={Position.Top} offset={8}>
        <div className="nodrag flex items-center gap-0.5 rounded-lg bg-surface-high p-0.5 shadow-elevation-2">
          <IconButton size="icon-xs" variant="ghost" className="text-primary" disabled={!canExecuteGeneration || executionLocked} onClick={() => actions.execute(id, false)} label={t({ ko: '이 노드까지 실행', en: 'Run up to this node' })}>
            <Play />
          </IconButton>
          <IconButton size="icon-xs" variant="ghost" disabled={!canExecuteGeneration || executionLocked} onClick={() => actions.execute(id, true)} label={t({ ko: '캐시 무시하고 다시 실행', en: 'Rerun, ignoring the cache' })}>
            <RotateCcw />
          </IconButton>
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <IconButton size="icon-xs" variant="ghost" disabled={!canUpdateWorkflows} onClick={() => actions.duplicate(id)} label={t({ ko: '복제 (Ctrl+D)', en: 'Duplicate (Ctrl+D)' })}>
            <Copy />
          </IconButton>
          <IconButton size="icon-xs" variant="ghost" active={data.disabled === true} disabled={!canUpdateWorkflows} onClick={() => actions.toggleDisabled(id)} label={data.disabled === true ? t({ ko: '켜기', en: 'Turn on' }) : t({ ko: '끄기', en: 'Turn off' })}>
            <Power />
          </IconButton>
          <IconButton size="icon-xs" variant="destructive-ghost" disabled={!canUpdateWorkflows} onClick={() => actions.remove(id)} label={t({ ko: '삭제 (Delete)', en: 'Delete (Delete)' })}>
            <Trash2 />
          </IconButton>
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              actions.openMenu(id, { x: rect.left + rect.width / 2, y: rect.bottom + 4 })
            }}
            label={t({ ko: '더 보기', en: 'More' })}
          >
            <Ellipsis />
          </IconButton>
        </div>
      </NodeToolbar>

      <div className="module-graph-drag-handle flex h-9 items-center gap-2 border-b border-line pr-2.5 pl-3">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px]" style={{ background: `color-mix(in srgb, ${visual.color} 16%, transparent)`, color: visual.color }} aria-hidden>
          <KindIcon className="size-3" strokeWidth={2.25} />
        </span>
        {isRenaming ? (
          <input
            autoFocus
            value={labelDraft}
            aria-label={t({ ko: '노드 이름', en: 'Node name' })}
            placeholder={baseLabel}
            onChange={(event) => setLabelDraft(event.target.value)}
            onMouseDown={stopNodeEvent}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitLabel()
              if (event.key === 'Escape') {
                setLabelDraft(data.label ?? '')
                setIsRenaming(false)
              }
            }}
            className={cn(NODE_CONTROL_CLASS, 'h-7 flex-1 text-sm font-semibold')}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-sm font-semibold"
            title={nodeLabel === baseLabel ? nodeLabel : `${nodeLabel}\n${baseLabel}`}
            onDoubleClick={(event) => {
              event.stopPropagation()
              if (canUpdateWorkflows) setIsRenaming(true)
            }}
          >
            {nodeLabel}
          </span>
        )}
        {debugMode && data.plannedExecutionOrder ? (
          <Tip content={t({ ko: '실행 순서', en: 'Run order' })}>
            <span className="shrink-0 font-mono text-2xs text-muted-foreground">#{data.plannedExecutionOrder}</span>
          </Tip>
        ) : null}
        {status ? (
          <Tip content={`${status.label}\n${status.detail}`} className="whitespace-pre-line text-left">
            <span role="img" aria-label={status.label} className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[status.tone])} />
          </Tip>
        ) : null}
      </div>

      <div className="py-1">
        <ModuleGraphNodeBody
          id={id}
          data={data}
          connectedInputKeys={connectedInputKeys}
          connectedOutputKeys={connectedOutputKeys}
          visibleOutputPorts={visibleOutputPorts}
        />
      </div>

      <NodeArtifactOutputs
        data={data}
        moduleName={nodeLabel}
        isFinalResult={isFinalResultModule(module)}
        visibleOutputPortKeys={new Set(visibleOutputPorts.map((port) => port.key))}
      />
    </div>
  )
}

/** Memoized: dragging another node or editing another node's value leaves this card alone. */
export const ModuleGraphNodeCard = memo(ModuleGraphNodeCardComponent)
