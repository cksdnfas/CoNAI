import { AsyncLocalStorage } from 'async_hooks'
import { GraphExecutionModel } from '../../models/GraphExecution'
import { GraphWorkflowScheduleModel } from '../../models/GraphWorkflowSchedule'
import { requireRequesterRight } from '../../middleware/featureAccess'
import type { McpRequestContext } from '../../mcp/context'
import { requireCurrentMcpKeyImagePermission } from '../generation-queue/queueMcpImageGrant'
import type { ExecutionContext } from './shared'

export const GRAPH_IMAGE_AUTHORITY_INPUT = '__conaiGraphImageAuthority'

type GraphImageAuthority =
  | { kind: 'mcp-key'; keyId: string; groupKey: string }
  | { kind: 'stdio' | 'legacy-schedule' }
  | { kind: 'account' | 'bootstrap' }

const localAuthority = new AsyncLocalStorage<{ kind: 'mcp-key'; keyId: string } | { kind: 'stdio' }>()

/** Only MCP's server-created context can establish an in-process graph authority. */
export function withMcpGraphImageAuthority<T>(context: McpRequestContext, run: () => T): T {
  if (!context.requester && context.keyId && context.keyGroup !== undefined) {
    return localAuthority.run({ kind: 'mcp-key', keyId: context.keyId }, run)
  }
  if (!context.requester && context.keyGroup === undefined && context.source === undefined) {
    return localAuthority.run({ kind: 'stdio' }, run)
  }
  return run()
}

/** Recheck the actual caller, or a server-recorded legacy schedule, before each library access. */
export function requireGraphImageAuthority(context: ExecutionContext): GraphImageAuthority {
  if (context.requestedByAccountId != null) {
    requireRequesterRight({ accountId: context.requestedByAccountId, accountType: null }, 'read')
    return { kind: 'account' }
  }

  const local = localAuthority.getStore()
  if (local?.kind === 'mcp-key') {
    return { ...local, groupKey: requireCurrentMcpKeyImagePermission(local.keyId) }
  }
  if (local?.kind === 'stdio') return local

  const execution = GraphExecutionModel.findById(context.executionId)
  if (execution?.trigger_type === 'schedule' && execution.schedule_id != null && execution.requested_by_account_id == null) {
    const schedule = GraphWorkflowScheduleModel.findById(execution.schedule_id)
    const plan = execution.execution_plan ? JSON.parse(execution.execution_plan) as { runtimeInputValues?: Record<string, unknown> } : null
    if (schedule && schedule.graph_workflow_id === context.workflow.id && schedule.run_as_account_id == null
      && plan?.runtimeInputValues?.[GRAPH_IMAGE_AUTHORITY_INPUT] === 'legacy-schedule') {
      return { kind: 'legacy-schedule' }
    }
  }

  requireRequesterRight({ accountId: null, accountType: null }, 'read')
  return { kind: 'bootstrap' }
}
