import { useI18n } from '@/i18n'
import { getKeyValueConnectionKeys, normalizeKeyValueEntries } from '../module-graph-key-value-list-input'
import type { ModuleGraphNode } from '../../module-graph-shared'
import { NodeInputRow, NodeRowDivider } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { NodeOutputRows } from './default-port-rows'
import { KeyValueEntryRows } from './key-value-entry-rows'

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

/** API request: URL, method and body mode, then the value and header lists, payload and timeout. */
export function ApiRequestNodeLayout(props: ModuleGraphNodeLayoutProps) {
  const { t } = useI18n()
  const { id, data, connectedInputKeys, uiFieldByKey, visibleOutputPorts } = props
  const portByKey = new Map((data.module.exposed_inputs ?? []).map((port) => [port.key, port] as const))

  const inputRow = (key: string) => {
    const port = portByKey.get(key)
    return port ? <NodeInputRow key={key} nodeId={id} data={data} port={port} uiField={uiFieldByKey.get(key) ?? null} connected={connectedInputKeys.has(key)} /> : null
  }
  const listRows = (key: 'values' | 'headers') => {
    const port = portByKey.get(key)
    if (!port) return null
    return (
      <div key={key}>
        <div className="flex h-6 items-center px-3 text-2xs font-semibold tracking-wide text-muted-foreground">{port.label}</div>
        <KeyValueEntryRows
          nodeId={id}
          fieldKey={key}
          parentPort={port}
          entries={normalizeKeyValueEntries(getApiRequestKeyValueFieldValue(data, key))}
          portDataType={key === 'headers' ? 'text' : 'any'}
          keyPlaceholder={t({ ko: '키', en: 'Key' })}
          valuePlaceholder={t({ ko: '값', en: 'Value' })}
          describePort={key === 'headers' ? t({ ko: 'API 요청 헤더 값', en: 'API request header value' }) : t({ ko: 'API 요청 입력 값', en: 'API request input value' })}
        />
      </div>
    )
  }

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      {inputRow('url')}
      {inputRow('method')}
      {inputRow('body_mode')}
      {listRows('values')}
      {listRows('headers')}
      {inputRow('payload')}
      {inputRow('timeout_ms')}
    </>
  )
}
