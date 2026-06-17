import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { ModuleGraphSimpleValueInput } from '../module-graph-simple-value-input'
import { ModuleGraphKeyValueListInput, getKeyValueConnectionKeys, normalizeKeyValueEntries, type KeyValueEntry } from '../module-graph-key-value-list-input'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import { buildHandleId, getPortTypeColor, type ModuleGraphNode } from '../../module-graph-shared'
import {
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  PortCell,
  buildHandleStyle,
  buildModuleUiFieldMap,
  buildPortTooltip,
  getCompactValuePreview,
  getInputPortState,
  stopNodeActionEvent,
  stopNodeInteraction,
  type ModuleUiFieldMap,
} from '../module-graph-port-cells'

/** Render one API request input row with its graph handle and inline editor kept together. */
function ApiRequestInputRow({
  nodeId,
  data,
  port,
  accentColor,
  connected,
  satisfied,
  requiredMissing,
  children,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  port?: ModulePortDefinition
  accentColor: string
  connected: boolean
  satisfied: boolean
  requiredMissing: boolean
  children: ReactNode
}) {
  const { t } = useI18n()

  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? t({ ko: '입력 필요', en: 'Input required' }) : connected ? t({ ko: '연결됨', en: 'Connected' }) : satisfied ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' })
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}26`

  return (
    <div className="relative min-h-[28px] border-b py-1 pl-4 pr-1" style={{ borderColor } as CSSProperties} title={buildPortTooltip(t, port, statusLabel)}>
      <Handle
        id={buildHandleId('in', port.key)}
        type="target"
        position={Position.Left}
        style={buildHandleStyle({ side: 'input', color: portTypeColor })}
        title={buildPortTooltip(t, port, statusLabel)}
        onMouseDown={connected ? () => data.onDisconnectNodeInput?.(nodeId, port.key) : undefined}
      />
      <div className="flex min-h-[28px] items-start gap-2">
        <span className="w-20 shrink-0 truncate pt-1 text-[11px] font-medium text-foreground">
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
        <div className="min-w-0 flex-1">
          {connected ? <div className="truncate pt-1 text-[10px] text-muted-foreground">{t({ ko: '연결됨', en: 'Linked' })}</div> : children}
        </div>
      </div>
    </div>
  )
}

function getApiRequestKeyValueFieldValue(data: ModuleGraphNode['data'], portKey: string) {
  const port = data.module.exposed_inputs?.find((candidate) => candidate.key === portKey)
  const field = data.module.ui_schema?.find((candidate) => candidate.key === portKey)
  return data.inputValues?.[portKey] ?? port?.default_value ?? field?.default_value
}

export function getApiRequestDynamicInputPortKeys(data: ModuleGraphNode['data']) {
  return [
    ...getKeyValueConnectionKeys(getApiRequestKeyValueFieldValue(data, 'values'), 'values'),
    ...getKeyValueConnectionKeys(getApiRequestKeyValueFieldValue(data, 'headers'), 'headers'),
  ]
}

export function getRandomTextChoiceFieldValue(data: ModuleGraphNode['data']) {
  const port = data.module.exposed_inputs?.find((candidate) => candidate.key === 'options')
  const field = data.module.ui_schema?.find((candidate) => candidate.key === 'options')
  return data.inputValues?.options ?? port?.default_value ?? field?.default_value
}

export function getRandomTextChoiceDynamicInputPortKeys(data: ModuleGraphNode['data']) {
  return getKeyValueConnectionKeys(getRandomTextChoiceFieldValue(data), 'options')
}

/** Render an API request node as a small request builder instead of a generic port list. */
export function ApiRequestNodeLayout({
  id,
  data,
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
  uiFieldByKey,
}: {
  id: string
  data: ModuleGraphNode['data']
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
  uiFieldByKey?: ModuleUiFieldMap
}) {
  const { t } = useI18n()
  const fallbackUiFieldByKey = useMemo(() => buildModuleUiFieldMap(data.module.ui_schema), [data.module.ui_schema])
  const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey
  const inputPortByKey = new Map((data.module.exposed_inputs ?? []).map((port) => [port.key, port] as const))
  const outputPort = data.module.output_ports[0]

  const getKeyValueFieldValue = (portKey: string) => {
    const port = inputPortByKey.get(portKey)
    const field = resolvedUiFieldByKey.get(portKey)
    return data.inputValues?.[portKey] ?? port?.default_value ?? field?.default_value
  }

  const renderInputRow = (portKey: string, editor: (port: ModulePortDefinition, field: ModuleUiFieldDefinition | null) => ReactNode) => {
    const port = inputPortByKey.get(portKey)
    const field = resolvedUiFieldByKey.get(portKey) ?? null
    const state = getInputPortState(data, port, connectedInputKeys)

    return (
      <ApiRequestInputRow
        key={portKey}
        nodeId={id}
        data={data}
        port={port}
        accentColor={accentColor}
        connected={state.connected}
        satisfied={state.satisfied}
        requiredMissing={state.requiredMissing}
      >
        {port ? editor(port, field) : null}
      </ApiRequestInputRow>
    )
  }

  const renderSimpleEditor = (port: ModulePortDefinition, field: ModuleUiFieldDefinition | null) => {
    const value = data.inputValues?.[port.key] ?? port.default_value ?? field?.default_value
    const dataType = field?.data_type === 'select'
      ? 'select'
      : port.data_type === 'number'
        ? 'number'
        : 'text'

    return (
      <ModuleGraphSimpleValueInput
        dataType={dataType}
        value={value}
        onChange={(nextValue) => data.onNodeValueChange?.(id, port.key, nextValue)}
        options={field?.options ?? []}
        placeholder={field?.placeholder || port.label}
        min={field?.min}
        max={field?.max}
        emptyLabel={t({ ko: '기본값', en: 'Default' })}
        className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
      />
    )
  }

  const renderKeyValueEditor = (port: ModulePortDefinition, field: ModuleUiFieldDefinition | null) => (
    <ModuleGraphKeyValueListInput
      compact
      value={getKeyValueFieldValue(port.key)}
      onChange={(nextValue) => data.onNodeValueChange?.(id, port.key, nextValue)}
      nodeId={id}
      connectionPrefix={port.key}
      connectionDataType={port.key === 'headers' ? 'text' : 'any'}
      connectedInputKeys={connectedInputKeys}
      onDisconnectInput={data.onDisconnectNodeInput}
    />
  )

  const updateKeyValueEntry = (portKey: string, entries: KeyValueEntry[], index: number, nextEntry: KeyValueEntry) => {
    data.onNodeValueChange?.(id, portKey, entries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry)))
  }

  const removeKeyValueEntry = (portKey: string, entries: KeyValueEntry[], index: number) => {
    data.onNodeValueChange?.(id, portKey, entries.filter((_, entryIndex) => entryIndex !== index))
  }

  const appendKeyValueEntry = (portKey: string, entries: KeyValueEntry[]) => {
    data.onNodeValueChange?.(id, portKey, [...entries, { key: '', value: '' }])
  }

  const buildDynamicKeyValuePort = (parentPort: ModulePortDefinition, portKey: string, entryKey: string): ModulePortDefinition | null => {
    const trimmedKey = entryKey.trim()
    if (!trimmedKey) {
      return null
    }

    return {
      ...parentPort,
      key: `${portKey}.${trimmedKey}`,
      label: trimmedKey,
      data_type: portKey === 'headers' ? 'text' : 'any',
      required: false,
      multiple: false,
      default_value: undefined,
      description: portKey === 'headers'
        ? t({ ko: 'API 요청 헤더 항목 값', en: 'API request header value' })
        : t({ ko: 'API 요청 입력 값 항목', en: 'API request input value' }),
    }
  }

  const renderKeyValueEntryRow = (portKey: string, parentPort: ModulePortDefinition, entries: KeyValueEntry[], entry: KeyValueEntry, index: number) => {
    const dynamicPort = buildDynamicKeyValuePort(parentPort, portKey, entry.key)
    const connectionKey = dynamicPort?.key ?? null
    const connected = Boolean(connectionKey && connectedInputKeys.has(connectionKey))
    const portTypeColor = getPortTypeColor(dynamicPort?.data_type ?? (portKey === 'headers' ? 'text' : 'any'))
    const statusLabel = connected ? t({ ko: '연결됨', en: 'Connected' }) : hasMeaningfulValue(entry.value) ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' })
    const borderColor = connected ? `${portTypeColor}88` : `${accentColor}26`

    return (
      <div key={`${portKey}-${index}`} className="relative min-h-[28px] border-b py-1 pl-4 pr-1" style={{ borderColor } as CSSProperties} title={dynamicPort ? buildPortTooltip(t, dynamicPort, statusLabel) : parentPort.label}>
        {dynamicPort ? (
          <Handle
            id={buildHandleId('in', dynamicPort.key)}
            type="target"
            position={Position.Left}
            style={buildHandleStyle({ side: 'input', color: portTypeColor })}
            title={buildPortTooltip(t, dynamicPort, statusLabel)}
            onMouseDown={connected ? () => data.onDisconnectNodeInput?.(id, dynamicPort.key) : undefined}
          />
        ) : null}
        <div className="nodrag nowheel grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto] gap-1" onMouseDown={stopNodeInteraction}>
          <Input
            value={entry.key}
            onChange={(event) => updateKeyValueEntry(portKey, entries, index, { ...entry, key: event.target.value })}
            placeholder={t({ ko: '키', en: 'Key' })}
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
          <Input
            value={connected ? t({ ko: '연결됨', en: 'Linked' }) : entry.value}
            onChange={(event) => updateKeyValueEntry(portKey, entries, index, { ...entry, value: event.target.value })}
            placeholder={t({ ko: '입력', en: 'Input' })}
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
            disabled={connected}
          />
          <Button type="button" size="icon-sm" variant="ghost" className="h-7 w-7" onMouseDown={stopNodeActionEvent} onClick={() => removeKeyValueEntry(portKey, entries, index)}>
            ×
          </Button>
        </div>
      </div>
    )
  }

  const renderKeyValueInputRows = (portKey: 'values' | 'headers') => {
    const port = inputPortByKey.get(portKey)
    if (!port) {
      return null
    }

    const entries = normalizeKeyValueEntries(getKeyValueFieldValue(portKey))
    if (entries.length === 0) {
      return renderInputRow(portKey, renderKeyValueEditor)
    }

    return (
      <div className="grid gap-1">
        {entries.map((entry, index) => renderKeyValueEntryRow(portKey, port, entries, entry, index))}
        <Button type="button" size="sm" variant="outline" className="nodrag nowheel h-7 text-[11px]" onMouseDown={stopNodeActionEvent} onClick={() => appendKeyValueEntry(portKey, entries)}>
          {t({ ko: '항목 추가', en: 'Add item' })}
        </Button>
      </div>
    )
  }

  const renderPayloadPreview = (port: ModulePortDefinition) => {
    const preview = getCompactValuePreview(data.inputValues?.[port.key] ?? port.default_value)
    return <div className="truncate pt-1 text-[10px] text-muted-foreground">{preview || t({ ko: '선택 입력', en: 'Optional input' })}</div>
  }

  return (
    <div className="mt-2 grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <div aria-hidden="true" />
        <PortCell
          nodeId={id}
          port={outputPort}
          side="output"
          accentColor={accentColor}
          connected={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          satisfied={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          requiredMissing={false}
          outputState={outputPort ? data.conditionalOutputStates?.[outputPort.key] ?? null : null}
        />
      </div>
      {renderInputRow('url', renderSimpleEditor)}
      {renderInputRow('method', renderSimpleEditor)}
      {renderInputRow('body_mode', renderSimpleEditor)}
      {renderKeyValueInputRows('values')}
      {renderKeyValueInputRows('headers')}
      {renderInputRow('payload', (port) => renderPayloadPreview(port))}
      {renderInputRow('timeout_ms', renderSimpleEditor)}
    </div>
  )
}
