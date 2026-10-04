import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GenerationQueueModel } from '../../models/GenerationQueue';
import { WorkflowModel } from '../../models/Workflow';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';
import { externalizeQueueInputDataUrls } from '../../services/generation-queue/queueInputStore';
import { GenerationQueueService } from '../../services/generationQueueService';
import { codexGenerationRequestSchema, getCodexModelSuggestions, parseCodexGenerationRequest } from '../../services/codexGenerationOptions';
import { buildGenerationHistoryRequestSnapshot } from '../../services/generationHistoryRequestSnapshot';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { normalizeWorkflowNumericPromptValues } from '../../services/workflowNumericFieldPolicy';
import { parseGenerationQueueRoutingTag } from '../../services/generationQueueRouting';
import { assertChatNaiSampleCount, type McpRequestContext } from '../context';
import { normalizeMcpWorkflowInputs, parseMcpMarkedFields } from './mcpComfyWorkflowService';
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup';
import {
  describeMcpGenerationJobRouting,
  getMcpGenerationRoutingOptions,
  getMcpGenerationRoutingRules,
  resolveMcpGenerationRoutingInput,
} from './generationJobRouting';

/** Serialize JSON-compatible request values deterministically across object key order. */
function stringifyStableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyStableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stringifyStableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Build the semantic request hash used to detect conflicting idempotent retries. */
function buildIdempotencyRequestHash(value: Record<string, unknown>) {
  return crypto.createHash('sha256').update(stringifyStableJson(value)).digest('hex');
}

/** Scope idempotency to the authenticated MCP key, with one local transport fallback. */
function resolveIdempotencyScope(context: McpRequestContext) {
  return context.keyId ? `mcp-key:${context.keyId}` : 'mcp-local';
}

const WAIT_POLL_MS = 1000;
const WAIT_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

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
    routing: describeMcpGenerationJobRouting(job),
    workflow_deleted: workflowDeleted,
    workflow_availability: workflowDeleted ? '삭제된 워크플로우(사용 불가)' : 'available',
    history_ids: histories.map((history) => history.id),
    artifacts,
  };
}

