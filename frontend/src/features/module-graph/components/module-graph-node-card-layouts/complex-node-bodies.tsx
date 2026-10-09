import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { MiniMaxH3DirectorDasiwaInput } from '@/features/image-generation/components/minimax-h3-director-dasiwa-input'
import type { MiniMaxH3DirectorGraphInputKey } from '@/features/image-generation/components/minimax-h3-director-dasiwa-types'
import { getMiniMaxH3DirectorActiveItems, MINIMAX_H3_DIRECTOR_MODES, type MiniMaxH3DirectorMode } from '@/features/image-generation/components/minimax-h3-director-dasiwa-utils'
import { getMiniMaxDirectorMediaLane, hasMiniMaxDirectorAudio } from '@/features/image-generation/components/minimax-h3-director-media'
import {
  changeMiniMaxH3DirectorMode,
  patchMiniMaxH3DirectorValue,
  readMiniMaxH3DirectorState,
  type MiniMaxH3DirectorState,
} from '@/features/image-generation/components/minimax-h3-director-node-state'
import { getPowerLoraEntryLabel, isPowerLoraLoaderEntryValue } from '@/features/image-generation/components/power-lora-loader-utils'
import { useI18n } from '@/i18n'
import type { ModuleDefinitionRecord, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { buildWorkflowInputAssetUrl } from '@/lib/api-workflow-input-assets'
import { getMiniMaxDirectorInputPort } from '../../module-graph-minimax-director-ports'
import { buildInputSourceKey, useModuleGraphCanvasContext, useModuleGraphNodeActions } from '../module-graph-canvas-context'
import { NodeNumberControl, NodeSelectControl, NodeSwitchControl, NodeTextControl, stopNodeEvent } from '../module-graph-node-controls'
import { ModuleGraphPortHandle } from '../module-graph-port-handle'
import { NODE_BLOCK_HANDLE_CLASS, NodeInputRow, NodeLinkedSource, NodeRow, NodeRowDivider, NodeWidgetBlock, buildPortTooltip, getNodePortDisplayLabel } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { NodeOutputRows } from './default-port-rows'
import { getDirectorWidgetLabel, getDirectorWidgetSpec, isNestedDirectorWidget, type DirectorWidgetPatch, type DirectorWidgetSpec } from './director-node-widgets'

const DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const NOOP = () => {}
const EMPTY_VALUE: Record<string, unknown> = {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Tells the node which connection points the Director editor would show for the current settings. */
function PortKeyReporter({ reportKey, onReport }: { reportKey: string; onReport: (key: string, present: boolean) => void }) {
  useLayoutEffect(() => {
    onReport(reportKey, true)
    return () => onReport(reportKey, false)
  }, [onReport, reportKey])
  return null
}

/** Media a Director media input holds right now: the frame thumbnail, or how many references. */
function DirectorMediaSummary({ nodeId, fieldKey, inputKey, state }: { nodeId: string; fieldKey: string; inputKey: string; state: MiniMaxH3DirectorState }) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const items = getMiniMaxH3DirectorActiveItems(state.nodeValue)
  const images = items.filter((item) => item.type === 'image')
  const frame = inputKey === 'start_image'
    ? (state.mode === 'FL2VA' ? images.find((item) => item.slot === 0) : images[0])
    : inputKey === 'end_image'
      ? (state.mode === 'FL2VA' ? images.find((item) => item.slot === 1) : images[0])
      : undefined
  const frameAsset = frame ? state.assets[frame.id] : undefined
  const count = inputKey === 'reference_image'
    ? images.length
    : inputKey === 'reference_video'
      ? items.filter((item) => getMiniMaxDirectorMediaLane(item) === 'video').length
      : inputKey === 'reference_audio' ? items.filter(hasMiniMaxDirectorAudio).length : 0
  if (!frameAsset && count === 0) return null

  return (
    <Button
      type="button"
      variant="link"
      title={t({ ko: '패널에서 편집', en: 'Edit in the panel' })}
      onMouseDown={stopNodeEvent}
      onClick={(event) => {
        event.stopPropagation()
        actions.editInPanel(nodeId, fieldKey)
      }}
      className="nodrag h-auto min-w-0 p-0 text-xs font-normal text-muted-foreground transition-none hover:text-foreground"
    >
      {frameAsset
        ? <img src={buildWorkflowInputAssetUrl(frameAsset)} alt="" draggable={false} className="size-5 rounded-[3px] object-cover" />
        : t({ ko: '{count}개', en: '{count}' }, { count })}
    </Button>
  )
}

/** The in-node control for one Director setting. */
function DirectorWidgetControl({ spec, label, onPatch }: { spec: DirectorWidgetSpec; label: string; onPatch: (patch: DirectorWidgetPatch) => void }) {
  switch (spec.kind) {
    case 'number':
      return (
        <NodeNumberControl
          ariaLabel={label}
          value={spec.value}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(value) => {
            if (value !== '') onPatch(spec.write(value))
          }}
        />
      )
    case 'select':
      return <NodeSelectControl ariaLabel={label} value={spec.value} options={spec.options} onChange={(value) => onPatch(spec.write(value))} />
    case 'boolean':
      return <NodeSwitchControl ariaLabel={label} checked={spec.value} onChange={(value) => onPatch(spec.write(value))} />
    case 'text':
      return <NodeTextControl ariaLabel={label} value={spec.value} onChange={(value) => onPatch(spec.write(value))} />
    default:
      return null
  }
}

