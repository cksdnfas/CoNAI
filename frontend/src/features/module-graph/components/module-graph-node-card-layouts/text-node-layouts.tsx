import { useEffect, useMemo, useState } from 'react'
import { ModuleGraphSimpleValueInput } from '../module-graph-simple-value-input'
import { useI18n } from '@/i18n'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import type { ModuleGraphNode } from '../../module-graph-shared'
import {
  InputPortCell,
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  PortCell,
  buildModuleUiFieldMap,
  getInputPortState,
  stopNodeActionEvent,
  stopNodeInteraction,
  type ModuleUiFieldMap,
} from '../module-graph-port-cells'
import { getInlineUiFieldValue, renderCompactUiField } from './layout-common'

/** Render one compact inline separator editor that matches normal node row height. */
function TextMergeSeparatorCell({ id, data, field }: { id: string; data: ModuleGraphNode['data']; field: ModuleUiFieldDefinition }) {
  const rawValue = data.inputValues?.[field.key]
  const value = rawValue == null
    ? (typeof field.default_value === 'string' && field.default_value.length > 0 ? field.default_value : ',')
    : String(rawValue)

  return (
    <div onMouseDown={stopNodeInteraction}>
      <ModuleGraphSimpleValueInput
        dataType="text"
        value={value}
        onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
        className={`nodrag nowheel h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
      />
    </div>
  )
}

/** Render the dedicated text-merge node layout with top output and A/B/C rows. */
export function TextMergeNodeLayout({
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
  const inputPorts = data.module.exposed_inputs ?? []
  const outputPort = data.module.output_ports[0]
  const fallbackUiFieldByKey = useMemo(() => buildModuleUiFieldMap(data.module.ui_schema), [data.module.ui_schema])
  const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey
  const separatorAbField = resolvedUiFieldByKey.get('separator_ab') ?? {
    key: 'separator_ab',
    label: t({ ko: 'A 뒤 문자열', en: 'Text after A' }),
    data_type: 'text',
    default_value: ',',
  }
  const separatorBcField = resolvedUiFieldByKey.get('separator_bc') ?? {
    key: 'separator_bc',
    label: t({ ko: 'B 뒤 문자열', en: 'Text after B' }),
    data_type: 'text',
    default_value: ',',
  }

  const buildInputCell = (port?: ModulePortDefinition) => {
    const connected = Boolean(port && connectedInputKeys.has(port.key))
    const satisfied = Boolean(port && (connected || hasMeaningfulValue(data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)))

    return (
      <PortCell
        nodeId={id}
        port={port}
        side="input"
        accentColor={accentColor}
        connected={connected}
        satisfied={satisfied}
        requiredMissing={false}
        onDisconnectInput={data.onDisconnectNodeInput}
      />
    )
  }

  return (
    <div className="mt-2.5 grid gap-1">
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

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[0])}
        <TextMergeSeparatorCell id={id} data={data} field={separatorAbField} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[1])}
        <TextMergeSeparatorCell id={id} data={data} field={separatorBcField} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[2])}
        <div aria-hidden="true" />
      </div>
    </div>
  )
}

/** Render one minimal inline field for transform-style system nodes without extra card chrome. */
function TextTransformInlineField({
  id,
  data,
  field,
}: {
  id: string
  data: ModuleGraphNode['data']
  field: ModuleUiFieldDefinition
}) {
  const { t } = useI18n()
  return renderCompactUiField({ id, data, field, t })
}

/** Render the regex/text transform node with one source input and inline transform settings. */
export function TextTransformNodeLayout({
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
  const inputPort = data.module.exposed_inputs[0]
  const outputPort = data.module.output_ports[0]
  const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
  const fallbackUiFieldByKey = useMemo(() => buildModuleUiFieldMap(data.module.ui_schema), [data.module.ui_schema])
  const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey
  const modeField = resolvedUiFieldByKey.get('mode')
  const patternField = resolvedUiFieldByKey.get('pattern')
  const flagsField = resolvedUiFieldByKey.get('flags')
  const replacementField = resolvedUiFieldByKey.get('replacement')
  const groupIndexField = resolvedUiFieldByKey.get('group_index')
  const prefixField = resolvedUiFieldByKey.get('prefix')
  const suffixField = resolvedUiFieldByKey.get('suffix')
  const currentMode = getInlineUiFieldValue(data.inputValues?.mode, modeField)
  const hasAdvancedFlagsValue = hasMeaningfulValue(data.inputValues?.flags)
  const [showAdvancedFields, setShowAdvancedFields] = useState(hasAdvancedFlagsValue)

  useEffect(() => {
    if (hasAdvancedFlagsValue) {
      setShowAdvancedFields(true)
    }
  }, [hasAdvancedFlagsValue])

  return (
    <div className="mt-2 grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <InputPortCell
          nodeId={id}
          data={data}
          port={inputPort}
          uiField={inputPort ? resolvedUiFieldByKey.get(inputPort.key) ?? null : null}
          accentColor={accentColor}
          connected={inputPortState.connected}
          satisfied={inputPortState.satisfied}
          requiredMissing={inputPortState.requiredMissing}
        />
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

      <div className="grid gap-1 px-0.5 pt-1">
        {modeField ? <TextTransformInlineField id={id} data={data} field={modeField} /> : null}
        {patternField ? <TextTransformInlineField id={id} data={data} field={patternField} /> : null}
        {currentMode === 'replace'
          ? (replacementField ? <TextTransformInlineField id={id} data={data} field={replacementField} /> : null)
          : (groupIndexField ? <TextTransformInlineField id={id} data={data} field={groupIndexField} /> : null)}
        {prefixField ? <TextTransformInlineField id={id} data={data} field={prefixField} /> : null}
        {suffixField ? <TextTransformInlineField id={id} data={data} field={suffixField} /> : null}
        {flagsField && showAdvancedFields ? <TextTransformInlineField id={id} data={data} field={flagsField} /> : null}
        {flagsField ? (
          <button
            type="button"
            className="nodrag nowheel flex min-h-[28px] items-center justify-between border-b border-border/30 px-1 pb-1 text-[11px] text-muted-foreground"
            onMouseDown={stopNodeActionEvent}
            onClick={() => setShowAdvancedFields((current) => !current)}
          >
            <span>flags</span>
            <span>{showAdvancedFields ? '−' : '+'}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Render the IF branch node with node-level condition controls instead of hiding them in module config. */
export function IfBranchNodeLayout({
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
  const inputPorts = data.module.exposed_inputs ?? []
  const outputPorts = data.module.output_ports ?? []
  const fallbackUiFieldByKey = useMemo(() => buildModuleUiFieldMap(data.module.ui_schema), [data.module.ui_schema])
  const resolvedUiFieldByKey = uiFieldByKey ?? fallbackUiFieldByKey
  const modeField = resolvedUiFieldByKey.get('mode')
  const expectedTypeField = resolvedUiFieldByKey.get('expected_type')
  const modeValue = getInlineUiFieldValue(data.inputValues?.mode, modeField)
  const portRowCount = Math.max(inputPorts.length, outputPorts.length, 1)

  return (
    <div className="mt-2 grid gap-1">
      <div className="grid gap-1 px-0.5 pb-1">
        {modeField ? renderCompactUiField({ id, data, field: modeField, value: modeValue, allowEmptyOption: false, t }) : null}
        {expectedTypeField && modeValue === 'type_is'
          ? renderCompactUiField({ id, data, field: expectedTypeField, allowEmptyOption: false, t })
          : null}
      </div>

      <div className="grid gap-1">
        {Array.from({ length: portRowCount }, (_, index) => {
          const inputPort = inputPorts[index]
          const outputPort = outputPorts[index]
          const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
          const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

          return (
            <div key={`if-port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
              <InputPortCell
                nodeId={id}
                data={data}
                port={inputPort}
                uiField={inputPort ? resolvedUiFieldByKey.get(inputPort.key) ?? null : null}
                accentColor={accentColor}
                connected={inputPortState.connected}
                satisfied={inputPortState.satisfied}
                requiredMissing={inputPortState.requiredMissing}
              />
              <PortCell
                nodeId={id}
                port={outputPort}
                side="output"
                accentColor={accentColor}
                connected={outputConnected}
                satisfied={outputConnected}
                requiredMissing={false}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
