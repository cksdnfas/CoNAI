import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkflowModel } from '../../models/Workflow';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';

export function registerWorkflowTransferTools(server: McpServer): void {
  server.tool(
    'export_workflow_definition',
    'Export one workflow as a portable CoNAI definition.',
    { workflow_id: z.number().int().positive() },
    async ({ workflow_id }) => {
      const workflow = WorkflowModel.findByIdIncludingDeleted(workflow_id);
      if (!workflow) {
        const reference = HistoryQueryRepository.findWorkflowReference(workflow_id);
        return { isError: true, content: [{ type: 'text' as const, text: reference
          ? `삭제된 워크플로우(사용 불가): ${reference.workflow_name ?? `ID ${workflow_id}`}`
          : `Workflow with ID ${workflow_id} not found` }] };
      }
      const { artifact_root_path: _internalArtifactPath, deleted_at: _deletedAt, ...portable } = workflow;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ format: 'conai-workflow', version: 1, workflow: portable }, null, 2) }] };
    },
  );

  server.tool(
    'import_workflow_definition',
    'Import a portable CoNAI workflow definition.',
    { workflow: z.record(z.string(), z.unknown()) },
    async ({ workflow }) => {
      try {
        const name = typeof workflow.name === 'string' ? workflow.name.trim() : '';
        const workflowJson = typeof workflow.workflow_json === 'string' ? workflow.workflow_json : '';
        if (!name || !workflowJson) throw new Error('name and workflow_json are required');
        JSON.parse(workflowJson);
        if (WorkflowModel.existsByName(name)) throw new Error('Workflow name already exists');
        const markedFields = Array.isArray(workflow.marked_fields)
          ? workflow.marked_fields
          : typeof workflow.marked_fields === 'string'
            ? JSON.parse(workflow.marked_fields)
            : [];
        const id = WorkflowModel.create({
          name,
          description: typeof workflow.description === 'string' ? workflow.description : undefined,
          workflow_json: workflowJson,
          marked_fields: markedFields,
          api_endpoint: typeof workflow.api_endpoint === 'string' ? workflow.api_endpoint : undefined,
          is_active: workflow.is_active !== false,
          color: typeof workflow.color === 'string' ? workflow.color : undefined,
          result_view_mode: workflow.result_view_mode === 'artifact_explorer' ? 'artifact_explorer' : 'history',
          artifact_directory_mode: workflow.artifact_directory_mode === 'per_run' ? 'per_run' : 'shared',
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ id, name }, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Workflow import error: ${(error as Error).message}` }] };
      }
    },
  );

  server.tool(
    'restore_deleted_workflow',
    'Restore a soft-deleted workflow. Historical hard-deleted workflows cannot be restored without an exported definition.',
    { workflow_id: z.number().int().positive() },
    async ({ workflow_id }) => {
      if (!WorkflowModel.restore(workflow_id)) {
        const reference = HistoryQueryRepository.findWorkflowReference(workflow_id);
        return { isError: true, content: [{ type: 'text' as const, text: reference
          ? `복구할 수 없는 삭제된 워크플로우: ${reference.workflow_name ?? `ID ${workflow_id}`}`
          : `Deleted workflow ${workflow_id} not found` }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ workflow_id, restored: true }, null, 2) }] };
    },
  );
}