/**
 * One Director field as ComfyUI-style widgets: media inputs as link rows, the mode, then every setting the panel
 * editor shows for the current mode and options. Prompts are three-line blocks that open the panel; the rest edit
 * in place.
 */
function DirectorFieldWidgets({
  nodeId,
  data,
  field,
  connectedInputKeys,
  reportedKeys,
}: {
  nodeId: string
  data: ModuleGraphNodeLayoutProps['data']
  field: ModuleUiFieldDefinition
  connectedInputKeys: Set<string>
  reportedKeys: ReadonlySet<string>
}) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const { inputSources, liftedLink } = useModuleGraphCanvasContext()
  const storedValue = data.inputValues?.[field.key]
  const rawValue = isRecord(storedValue) ? storedValue : isRecord(field.default_value) ? field.default_value : EMPTY_VALUE
  const bounds = field.node_numeric_bounds
  const state = useMemo(() => readMiniMaxH3DirectorState(rawValue, bounds), [rawValue, bounds])
  const showMode = state.mode !== null && (field.node_visible_fields ?? ['mode']).includes('mode')
  const save = (build: () => Record<string, unknown>) => {
    try {
      actions.changeValue(nodeId, field.key, build())
    } catch {
      // A size outside the workflow's bounds is refused; the panel editor says why.
    }
  }
  const apply = (patch: DirectorWidgetPatch) => save(() => patchMiniMaxH3DirectorValue(state, bounds, patch.input ?? {}, patch.timeline, state.assets, patch.builder))
  const sourceOf = (port: ModulePortDefinition) => (
    liftedLink?.targetNodeId === nodeId && liftedLink.targetPortKey === port.key
      ? liftedLink.sourceLabel
      : inputSources.get(buildInputSourceKey(nodeId, port.key))
  )

  const ports = (data.module.exposed_inputs ?? [])
    .filter((port) => port.node_binding?.node_editor === DIRECTOR_EDITOR && port.node_binding.field_key === field.key)
    .filter((port) => {
      const inputKey = port.node_binding?.input_key ?? ''
      const active = getMiniMaxDirectorInputPort(data.module, data.inputValues, field.key, inputKey)?.key === port.key
      return connectedInputKeys.has(port.key) || (active && reportedKeys.has(`${field.key}:${inputKey}`))
    })
    .map((port) => {
      const inputKey = port.node_binding?.input_key ?? ''
      return { port, inputKey, spec: getDirectorWidgetSpec(t, inputKey, state, bounds) }
    })
  // Media first, like ComfyUI's link-only inputs at the top; widgets keep the editor's order.
  const mediaPorts = ports.filter(({ spec }) => !spec || spec.kind === 'media')
  const widgetPorts = ports.filter(({ spec }) => spec && spec.kind !== 'media')

  return (
    <>
      {mediaPorts.map(({ port, inputKey }) => {
        const connected = connectedInputKeys.has(port.key)
        const tooltip = buildPortTooltip(t, port)
        return (
          <NodeRow
            key={port.key}
            variant="link"
            label={port.label}
            labelTitle={tooltip}
            handle={<ModuleGraphPortHandle nodeId={nodeId} port={port} side="input" connected={connected} tooltip={tooltip} />}
          >
            {connected
              ? <NodeLinkedSource source={sourceOf(port)} />
              : <DirectorMediaSummary nodeId={nodeId} fieldKey={field.key} inputKey={inputKey} state={state} />}
          </NodeRow>
        )
      })}
      {mediaPorts.length > 0 ? <NodeRowDivider /> : null}
      {showMode ? (
        <NodeRow label={t({ ko: '모드', en: 'Mode' })}>
          <NodeSelectControl
            ariaLabel={t({ ko: '생성 모드', en: 'Generation mode' })}
            value={state.mode}
            options={MINIMAX_H3_DIRECTOR_MODES}
            onChange={(next) => {
              if (MINIMAX_H3_DIRECTOR_MODES.includes(next as MiniMaxH3DirectorMode)) {
                save(() => changeMiniMaxH3DirectorMode(state, bounds, next as MiniMaxH3DirectorMode))
              }
            }}
          />
        </NodeRow>
      ) : null}
      {widgetPorts.map(({ port, inputKey, spec }) => {
        if (!spec) return null
        const connected = connectedInputKeys.has(port.key)
        const tooltip = buildPortTooltip(t, port)
        const label = getDirectorWidgetLabel(inputKey, port.label)
        const nestedClass = isNestedDirectorWidget(inputKey) ? 'pl-6' : undefined
        const asBlock = spec.kind === 'prompt' && !connected
        const handle = (
          <ModuleGraphPortHandle
            nodeId={nodeId}
            port={port}
            side="input"
            connected={connected}
            reveal
            tooltip={tooltip}
            className={asBlock ? NODE_BLOCK_HANDLE_CLASS : undefined}
          />
        )

        if (asBlock) {
          return (
            <NodeWidgetBlock
              key={port.key}
              nodeId={nodeId}
              fieldKey={`${field.key}#${inputKey}`}
              label={label}
              labelTitle={tooltip}
              handle={handle}
              text={spec.value}
              placeholder={t({ ko: '비어 있음', en: 'Empty' })}
              className={nestedClass}
            />
          )
        }
        return (
          <NodeRow key={port.key} label={label} labelTitle={tooltip} handle={handle} linked={connected} className={nestedClass}>
            {connected ? <NodeLinkedSource source={sourceOf(port)} /> : <DirectorWidgetControl spec={spec} label={label} onPatch={apply} />}
          </NodeRow>
        )
      })}
    </>
  )
}

