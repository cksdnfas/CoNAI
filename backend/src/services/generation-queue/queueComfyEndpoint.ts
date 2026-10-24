import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { WorkflowModel } from '../../models/Workflow'
import type { ComfyUIServerRecord } from '../../types/comfyuiServer'

/** Cancellation uses the provided endpoint, stored assignment, then the workflow's legacy endpoint. */
export function resolveComfyQueueEndpoint(
  candidate: { assigned_server_id?: number | null; workflow_id?: number | null },
  assignedServer?: Pick<ComfyUIServerRecord, 'endpoint'> | null,
) {
  if (assignedServer?.endpoint) {
    return assignedServer.endpoint
  }

  if (candidate.assigned_server_id) {
    const server = ComfyUIServerModel.findById(candidate.assigned_server_id)
    if (server?.endpoint) {
      return server.endpoint
    }
  }

  if (candidate.workflow_id) {
    const workflow = WorkflowModel.findById(candidate.workflow_id)
    if (workflow?.api_endpoint) {
      return workflow.api_endpoint
    }
  }

  return null
}
