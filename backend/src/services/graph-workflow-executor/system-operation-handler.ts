import type { GraphWorkflowNode } from '../../types/moduleGraph'
import type { ExecutionContext, ParsedModuleDefinition } from './shared'

export type SystemOperationHandler = (
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) => Promise<void> | void
