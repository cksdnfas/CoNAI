import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GenerationQueueModel } from '../../models/GenerationQueue';
import { WorkflowModel } from '../../models/Workflow';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';
import { externalizeQueueInputDataUrls } from '../../services/generation-queue/queueInputStore';
import { GenerationQueueService } from '../../services/generationQueueService';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { normalizeWorkflowNumericPromptValues } from '../../services/workflowNumericFieldPolicy';
import type { McpRequestContext } from '../context';

async function describeJob(jobId: number, context: McpRequestContext) {
  const job = GenerationQueueModel.findListRecordById(jobId);
  if (!job) return null;
  const histories = HistoryQueryRepository.findAllWithMetadata({ queue_job_id: jobId, limit: 100 });
  const artifacts = context.baseUrl
    ? (await Promise.all(histories.map((history) => history.id
        ? McpArtifactService.createHistoryDescriptor(history.id, context.baseUrl as string)
        : null))).filter(Boolean)
    : [];
  const workflow = job.workflow_id ? WorkflowModel.findByIdIncludingDeleted(job.workflow_id) : null;
  const workflowDeleted = Boolean(job.workflow_id && (!workflow || workflow.deleted_at));
  return {
    ...job,
    workflow_deleted: workflowDeleted,
    workflow_availability: workflowDeleted ? '삭제된 워크플로우(사용 불가)' : 'available',
    history_ids: histories.map((history) => history.id),
    artifacts,
  };
}

export function registerGenerationJobTools(server: McpServer, context: McpRequestContext): void {
  server.tool(
    'submit_generation_job',
    'Submit a durable asynchronous generation job and return immediately with a job ID.',
    {
      service_type: z.enum(['comfyui', 'novelai', 'codex']),
      workflow_id: z.number().int().positive().optional(),
      server_id: z.number().int().positive().optional(),
      inputs: z.record(z.string(), z.unknown()).optional().describe('ComfyUI marked-field inputs, or a NovelAI/Codex payload alias'),
      request_payload: z.record(z.string(), z.unknown()).optional().describe('NovelAI/Codex generation parameters'),
      group_id: z.number().int().positive().optional(),
      priority: z.number().int().min(0).max(100000).default(100),
    },
    async ({ service_type, workflow_id, server_id, inputs, request_payload, group_id, priority }) => {
      try {
        let workflowName: string | null = null;
        let payload = request_payload ?? inputs ?? {};
        if (service_type === 'comfyui') {
          if (!workflow_id) throw new Error('workflow_id is required for ComfyUI jobs');
          const workflow = WorkflowModel.findByIdIncludingDeleted(workflow_id);
          if (!workflow || workflow.deleted_at) {
            const reference = HistoryQueryRepository.findWorkflowReference(workflow_id);
            if (!workflow && !reference) throw new Error(`Workflow with ID ${workflow_id} not found`);
            throw new Error(`삭제된 워크플로우(사용 불가): ${reference?.workflow_name ?? workflow?.name ?? `ID ${workflow_id}`}`);
          }
          if (!workflow.is_active) throw new Error(`Workflow with ID ${workflow_id} is inactive`);
          workflowName = workflow.name;
          const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];
          payload = {
            ...payload,
            prompt_data: externalizeQueueInputDataUrls(
              normalizeWorkflowNumericPromptValues(markedFields, inputs ?? payload.prompt_data ?? {}),
            ).value,
          };
        } else if (Object.keys(payload).length === 0) {
          throw new Error('request_payload is required for NovelAI and Codex jobs');
        }

        const jobId = GenerationQueueModel.create({
          service_type,
          priority,
          workflow_id: workflow_id ?? null,
          workflow_name: workflowName,
          requested_group_id: group_id ?? null,
          requested_server_id: server_id ?? null,
          request_payload: payload,
          request_summary: `MCP ${service_type} generation`,
        });
        GenerationQueueService.requestDispatch();
        return { content: [{ type: 'text' as const, text: JSON.stringify(await describeJob(jobId, context), null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Generation job error: ${(error as Error).message}` }] };
      }
    },
  );

  server.tool(
    'get_generation_job',
    'Get one durable generation job, its workflow availability, history IDs, and completed artifacts.',
    { job_id: z.number().int().positive() },
    async ({ job_id }) => {
      const job = await describeJob(job_id, context);
      return job
        ? { content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
    },
  );

  server.tool(
    'get_generation_artifacts',
    'Get downloadable artifacts for one generation job. Calling it again issues fresh signed download URLs.',
    { job_id: z.number().int().positive() },
    async ({ job_id }) => {
      const job = await describeJob(job_id, context);
      return job
        ? { content: [{ type: 'text' as const, text: JSON.stringify({ job_id, status: job.status, artifacts: job.artifacts }, null, 2) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
    },
  );

  server.tool(
    'refresh_artifact_download',
    'Issue a fresh signed download URL from a stable MCP artifact ID.',
    { artifact_id: z.string().min(1) },
    async ({ artifact_id }) => {
      if (!context.baseUrl) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Artifact downloads require the Streamable HTTP transport' }] };
      }
      const artifact = await McpArtifactService.refreshDescriptor(artifact_id, context.baseUrl);
      return artifact
        ? { content: [{ type: 'text' as const, text: JSON.stringify(artifact, null, 2) }] }
        : { isError: true, content: [{ type: 'text' as const, text: 'Artifact not found or artifact ID is invalid' }] };
    },
  );

  server.tool(
    'cancel_generation_job',
    'Request cancellation for one generation job.',
    { job_id: z.number().int().positive() },
    async ({ job_id }) => {
      try {
        await GenerationQueueService.requestCancellation(job_id, { origin: 'user' });
        return { content: [{ type: 'text' as const, text: JSON.stringify(await describeJob(job_id, context), null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Cancellation error: ${(error as Error).message}` }] };
      }
    },
  );
}
