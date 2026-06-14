import { type CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { getKeyValueConnectionKeys, normalizeKeyValueEntries, type KeyValueEntry } from '../module-graph-key-value-list-input'
import type { ModulePortDefinition } from '@/lib/api-module-graph'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import { buildHandleId, getPortTypeColor, type ModuleGraphNode } from '../../module-graph-shared'
import {
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  PortCell,
  buildHandleStyle,
  buildPortTooltip,
  stopNodeActionEvent,
  stopNodeInteraction,
} from '../module-graph-port-cells'
import { getRandomTextChoiceFieldValue } from './api-request-node-layout'

/** Render an expandable random text selector with API-node-style rows. */
export function RandomTextChoiceNodeLayout({
  id,
  data,
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
}: {
  id: string
  data: ModuleGraphNode['data']
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
}) {
  const { t } = useI18n()
  const parentPort = data.module.exposed_inputs?.find((port) => port.key === 'options')
  const outputPort = data.module.output_ports[0]
  const entries = normalizeKeyValueEntries(getRandomTextChoiceFieldValue(data))
  const visibleEntries = entries.length > 0 ? entries : [
    { key: 'text_1', value: '' },
    { key: 'text_2', value: '' },
  ]

  const updateEntry = (index: number, nextEntry: KeyValueEntry) => {
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
      data_type: 'text',
      required: false,
      multiple: false,
      default_value: undefined,
      description: t({ ko: '랜덤 선택 후보 텍스트', en: 'Random text choice candidate' }),
    }
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
        />
      </div>

      <div className="grid gap-1">
        {visibleEntries.map((entry, index) => {
          const dynamicPort = buildDynamicTextPort(entry.key)
          const connectionKey = dynamicPort?.key ?? null
          const connected = Boolean(connectionKey && connectedInputKeys.has(connectionKey))
          const portTypeColor = getPortTypeColor('text')
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
                <Input
                  value={connected ? t({ ko: '연결됨', en: 'Linked' }) : entry.value}
                  onChange={(event) => updateEntry(index, { ...entry, value: event.target.value })}
                  placeholder={t({ ko: '텍스트', en: 'Text' })}
                  className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
                  disabled={connected}
                />
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