/**
 * MiniMax Director: outputs, then the Director settings as in-node widgets (exactly the inputs the current mode and
 * options use), then the workflow's own inputs. The panel editor renders out of sight only to report which inputs
 * those are, so the node follows every option change the same way the editor does; linked inputs always stay.
 */
export function MiniMaxDirectorNodeBody({
  id,
  data,
  connectedInputKeys,
  visibleOutputPorts,
  uiFieldByKey,
  beforeInputs,
  plainInputPorts,
}: ModuleGraphNodeLayoutProps & { beforeInputs?: ReactNode; plainInputPorts: ModulePortDefinition[] }) {
  const directorFields = (data.module.ui_schema ?? []).filter((field) => field.node_editor === DIRECTOR_EDITOR)
  const [reportedKeys, setReportedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const onReport = useCallback((key: string, present: boolean) => {
    setReportedKeys((current) => {
      if (current.has(key) === present) return current
      const next = new Set(current)
      if (present) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      {beforeInputs}
      {directorFields.map((field) => (
        <DirectorFieldWidgets key={field.key} nodeId={id} data={data} field={field} connectedInputKeys={connectedInputKeys} reportedKeys={reportedKeys} />
      ))}
      {plainInputPorts.length > 0 ? <NodeRowDivider /> : null}
      {plainInputPorts.map((port) => (
        <NodeInputRow key={port.key} nodeId={id} data={data} port={port} uiField={uiFieldByKey.get(port.key) ?? null} connected={connectedInputKeys.has(port.key)} />
      ))}

      <div hidden aria-hidden>
        {directorFields.map((field) => (
          <MiniMaxH3DirectorDasiwaInput
            key={field.key}
            value={isRecord(data.inputValues?.[field.key]) ? data.inputValues[field.key] as Record<string, unknown> : isRecord(field.default_value) ? field.default_value : {}}
            visibleFields={field.node_visible_fields}
            hiddenControls={field.node_hidden_controls}
            numericBounds={field.node_numeric_bounds}
            onChange={NOOP}
            renderInputPort={(inputKey: MiniMaxH3DirectorGraphInputKey) => <PortKeyReporter reportKey={`${field.key}:${inputKey}`} onReport={onReport} />}
          />
        ))}
      </div>
    </>
  )
}

/** Power LoRA list as one line ("3 LoRA · 2 on"); the list itself is edited in the panel. */
export function PowerLoraSummaryRow({ id, module, field, value }: { id: string; module: ModuleDefinitionRecord; field: ModuleUiFieldDefinition; value: unknown }) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const entries = isRecord(value) ? Object.values(value).filter(isPowerLoraLoaderEntryValue) : []
  const enabled = entries.filter((entry) => entry.on !== false)
  const summary = entries.length === 0
    ? t({ ko: '없음', en: 'None' })
    : enabled.length === 1 && enabled[0].lora
      ? getPowerLoraEntryLabel(enabled[0].lora)
      : t({ ko: '{count}개 · 켜짐 {on}', en: '{count} · {on} on' }, { count: entries.length, on: enabled.length })

  return (
    <NodeRow label={getNodePortDisplayLabel(module, { key: field.key, label: field.label || 'LoRA' })} labelTitle={field.label || 'LoRA'}>
      <Button
        type="button"
        variant="link"
        title={t({ ko: '패널에서 편집', en: 'Edit in the panel' })}
        onMouseDown={stopNodeEvent}
        onClick={(event) => {
          event.stopPropagation()
          actions.editInPanel(id, field.key)
        }}
        className="nodrag h-auto min-w-0 justify-end p-0 pr-1 text-xs font-normal text-foreground transition-none"
      >
        <span className="truncate">{summary}</span>
      </Button>
    </NodeRow>
  )
}
