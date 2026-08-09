import type { ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import type { ModuleGraphNode } from '../module-graph-shared'
import {
  ApiRequestNodeLayout,
  ConditionSelectNodeLayout,
  DefaultModulePortRows,
  IfBranchNodeLayout,
  RandomTextChoiceNodeLayout,
  TextMergeNodeLayout,
  TextTransformNodeLayout,
} from './module-graph-node-card-layouts'
import type { ModuleGraphNodeLayoutKey } from './module-graph-node-card-operation-registry'

interface ModuleGraphNodeLayoutRendererProps {
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
  data: ModuleGraphNode['data']
  id: string
  layoutKey: ModuleGraphNodeLayoutKey
  uiFieldByKey: Map<string, ModuleUiFieldDefinition>
  visibleInputPorts: ModuleGraphNode['data']['module']['exposed_inputs']
  visibleOutputPorts: ModuleGraphNode['data']['module']['output_ports']
}

/** Render a registered specialized layout, falling back to the shared default port rows. */
export function ModuleGraphNodeLayoutRenderer({
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
  data,
  id,
  layoutKey,
  uiFieldByKey,
  visibleInputPorts,
  visibleOutputPorts,
}: ModuleGraphNodeLayoutRendererProps) {
  const commonProps = { id, data, accentColor, connectedInputKeys, connectedOutputKeys }

  switch (layoutKey) {
    case 'text-merge':
      return <TextMergeNodeLayout {...commonProps} uiFieldByKey={uiFieldByKey} />
    case 'random-text-choice':
      return <RandomTextChoiceNodeLayout {...commonProps} uiFieldByKey={uiFieldByKey} />
    case 'text-transform':
      return <TextTransformNodeLayout {...commonProps} uiFieldByKey={uiFieldByKey} />
    case 'condition-select':
      return <ConditionSelectNodeLayout {...commonProps} />
    case 'if-branch':
      return <IfBranchNodeLayout {...commonProps} uiFieldByKey={uiFieldByKey} />
    case 'api-request':
      return <ApiRequestNodeLayout {...commonProps} uiFieldByKey={uiFieldByKey} />
    default:
      return (
        <DefaultModulePortRows
          {...commonProps}
          uiFieldByKey={uiFieldByKey}
          visibleInputPorts={visibleInputPorts}
          visibleOutputPorts={visibleOutputPorts}
        />
      )
  }
}
