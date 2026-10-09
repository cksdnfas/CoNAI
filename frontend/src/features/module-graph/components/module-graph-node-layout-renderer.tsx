import { useMemo } from 'react'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { isWorkflowInputSourceModule } from '../module-graph-workflow-inputs'
import type { ModuleGraphNode } from '../module-graph-shared'
import { hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import { isMiniMaxDirectorInputPort } from '../module-graph-minimax-director-ports'
import { ModuleGraphNodeCustomControls, useModuleGraphNodeCustomControls } from './module-graph-node-custom-controls'
import { resolveModuleGraphNodeLayout } from './module-graph-node-card-operation-registry'
import {
  ApiRequestNodeLayout,
  ConditionSelectNodeLayout,
  DefaultModulePortRows,
  IfBranchNodeLayout,
  MiniMaxDirectorNodeBody,
  PowerLoraSummaryRow,
  RandomTextChoiceNodeLayout,
  TextMergeNodeLayout,
  TextTransformNodeLayout,
  WorkflowInputSourceBody,
} from './module-graph-node-card-layouts'

export type ModuleGraphNodeBodyProps = {
  id: string
  data: ModuleGraphNode['data']
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
  visibleOutputPorts: ModulePortDefinition[]
}

export type ModuleGraphNodeLayoutProps = ModuleGraphNodeBodyProps & {
  uiFieldByKey: Map<string, ModuleUiFieldDefinition>
}

/** Pick the body for one node: value nodes, MiniMax Director, the dedicated system layouts, or plain port rows. */
export function ModuleGraphNodeBody(props: ModuleGraphNodeBodyProps) {
  const { id, data, connectedInputKeys } = props
  const { module } = data
  const uiFieldByKey = useMemo(() => new Map((module.ui_schema ?? []).map((field) => [field.key, field] as const)), [module.ui_schema])
  const layoutProps: ModuleGraphNodeLayoutProps = { ...props, uiFieldByKey }

  const powerLoraFields = (module.ui_schema ?? []).filter((field) => (
    isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(data.inputValues?.[field.key] ?? field.default_value)
  ))
  const powerLoraKeys = new Set(powerLoraFields.map((field) => field.key))
  const hasDirector = (module.ui_schema ?? []).some((field) => field.node_editor === 'minimax_h3_director_dasiwa')
  const plainInputPorts = (module.exposed_inputs ?? []).filter((port) => !powerLoraKeys.has(port.key) && !isMiniMaxDirectorInputPort(port))
  const customControls = useModuleGraphNodeCustomControls({ connectedInputKeys, data, id, inputPorts: plainInputPorts, uiFieldByKey })
  const controlRows = <ModuleGraphNodeCustomControls data={data} state={customControls} />
  const loraRows = powerLoraFields.map((field) => <PowerLoraSummaryRow key={field.key} id={id} module={module} field={field} value={data.inputValues?.[field.key] ?? field.default_value} />)

  if (isWorkflowInputSourceModule(module)) {
    return <WorkflowInputSourceBody {...layoutProps} />
  }

  if (hasDirector) {
    return (
      <MiniMaxDirectorNodeBody
        {...layoutProps}
        beforeInputs={<>{controlRows}{loraRows}</>}
        plainInputPorts={plainInputPorts.filter((port) => !customControls.hiddenInputPortKeys.has(port.key))}
      />
    )
  }

  switch (resolveModuleGraphNodeLayout(module)) {
    case 'text-merge':
      return <TextMergeNodeLayout {...layoutProps} />
    case 'random-text-choice':
      return <RandomTextChoiceNodeLayout {...layoutProps} />
    case 'text-transform':
      return <TextTransformNodeLayout {...layoutProps} />
    case 'condition-select':
      return <ConditionSelectNodeLayout {...layoutProps} />
    case 'if-branch':
      return <IfBranchNodeLayout {...layoutProps} />
    case 'api-request':
      return <ApiRequestNodeLayout {...layoutProps} />
    default:
      return (
        <DefaultModulePortRows
          {...layoutProps}
          beforeInputs={<>{controlRows}{loraRows}</>}
          inputPorts={plainInputPorts.filter((port) => !customControls.hiddenInputPortKeys.has(port.key))}
        />
      )
  }
}
