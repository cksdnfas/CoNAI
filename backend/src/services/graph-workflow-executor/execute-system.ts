import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

/** Execute a CoNAI system-native module node through a stable operation key. */
export async function executeSystemModule(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey =
    typeof moduleDefinition.template_defaults?.operation_key === 'string'
      ? moduleDefinition.template_defaults.operation_key
      : typeof moduleDefinition.internal_fixed_values?.operation_key === 'string'
        ? moduleDefinition.internal_fixed_values.operation_key
        : null

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `System module start: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey,
      inputKeys: Object.keys(resolvedInputs),
    },
  })

  if (!operationKey) {
    throw new Error(`System module ${moduleDefinition.name} is missing operation_key`)
  }

  throw new Error(`System module operation not implemented yet: ${operationKey}`)
}
