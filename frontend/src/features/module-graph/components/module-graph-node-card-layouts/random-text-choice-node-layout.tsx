import { useI18n } from '@/i18n'
import type { ModulePortDataType } from '@/lib/api-module-graph'
import { normalizeKeyValueEntries, type KeyValueEntry } from '../module-graph-key-value-list-input'
import { NodeFieldRow, NodeRowDivider } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { getRandomTextChoiceFieldValue } from './api-request-node-layout'
import { NodeOutputRows } from './default-port-rows'
import { KeyValueEntryRows } from './key-value-entry-rows'
import { getFieldValue } from './text-node-layouts'

type RandomChoiceOutputType = Extract<ModulePortDataType, 'text' | 'number' | 'boolean' | 'json' | 'any'>

function normalizeOutputType(value: unknown): RandomChoiceOutputType {
  return value === 'number' || value === 'boolean' || value === 'json' || value === 'any' ? value : 'text'
}

/** Random choice: output type, output, then the candidates (each one can also take a link). */
export function RandomTextChoiceNodeLayout({ id, data, uiFieldByKey, visibleOutputPorts }: ModuleGraphNodeLayoutProps) {
  const { t } = useI18n()
  const parentPort = data.module.exposed_inputs?.find((port) => port.key === 'options')
  const outputTypeField = uiFieldByKey.get('output_type')
  const outputType = normalizeOutputType(getFieldValue(data, outputTypeField))
  const stored = normalizeKeyValueEntries(getRandomTextChoiceFieldValue(data))
  const entries: KeyValueEntry[] = stored.length > 0 ? stored : [{ key: 'text_1', value: '' }, { key: 'text_2', value: '' }]

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      {outputTypeField ? <NodeFieldRow nodeId={id} data={data} field={outputTypeField} allowEmpty={false} /> : null}
      <KeyValueEntryRows
        nodeId={id}
        fieldKey="options"
        parentPort={parentPort}
        entries={entries}
        portDataType="any"
        valueKind={outputType === 'number' || outputType === 'boolean' ? outputType : 'text'}
        keyPlaceholder={t({ ko: '이름', en: 'Name' })}
        valuePlaceholder={outputType === 'json' ? '{ "key": "value" }' : t({ ko: '값', en: 'Value' })}
        describePort={t({ ko: '랜덤 선택 후보 값', en: 'Random item candidate' })}
        createEntry={(current) => {
          const used = new Set(current.map((entry) => entry.key.trim()))
          let index = current.length + 1
          while (used.has(`text_${index}`)) index += 1
          return { key: `text_${index}`, value: '' }
        }}
      />
    </>
  )
}