export function registerGenerationJobTools(server: McpServer, context: McpRequestContext): void {
  server.tool(
    'get_codex_generation_options',
    'Get the Codex image-generation request schema and the agent models the server\'s Codex CLI offers. Use the same parameters as the Codex UI with submit_generation_job(service_type="codex"). The list may be incomplete; custom model IDs are accepted. Prompts are saved with results; use get_generation_history_request to retrieve them and create_prompt_preset to save reusable text.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({
      ...await getCodexModelSuggestions(),
      request_schema: z.toJSONSchema(codexGenerationRequestSchema),
      default_model: 'Server Codex CLI default when model is omitted or empty',
      example: { service_type: 'codex', request_payload: { prompt: 'Create a blue ceramic teapot', model: '', operation: 'generate', size: '1024x1024', count: 1 } },
    }, null, 2) }] }),
  );

  server.tool(
    'get_generation_history_request',
    'Read the full saved prompt, negative prompt, selected model and request settings behind a generation result, as used by the UI reuse action. Image bytes are omitted; pruned requests may only retain result prompts.',
    { history_id: z.number().int().positive() },
    async ({ history_id }) => {
      const record = HistoryQueryRepository.findAllWithMetadata({ ids: [history_id], limit: 1 })[0];
      if (!record) return { isError: true, content: [{ type: 'text' as const, text: 'Generation history not found' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(buildGenerationHistoryRequestSnapshot(record), null, 2) }] };
    },
  );

  server.tool(
    'submit_generation_job',
    'Submit a durable asynchronous generation job and return immediately with a job ID. For NovelAI (service_type="novelai") pass request_payload directly, no lookups needed: { prompt (required; comma-separated Danbooru-style tags), negative_prompt, model (default "nai-diffusion-4-5-curated"; also nai-diffusion-4-5-full, nai-diffusion-5-curated, nai-diffusion-5-full), width/height (multiples of 64: 832x1216 portrait, 1216x832 landscape, 1024x1024 square), steps (default 28), scale (default 5), sampler (default k_euler_ancestral), seed, n_samples (keep 1), characters: [{ prompt, uc, center_x, center_y }] for per-character prompts }. After submitting, call wait_generation_job with the returned job id instead of polling get_generation_job. For Codex, get_codex_generation_options documents all UI-equivalent parameters including model, reference generation, editing, masks and save options. For ComfyUI: omit server_id and server_tag for automatic queue distribution, provide server_id for one fixed server, or provide server_tag for exact-tag routing.',
    {
      service_type: z.enum(['comfyui', 'novelai', 'codex']),
      workflow_id: z.number().int().positive().optional(),
      server_id: z.number().int().positive().optional().describe('ComfyUI only. Target one active workflow-eligible server. Cannot be combined with server_tag.'),
      server_tag: z.string().trim().min(1).max(64).optional().describe('ComfyUI only. Route to an active workflow-eligible server with this exact normalized tag. Cannot be combined with server_id.'),
      inputs: z.record(z.string(), z.unknown()).optional().describe('ComfyUI marked-field inputs, or a NovelAI/Codex payload alias'),
      request_payload: z.record(z.string(), z.unknown()).optional().describe('NovelAI/Codex generation parameters. NovelAI: prompt, negative_prompt, model, width, height, steps, scale, sampler, seed, n_samples (1), characters. Codex (see get_codex_generation_options): model (real CLI agent-model override), prompt, negative_prompt, operation, image, mask, size, count and imageSaveOptions.'),
      group_id: z.number().int().positive().optional(),
      group_path: mcpGroupPathSchema,
      priority: z.number().int().min(0).max(100000).default(100),
      idempotency_key: z.string().trim().min(1).max(200).optional().describe('Optional retry key. The same MCP key and request return the original job; a different request conflicts.'),
    },
    async ({ service_type, workflow_id, server_id, server_tag, inputs, request_payload, group_id, group_path, priority, idempotency_key }) => {
      try {
        const normalizedServerTag = parseGenerationQueueRoutingTag(server_tag, 'server_tag');
        if (server_id != null && normalizedServerTag !== undefined) {
          throw new Error('server_id and server_tag cannot be combined');
        }
        if (service_type !== 'comfyui' && (server_id != null || normalizedServerTag !== undefined)) {
          throw new Error('server_id and server_tag are only valid for comfyui jobs');
        }
        const idempotencyScope = idempotency_key ? resolveIdempotencyScope(context) : null;
        const requestHash = idempotency_key
          ? buildIdempotencyRequestHash({
              service_type,
              workflow_id: workflow_id ?? null,
              server_id: server_id ?? null,
              server_tag: normalizedServerTag ?? null,
              inputs: inputs ?? null,
              request_payload: request_payload ?? null,
              group_id: group_id ?? null,
              ...(group_path ? { group_path } : {}),
              priority,
            })
          : null;

        if (idempotency_key && idempotencyScope && requestHash) {
          const existing = GenerationQueueModel.findIdempotentJob(idempotencyScope, idempotency_key);
          if (existing) {
            if (existing.request_hash !== requestHash) {
              throw new Error(`idempotency_key "${idempotency_key}" was already used with a different request payload`);
            }
            const job = await describeJob(existing.job_id, context);
            if (!job) throw new Error(`Idempotent queue job ${existing.job_id} no longer exists`);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ ...job, idempotency_key, idempotency_reused: true }, null, 2),
              }],
            };
          }
        }

        let workflowName: string | null = null;
        let payload = request_payload ?? inputs ?? {};
        let routing: ReturnType<typeof resolveMcpGenerationRoutingInput>;
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
          routing = resolveMcpGenerationRoutingInput({
            serviceType: service_type,
            workflowId: workflow_id,
            serverId: server_id,
            serverTag: normalizedServerTag,
          });
          const markedFields = parseMcpMarkedFields(workflow);
          const rawInputs = (inputs ?? payload.prompt_data ?? {}) as Record<string, unknown>;
          const suppliedInputs = normalizeWorkflowNumericPromptValues(
            markedFields,
            rawInputs,
          );
          payload = {
            ...payload,
            prompt_data: externalizeQueueInputDataUrls(
              normalizeMcpWorkflowInputs(markedFields, suppliedInputs),
            ).value,
          };
        } else {
          routing = resolveMcpGenerationRoutingInput({
            serviceType: service_type,
            workflowId: workflow_id,
            serverId: server_id,
            serverTag: normalizedServerTag,
          });
          if (Object.keys(payload).length === 0) {
            throw new Error('request_payload is required for NovelAI and Codex jobs');
          }
        }

        if (service_type === 'codex') {
          payload = parseCodexGenerationRequest(payload);
        }
        if (service_type === 'novelai') {
          assertChatNaiSampleCount(context, (payload as Record<string, unknown>).n_samples);
        }

        // 경로는 없는 그룹을 만들기 때문에 다른 검증을 모두 통과한 뒤에 해석한다.
        const targetGroupId = resolveMcpTargetGroup(group_id, group_path);

        const createData = {
          service_type,
          priority,
          workflow_id: workflow_id ?? null,
          workflow_name: workflowName,
          requested_group_id: targetGroupId ?? null,
          requested_server_id: routing.requestedServerId,
          requested_server_tag: routing.requestedServerTag,
          request_payload: payload,
          request_summary: `MCP ${service_type} generation`,
          requested_by_account_id: context.requester?.accountId ?? null,
          requested_by_account_type: context.requester?.accountType ?? null,
        };
        const creation = idempotency_key && idempotencyScope && requestHash
          ? GenerationQueueModel.createIdempotent(createData, {
              scope: idempotencyScope,
              key: idempotency_key,
              requestHash,
            })
          : { jobId: GenerationQueueModel.create(createData), requestHash: null, reused: false };
        if (requestHash && creation.requestHash !== requestHash) {
          throw new Error(`idempotency_key "${idempotency_key}" was already used with a different request payload`);
        }

        GenerationQueueService.requestDispatch();
        const job = await describeJob(creation.jobId, context);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(idempotency_key
              ? { ...job, idempotency_key, idempotency_reused: creation.reused }
              : job, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Generation job error: ${(error as Error).message}` }] };
      }
    },
  );

  server.tool(
    'get_generation_routing_options',
    'Explain ComfyUI queue routing rules and list the active automatic, fixed-server, and tag targets currently available, optionally scoped to one workflow.',
    {
      workflow_id: z.number().int().positive().optional().describe('Optional workflow ID. When supplied, explicit workflow-server links constrain the returned targets.'),
    },
    async ({ workflow_id }) => {
      try {
        let workflow: { id: number; name: string; is_active: boolean } | null = null;
        if (workflow_id) {
          const record = WorkflowModel.findByIdIncludingDeleted(workflow_id);
          if (!record || record.deleted_at) {
            throw new Error(`Workflow with ID ${workflow_id} not found or deleted`);
          }
          workflow = { id: record.id, name: record.name, is_active: record.is_active };
        }

        const options = getMcpGenerationRoutingOptions(workflow_id);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              workflow,
              routing_rules: getMcpGenerationRoutingRules(),
              ...options,
              examples: {
                automatic: { service_type: 'comfyui', workflow_id: workflow_id ?? '<workflow_id>', inputs: {} },
                fixed_server: { service_type: 'comfyui', workflow_id: workflow_id ?? '<workflow_id>', server_id: '<server_id>', inputs: {} },
                server_tag: { service_type: 'comfyui', workflow_id: workflow_id ?? '<workflow_id>', server_tag: '<routing_tag>', inputs: {} },
              },
            }, null, 2),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Generation routing error: ${(error as Error).message}` }] };
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
    'wait_generation_job',
    'Wait until a generation job finishes (completed, failed or cancelled) or the timeout passes, then return it with its history IDs. Use this after submit_generation_job instead of calling get_generation_job repeatedly; call it again if finished is false.',
    {
      job_id: z.number().int().positive(),
      timeout_seconds: z.number().int().min(5).max(180).default(90).describe('Longest wait before returning an unfinished job'),
    },
    async ({ job_id, timeout_seconds }) => {
      const deadline = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const record = GenerationQueueModel.findListRecordById(job_id);
        if (!record) {
          return { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
        }
        const finished = WAIT_TERMINAL_STATUSES.has(record.status);
        if (finished || Date.now() >= deadline) {
          const job = await describeJob(job_id, context);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ finished, ...job }, null, 2) }] };
        }
        await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      }
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
