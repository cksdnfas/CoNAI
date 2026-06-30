import { useMemo, type CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { ModuleGraphSimpleValueInput } from '../module-graph-simple-value-input'
import { getKeyValueConnectionKeys, normalizeKeyValueEntries } from '../module-graph-key-value-list-input'
import type { ModulePortDataType, ModulePortDefinition } from '@/lib/api-module-graph'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import { buildHandleId, getPortTypeColor, type ModuleGraphNode } from '../../module-graph-shared'
import {
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  PortCell,
  buildModuleUiFieldMap,
  buildHandleStyle,
  buildPortTooltip,
  stopNodeActionEvent,
  stopNodeInteraction,
  type ModuleUiFieldMap,
} from '../module-graph-port-cells'
import { getRandomTextChoiceFieldValue } from './api-request-node-layout'
import { getInlineUiFieldValue, renderCompactUiField } from './layout-common'

type RandomChoiceOutputType = Extract<ModulePortDataType, 'text' | 'number' | 'boolean' | 'json' | 'any'>
type RandomChoiceEntry = {
  key: string
  value: unknown
}

function normalizeRandomChoiceOutputType(value: unknown): RandomChoiceOutputType {
  return value === 'number'
    || value === 'boolean'
    || value === 'json'
    || value === 'any'
    ? value
    : 'text'
}

function getRandomChoiceInlineInputType(outputType: RandomChoiceOutputType) {
  return outputType === 'number' || outputType === 'boolean' ? outputType : 'text'
}

/** Render an expandable random text selector with API-node-style rows. */
export function RandomTextChoiceNodeLayout({
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
  const parentPort = data.module.exposed_inputs?.find((port) => port.key === 'options')
  const outputPort = data.module.output_ports[0]
  const fallbackUiFieldByKey = useMemo(() => buildModuleUiFieldMap(data.module.ui_schema), [data.module.ui_schema])
  const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey
  const outputTypeField = resolvedUiFieldByKey.get('output_type')
  const outputType = normalizeRandomChoiceOutputType(getInlineUiFieldValue(data.inputValues?.output_type, outputTypeField))
  const entries: RandomChoiceEntry[] = normalizeKeyValueEntries(getRandomTextChoiceFieldValue(data))
  const visibleEntries = entries.length > 0 ? entries : [
    { key: 'text_1', value: '' },
    { key: 'text_2', value: '' },
  ]
  const inlineInputType = getRandomChoiceInlineInputType(outputType)

  const updateEntry = (index: number, nextEntry: RandomChoiceEntry) => {
    data.onNodeValueChange?.('' + id, 'options', visibleEntries.map((entry, entryIndex) => (entryIndex === index ? nextEntry : entry)))
  }

  const removeEntry = (index: number) => {
    const nextEntries = visibleEntries.filter((_, entryIndex) => entryIndex !== index)
    data.onNodeValueChange?.(id, 'options', nextEntries.length > 0 ? nextEntries : [])
  }

  const appendEntry = () => {
    const usedKeys = new Set(visibleEntries.map((entry) => entry.key.trim()).filter(Boolean))
    let nextIndex = visibleEntries.length + 1
    while (usedKeys.has(`text_${nextIndex}`)) {
      nextIndex += 1
    }
    data.onNodeValueChange?.(id, 'options', [...visibleEntries, { key: `text_${nextIndex}`, value: '' }])
  }

  const buildDynamicTextPort = (entryKey: string): ModulePortDefinition | null => {
    const trimmedKey = entryKey.trim()
    if (!parentPort || !trimmedKey) {
      return null
    }

    return {
      ...parentPort,
      key: `options.${trimmedKey}`,
      label: trimmedKey,
      data_type: 'any',
      required: false,
      multiple: false,
      default_value: undefined,
      description: t({ ko: '랜덤 선택 후보 값', en: 'Random item candidate' }),
    }
  }

  return (
    <div className="mt-2 grid gap-1">
      {outputTypeField ? (
        <div className="px-0.5 pb-1">
          {renderCompactUiField({ id, data, field: outputTypeField, value: outputType, allowEmptyOption: false, t })}
        </div>
      ) : null}

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

      <div className="grid gap-1">
        {visibleEntries.map((entry, index) => {
          const dynamicPort = buildDynamicTextPort(entry.key)
          const connectionKey = dynamicPort?.key ?? null
          const connected = Boolean(connectionKey && connectedInputKeys.has(connectionKey))
          const portTypeColor = getPortTypeColor(outputType === 'any' ? 'any' : outputType)
          const statusLabel = connected ? t({ ko: '연결됨', en: 'Connected' }) : hasMeaningfulValue(entry.value) ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' })
          const borderColor = connected ? `${portTypeColor}88` : `${accentColor}26`

          return (
            <div key={`${entry.key || 'option'}-${index}`} className="relative min-h-[28px] border-b py-1 pl-4 pr-1" style={{ borderColor } as CSSProperties} title={dynamicPort ? buildPortTooltip(t, dynamicPort, statusLabel) : parentPort?.label}>
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
                  onChange={(event) => updateEntry(index, { ...entry, key: event.target.value })}
                  placeholder={t({ ko: '이름', en: 'Name' })}
                  className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
                />
                {connected ? (
                  <Input
                    value={t({ ko: '연결됨', en: 'Linked' })}
                    onChange={() => undefined}
                    className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
                    disabled
                  />
                ) : (
                  <ModuleGraphSimpleValueInput
                    dataType={inlineInputType}
                    value={entry.value}
                    onChange={(nextValue) => updateEntry(index, { ...entry, value: nextValue })}
                    placeholder={outputType === 'json' ? '{ "key": "value" }' : t({ ko: '값', en: 'Value' })}
                    emptyLabel={t({ ko: '선택', en: 'Select' })}
                    className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
                    allowEmptyOption
                  />
                )}
                <Button type="button" size="icon-sm" variant="ghost" className="h-7 w-7" onMouseDown={stopNodeActionEvent} onClick={() => removeEntry(index)}>
                  ×
                </Button>
              </div>
            </div>
          )
        })}
        <Button type="button" size="sm" variant="outline" className="nodrag nowheel h-7 text-[11px]" onMouseDown={stopNodeActionEvent} onClick={appendEntry}>
          {t({ ko: '항목 추가', en: 'Add item' })}
        </Button>
      </div>
    </div>
  )
}
