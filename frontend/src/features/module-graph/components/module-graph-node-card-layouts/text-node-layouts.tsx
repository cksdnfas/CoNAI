import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { hasMeaningfulValue } from '../module-graph-field-shared'
import { stopNodeEvent } from '../module-graph-node-controls'
import { NodeFieldRow, NodeInputRow, NodeRowDivider } from '../module-graph-node-rows'
import type { ModuleGraphNodeLayoutProps } from '../module-graph-node-layout-renderer'
import { NodeOutputRows } from './default-port-rows'

/** Current value of one setting, falling back to its default. */
export function getFieldValue(data: ModuleGraphNodeLayoutProps['data'], field: ModuleUiFieldDefinition | undefined) {
  if (!field) return undefined
  return data.inputValues?.[field.key] ?? field.default_value
}

function InputRows({ id, data, connectedInputKeys, uiFieldByKey, ports }: ModuleGraphNodeLayoutProps & { ports: ModuleGraphNodeLayoutProps['data']['module']['exposed_inputs'] }) {
  return (
    <>
      {ports.map((port) => (
        <NodeInputRow key={port.key} nodeId={id} data={data} port={port} uiField={uiFieldByKey.get(port.key) ?? null} connected={connectedInputKeys.has(port.key)} />
      ))}
    </>
  )
}

/** Text merge: output, then A / B / C with the text placed between them. */
export function TextMergeNodeLayout(props: ModuleGraphNodeLayoutProps) {
  const { t } = useI18n()
  const { id, data, uiFieldByKey, visibleOutputPorts } = props
  const separatorAb = uiFieldByKey.get('separator_ab') ?? { key: 'separator_ab', label: t({ ko: 'A·B 사이', en: 'Between A and B' }), data_type: 'text', default_value: ',' }
  const separatorBc = uiFieldByKey.get('separator_bc') ?? { key: 'separator_bc', label: t({ ko: 'B·C 사이', en: 'Between B and C' }), data_type: 'text', default_value: ',' }
  const ports = data.module.exposed_inputs ?? []

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      <InputRows {...props} ports={ports.slice(0, 1)} />
      <NodeFieldRow nodeId={id} data={data} field={separatorAb as ModuleUiFieldDefinition} />
      <InputRows {...props} ports={ports.slice(1, 2)} />
      <NodeFieldRow nodeId={id} data={data} field={separatorBc as ModuleUiFieldDefinition} />
      <InputRows {...props} ports={ports.slice(2)} />
    </>
  )
}

/** Regex / text transform: one input, the transform settings (flags folded away), one output. */
export function TextTransformNodeLayout(props: ModuleGraphNodeLayoutProps) {
  const { t } = useI18n()
  const { id, data, uiFieldByKey, visibleOutputPorts } = props
  const field = (key: string) => uiFieldByKey.get(key)
  const mode = getFieldValue(data, field('mode'))
  const flagsField = field('flags')
  const [showFlags, setShowFlags] = useState(() => hasMeaningfulValue(data.inputValues?.flags))
  const settingKeys = ['mode', 'pattern', mode === 'replace' ? 'replacement' : 'group_index', 'prefix', 'suffix']

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      <InputRows {...props} ports={(data.module.exposed_inputs ?? []).slice(0, 1)} />
      {settingKeys.map((key) => {
        const settingField = field(key)
        return settingField ? <NodeFieldRow key={key} nodeId={id} data={data} field={settingField} allowEmpty={key !== 'mode'} /> : null
      })}
      {flagsField ? (
        <>
          {showFlags ? <NodeFieldRow nodeId={id} data={data} field={flagsField} /> : null}
          <div className="px-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={showFlags}
              onMouseDown={stopNodeEvent}
              onClick={(event) => {
                event.stopPropagation()
                setShowFlags((current) => !current)
              }}
              className="nodrag text-2xs font-normal"
            >
              <ChevronDown className={cn('transition-transform', !showFlags && '-rotate-90')} />
              {t({ ko: '플래그', en: 'Flags' })}
            </Button>
          </div>
        </>
      ) : null}
    </>
  )
}

/** Condition select: the output, then each candidate input. */
export function ConditionSelectNodeLayout(props: ModuleGraphNodeLayoutProps) {
  const { id, data, visibleOutputPorts } = props
  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      <InputRows {...props} ports={data.module.exposed_inputs ?? []} />
    </>
  )
}

/** IF branch: its two outputs, the condition settings, then the inputs it checks. */
export function IfBranchNodeLayout(props: ModuleGraphNodeLayoutProps) {
  const { id, data, uiFieldByKey, visibleOutputPorts } = props
  const modeField = uiFieldByKey.get('mode')
  const expectedTypeField = uiFieldByKey.get('expected_type')
  const mode = getFieldValue(data, modeField)

  return (
    <>
      <NodeOutputRows id={id} data={data} ports={visibleOutputPorts} />
      <NodeRowDivider />
      {modeField ? <NodeFieldRow nodeId={id} data={data} field={modeField} allowEmpty={false} /> : null}
      {expectedTypeField && mode === 'type_is' ? <NodeFieldRow nodeId={id} data={data} field={expectedTypeField} allowEmpty={false} /> : null}
      <InputRows {...props} ports={data.module.exposed_inputs ?? []} />
    </>
  )
}
