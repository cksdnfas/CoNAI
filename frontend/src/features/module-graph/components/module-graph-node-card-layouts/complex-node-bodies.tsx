import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MiniMaxH3DirectorDasiwaInput } from '@/features/image-generation/components/minimax-h3-director-dasiwa-input'
import type { MiniMaxH3DirectorGraphInputKey } from '@/features/image-generation/components/minimax-h3-director-dasiwa-types'
import { isMiniMaxH3DirectorInputLink, normalizeMiniMaxH3DirectorNodeValue, parseMiniMaxH3DirectorTimeline } from '@/features/image-generation/components/minimax-h3-director-dasiwa-utils'
import { getPowerLoraEntryLabel, isPowerLoraLoaderEntryValue } from '@/features/image-generation/components/power-lora-loader-utils'
import { useI18n } from '@/i18n'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { getMiniMaxDirectorInputPort } from '../../module-graph-minimax-director-ports'
import { buildInputSourceKey, useModuleGraphCanvasContext, useModuleGraphNodeActions } from '../module-graph-canvas-context'
import { stopNodeEvent } from '../module-graph-node-controls'
import { ModuleGraphPortHandle } from '../module-graph-port-handle'
import { NodeInputRow, NodeRow, NodeRowDivider, buildPortTooltip } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { NodeOutputRows } from './default-port-rows'

const DIRECTOR_EDITOR = 'minimax_h3_director_dasiwa'
const NOOP = () => {}

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

/** A clickable block of "name  value" lines that opens the full editor in the panel. */
function NodeSummaryBlock({ nodeId, fieldKey, lines }: { nodeId: string; fieldKey: string; lines: Array<{ label: string; value: string }> }) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  return (
    <div className="px-2">
      <Button
        type="button"
        variant="subtle"
        title={t({ ko: '패널에서 편집', en: 'Edit in the panel' })}
        onMouseDown={stopNodeEvent}
        onClick={(event) => {
          event.stopPropagation()
          actions.editInPanel(nodeId, fieldKey)
        }}
        className="nodrag relative my-1 grid h-auto w-full justify-stretch gap-0.5 rounded-[5px] px-2 py-1.5 text-left text-xs font-normal tracking-normal whitespace-normal text-foreground transition-none hover:text-foreground"
      >
        <Pencil className="absolute top-1.5 right-1.5 size-3 text-muted-foreground" aria-hidden />
        {lines.map((line) => (
          <span key={line.label} className="flex min-w-0 gap-2 pr-4">
            <span className="w-16 shrink-0 text-muted-foreground">{line.label}</span>
            <span className="min-w-0 truncate">{line.value}</span>
          </span>
        ))}
      </Button>
    </div>
  )
}

/** Short lines describing one Director setup: mode, length, size and post-processing. */
function useDirectorSummary(value: unknown) {
  const { t } = useI18n()
  const normalized = normalizeMiniMaxH3DirectorNodeValue(value)
  const linked = t({ ko: '연결됨', en: 'Linked' })
  const show = (entry: unknown, format: (raw: never) => string) => (isMiniMaxH3DirectorInputLink(entry) ? linked : format(entry as never))
  const timeline = typeof normalized.timeline_data === 'string' ? parseMiniMaxH3DirectorTimeline(normalized.timeline_data).timeline : null
  const postprocess = isRecord(timeline) && isRecord((timeline as Record<string, unknown>).postprocess) ? (timeline as Record<string, unknown>).postprocess as Record<string, Record<string, unknown>> : null
  const postprocessNames = postprocess
    ? [
        postprocess.simple?.enabled ? t({ ko: '2× 리사이즈', en: '2× resize' }) : null,
        postprocess.model?.enabled ? t({ ko: '업스케일 모델', en: 'Upscale model' }) : null,
        postprocess.rtx?.enabled ? 'RTX' : null,
      ].filter(Boolean)
    : []

  return [
    { label: t({ ko: '모드', en: 'Mode' }), value: show(normalized.mode, (mode: string) => mode) },
    {
      label: t({ ko: '길이', en: 'Length' }),
      value: `${show(normalized.duration, (seconds: number) => t({ ko: '{n}초', en: '{n}s' }, { n: seconds }))} · ${show(normalized.frame_rate, (fps: number) => `${fps}fps`)}`,
    },
    {
      label: t({ ko: '크기', en: 'Size' }),
      value: `${show(normalized.width, (width: number) => String(width))} × ${show(normalized.height, (height: number) => String(height))}`,
    },
    { label: t({ ko: '후처리', en: 'Post' }), value: postprocessNames.length > 0 ? postprocessNames.join(' · ') : t({ ko: '없음', en: 'None' }) },
  ]
}

function DirectorSummary({ nodeId, field, value }: { nodeId: string; field: ModuleUiFieldDefinition; value: unknown }) {
  const lines = useDirectorSummary(value)
  return <NodeSummaryBlock nodeId={nodeId} fieldKey={field.key} lines={lines} />
}

/**
 * MiniMax Director: outputs, a summary of the setup (edited in the panel), then exactly the connection points the
 * current mode and options use. The editor itself renders out of sight only to report which points those are, so
 * the node follows every option change the same way the editor does; linked points always stay.
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
  const { t } = useI18n()
  const { inputSources } = useModuleGraphCanvasContext()
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

  const directorPorts = directorFields.flatMap((field) => (data.module.exposed_inputs ?? [])
    .filter((port) => port.node_binding?.node_editor === DIRECTOR_EDITOR && port.node_binding.field_key === field.key)
    .filter((port) => {
      const inputKey = port.node_binding?.input_key ?? ''
      const active = getMiniMaxDirectorInputPort(data.module, data.inputValues, field.key, inputKey)?.key === port.key
      return connectedInputKeys.has(port.key) || (active && reportedKeys.has(`${field.key}:${inputKey}`))
    }))

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      {directorFields.map((field) => (
        <DirectorSummary key={field.key} nodeId={id} field={field} value={data.inputValues?.[field.key] ?? field.default_value} />
      ))}
      {beforeInputs}
      {directorPorts.length > 0 || plainInputPorts.length > 0 ? <NodeRowDivider /> : null}
      {directorPorts.map((port) => {
        const connected = connectedInputKeys.has(port.key)
        return (
          <NodeRow
            key={port.key}
            label={port.label}
            labelTitle={buildPortTooltip(t, port)}
            handle={<ModuleGraphPortHandle nodeId={id} port={port} side="input" connected={connected} tooltip={buildPortTooltip(t, port)} />}
          >
            {connected ? <span className="truncate text-xs text-muted-foreground">← {inputSources.get(buildInputSourceKey(id, port.key)) ?? t({ ko: '연결됨', en: 'Linked' })}</span> : null}
          </NodeRow>
        )
      })}
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
export function PowerLoraSummaryRow({ id, field, value }: { id: string; field: ModuleUiFieldDefinition; value: unknown }) {
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
    <NodeRow label={field.label || 'LoRA'}>
      <Button
        type="button"
        variant="link"
        title={t({ ko: '패널에서 편집', en: 'Edit in the panel' })}
        onMouseDown={stopNodeEvent}
        onClick={(event) => {
          event.stopPropagation()
          actions.editInPanel(id, field.key)
        }}
        className="nodrag h-auto min-w-0 justify-end p-0 text-xs font-normal text-foreground transition-none"
      >
        <span className="truncate">{summary}</span>
      </Button>
    </NodeRow>
  )
}
