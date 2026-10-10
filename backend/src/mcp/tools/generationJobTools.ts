import crypto from 'crypto';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { linkChatGeneration, requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry';
import { audioCandidatesByQueueJob } from '../../services/audio/audioJobCandidates';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GenerationQueueModel } from '../../models/GenerationQueue';
import { WorkflowModel } from '../../models/Workflow';
import { HistoryQueryRepository } from '../../repositories/history/HistoryQueryRepository';
import { externalizeQueueInputDataUrls } from '../../services/generation-queue/queueInputStore';
import { GenerationQueueService } from '../../services/generationQueueService';
import { codexGenerationRequestSchema, getCodexModelSuggestions, parseCodexGenerationRequest } from '../../services/codexGenerationOptions';
import { buildGenerationHistoryRequestSnapshot } from '../../services/generationHistoryRequestSnapshot';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { historyWithinContextRating } from '../../services/codex-chat/chatContentRating';
import { normalizeWorkflowNumericPromptValues } from '../../services/workflowNumericFieldPolicy';
import { parseGenerationQueueRoutingTag } from '../../services/generationQueueRouting';
import { assertChatNaiSampleCount, isChatMcpSource, type McpRequestContext } from '../context';
import { normalizeMcpWorkflowInputs, parseMcpMarkedFields, requireChatWorkflowInputs } from './mcpComfyWorkflowService';
import { mcpGroupPathSchema, resolveMcpTargetGroup } from './mcpTargetGroup';
import { requireMcpResourceOwner, requireMcpToolAccess } from '../toolAccess';
import { requireRequesterPermission } from '../../middleware/featureAccess';
import { validateMcpToolArguments } from '../requestSecurity';
import { canRequesterViewImages } from '../../middleware/imageAccess';
import { requireChatAssetGeneration } from '../../services/codex-chat/chatAssetAccess';
import type { McpRequester } from '../context';
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
  if (isChatMcpSource(context.source) && context.requester) return `chat-account:${context.requester.accountId ?? 'bootstrap'}`;
  return context.keyId ? `mcp-key:${context.keyId}` : 'mcp-local';
}

const WAIT_POLL_MS = 1000;
const WAIT_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

async function describeJob(jobId: number, context: McpRequestContext) {
  const job = GenerationQueueModel.findListRecordById(jobId);
  if (!job) return null;
  requireMcpResourceOwner(context, job);
  const histories = !context.requester || canRequesterViewImages(context.requester)
    ? HistoryQueryRepository.findAllWithMetadata({ queue_job_id: jobId, limit: 100 }) : [];
  const artifacts = context.baseUrl
    ? (await Promise.all(histories.map(async (history) => history.id && await historyWithinContextRating(context, history.id)
        ? McpArtifactService.createHistoryDescriptor(history.id, context.baseUrl as string, context.requester)
        : null))).filter(Boolean)
    : [];
  const audioIds = audioCandidatesByQueueJob([jobId]).get(jobId) ?? [];
  const workflow = job.workflow_id ? WorkflowModel.findByIdIncludingDeleted(job.workflow_id) : null;
  const workflowDeleted = Boolean(job.workflow_id && (!workflow || workflow.deleted_at));
  return {
    ...job,
    routing: describeMcpGenerationJobRouting(job),
    workflow_deleted: workflowDeleted,
    workflow_availability: workflowDeleted ? '삭제된 워크플로우(사용 불가)' : 'available',
    history_ids: histories.map((history) => history.id),
    artifacts,
    // Sounds the run saved (audio workspace, 생성 탭 project): playable in the reply and the generation history.
    ...(audioIds.length ? { audio_candidate_ids: audioIds } : {}),
  };
}

export type McpGenerationJobInput = {
  service_type: 'comfyui' | 'novelai' | 'codex';
  workflow_id?: number;
  server_id?: number;
  server_tag?: string;
  inputs?: Record<string, unknown>;
  request_payload?: Record<string, unknown>;
  group_id?: number;
  group_path?: string;
  priority?: number;
  idempotency_key?: string;
  /** Shown in the queue; the default names the service. */
  request_summary?: string;
};

/**
 * Create one durable generation job for an MCP caller (submit_generation_job and the chat generation presets):
 * routing, ComfyUI input normalization, idempotent retries and ownership. Returns the job as the tools describe it.
 */
/** `afterReply`: a picture an `after` generation preset writes once its reply is finished (chatGenerationPrompting). */
export async function enqueueMcpGenerationJob(context: McpRequestContext, input: McpGenerationJobInput, toolName = 'submit_generation_job', options: { maxPayloadBytes?: number; afterReply?: boolean } = {}) {
  return enqueueGenerationJob(context, input, toolName, options);
}

/** Admin asset jobs use the same normalization/routing without claiming an active chat reply. */
export async function enqueueProfileAssetGenerationJob(requester: McpRequester, profileId: number, input: McpGenerationJobInput, recordJob: (jobId: number) => void, maxPayloadBytes?: number) {
  requireChatAssetGeneration(requester, profileId, input.service_type);
  return enqueueGenerationJob({ scopes: ['generate'], requester }, input, 'profile_assets', { assetProfileId: profileId, recordJob, maxPayloadBytes });
}

async function enqueueGenerationJob(context: McpRequestContext, input: McpGenerationJobInput, toolName: string, options: { maxPayloadBytes?: number; assetProfileId?: number; recordJob?: (jobId: number) => void; afterReply?: boolean }) {
  // An `after` picture is queued once its reply ended; the tool call that asked for it ran while the reply did.
  if (context.chatContext && !options.afterReply) requireActiveChatReply(context.chatContext);
  if (isChatMcpSource(context.source)) requireMcpToolAccess(context, toolName, input, options.afterReply ? 'after-reply' : 'reply');
  const { service_type, workflow_id, server_id, server_tag, inputs, request_payload, group_id, group_path, priority = 100, idempotency_key, request_summary } = input;
  let usesImages = false;
  const requireManagedMedia = () => { usesImages = true; requireRequesterPermission(context.requester, 'images.view'); };
  if (isChatMcpSource(context.source) && service_type === 'codex') throw new Error('Codex generation is unavailable from chat because its host capabilities cannot be isolated. Use the website generation controls.');
  if (context.requester && service_type === 'comfyui') requireRequesterPermission(context.requester, 'workflows.view');
  if (isChatMcpSource(context.source)) validateMcpToolArguments(input, requireManagedMedia);
  const normalizedServerTag = parseGenerationQueueRoutingTag(server_tag, 'server_tag');
  if (server_id != null && normalizedServerTag !== undefined) {
    throw new Error('server_id and server_tag cannot be combined');
  }
  if (service_type !== 'comfyui' && (server_id != null || normalizedServerTag !== undefined)) {
    throw new Error('server_id and server_tag are only valid for comfyui jobs');
  }
  const idempotencyScope = idempotency_key ? options.assetProfileId ? 'chat-assets' : resolveIdempotencyScope(context) : null;
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
      const ownedJob = GenerationQueueModel.findById(existing.job_id);
      if (isChatMcpSource(context.source) && ownedJob?.requested_by_account_id !== context.requester?.accountId) throw new Error('Idempotent generation job ownership mismatch');
      if (existing.request_hash !== requestHash) {
        throw new Error(`idempotency_key "${idempotency_key}" was already used with a different request payload`);
      }
      const job = await describeJob(existing.job_id, context);
      if (!job) throw new Error(`Idempotent queue job ${existing.job_id} no longer exists`);
      return { ...job, idempotency_key, idempotency_reused: true };
    }
  }

  let workflowName: string | null = null;
  // ComfyUI jobs keep `inputs` only as the source of `prompt_data`: spreading the raw inputs into the payload
  // used to copy every node input (with its inline base64 media) next to the externalized prompt_data.
  let payload = request_payload ?? (service_type === 'comfyui' ? {} : inputs ?? {});
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
    if (isChatMcpSource(context.source)) validateMcpToolArguments(markedFields.map((field) => field.default_value), requireManagedMedia);
    const rawInputs = (inputs ?? payload.prompt_data ?? {}) as Record<string, unknown>;
    requireChatWorkflowInputs(context, markedFields, rawInputs);
    const suppliedInputs = normalizeWorkflowNumericPromptValues(
      markedFields,
      rawInputs,
    );
    // Externalized as a whole: a caller's request_payload may carry base64 outside prompt_data too.
    payload = externalizeQueueInputDataUrls({
      ...payload,
      prompt_data: normalizeMcpWorkflowInputs(markedFields, suppliedInputs),
    }).value;
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

  if (isChatMcpSource(context.source)) {
    requireMcpToolAccess(context, toolName, input, options.afterReply ? 'after-reply' : 'reply');
    // Delayed jobs recheck this server-issued grant before dispatch, rather than retaining submission authority.
    payload = { ...payload, __conaiChatGrant: { toolName, context, usesImages } };
  }
  if (options.assetProfileId) {
    requireChatAssetGeneration(context.requester!, options.assetProfileId, service_type);
    if (service_type === 'novelai' && payload.n_samples !== 1) throw new Error('자산 생성은 n_samples: 1이어야 해.');
    payload = { ...payload, __conaiAssetGrant: { profileId: options.assetProfileId } };
  }
  if (options.maxPayloadBytes && Buffer.byteLength(JSON.stringify(payload)) > options.maxPayloadBytes) {
    throw new Error('NAI 기준 이미지가 포함된 작업 입력은 8MB까지 쓸 수 있어.');
  }

  const createData = {
    service_type,
    priority,
    workflow_id: workflow_id ?? null,
    workflow_name: workflowName,
    requested_group_id: targetGroupId ?? null,
    requested_server_id: routing.requestedServerId,
    requested_server_tag: routing.requestedServerTag,
    request_payload: payload,
    request_summary: request_summary ?? `MCP ${service_type} generation`,
    requested_by_account_id: context.requester?.accountId ?? null,
    requested_by_account_type: context.requester?.accountType ?? null,
  };
  const creation = getUserSettingsDb().transaction(() => {
    const created = idempotency_key && idempotencyScope && requestHash
      ? GenerationQueueModel.createIdempotent(createData, {
        scope: idempotencyScope,
        key: idempotency_key,
        requestHash,
      })
      : { jobId: GenerationQueueModel.create(createData), requestHash: null, reused: false };
    if (requestHash && created.requestHash !== requestHash) {
      throw new Error(`idempotency_key "${idempotency_key}" was already used with a different request payload`);
    }
    options.recordJob?.(created.jobId);
    return created;
  }).immediate();
  if (!creation.reused) linkChatGeneration(context.chatContext, creation.jobId);
  GenerationQueueService.requestDispatch();
  const job = await describeJob(creation.jobId, context);
  return idempotency_key ? { ...job, idempotency_key, idempotency_reused: creation.reused } : job;
}

export function registerGenerationJobTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'get_codex_generation_options',
    { description: 'Get the Codex image-generation request schema and the agent models the server\'s Codex CLI offers. Use the same parameters as the Codex UI with submit_generation_job(service_type="codex"). The list may be incomplete; custom model IDs are accepted. Prompts are saved with results; use get_generation_history_request to retrieve them and create_prompt_preset to save reusable text.', inputSchema: z.object({}) },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({
      ...await getCodexModelSuggestions(),
      request_schema: z.toJSONSchema(codexGenerationRequestSchema),
      default_model: 'Server Codex CLI default when model is omitted or empty',
      example: { service_type: 'codex', request_payload: { prompt: 'Create a blue ceramic teapot', model: '', operation: 'generate', size: '1024x1024', count: 1 } },
    }) }] }),
  );

  server.registerTool(
    'get_generation_history_request',
    { description: 'Read the full saved prompt, negative prompt, selected model and request settings behind a generation result, as used by the UI reuse action. Image bytes are omitted; pruned requests may only retain result prompts.', inputSchema: z.object({ history_id: z.number().int().positive() }) },
    async ({ history_id }) => {
      const record = HistoryQueryRepository.findAllWithMetadata({ ids: [history_id], limit: 1 })[0];
      if (!record) return { isError: true, content: [{ type: 'text' as const, text: 'Generation history not found' }] };
      requireMcpResourceOwner(context, record, true);
      return { content: [{ type: 'text' as const, text: JSON.stringify(buildGenerationHistoryRequestSnapshot(record)) }] };
    },
  );

  server.registerTool(
    'submit_generation_job',
    { description: `Submit a durable asynchronous generation job and return immediately with a job ID. For NovelAI (service_type="novelai") pass request_payload directly, no lookups needed: { prompt (required; comma-separated Danbooru-style tags), negative_prompt, model (default "nai-diffusion-4-5-curated"; also nai-diffusion-4-5-full, nai-diffusion-5-curated, nai-diffusion-5-full), width/height (multiples of 64: 832x1216 portrait, 1216x832 landscape, 1024x1024 square), steps (default 28), scale (default 5), sampler (default k_euler_ancestral), seed, n_samples (keep 1), characters: [{ prompt, uc, center_x, center_y }] for per-character prompts }. ${isChatMcpSource(context.source) ? 'The app attaches the result to your reply by itself; do not wait for or poll the job. ' : 'After submitting, call wait_generation_job with the returned job id instead of polling get_generation_job. '}For Codex, get_codex_generation_options documents all UI-equivalent parameters including model, reference generation, editing, masks and save options. For ComfyUI: omit server_id and server_tag for automatic queue distribution, provide server_id for one fixed server, or provide server_tag for exact-tag routing.`, inputSchema: z.object({
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
    }) },
    async (args) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await enqueueMcpGenerationJob(context, args)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Generation job error: ${(error as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    'get_generation_routing_options',
    { description: 'Explain ComfyUI queue routing rules and list the active automatic, fixed-server, and tag targets currently available, optionally scoped to one workflow.', inputSchema: z.object({
      workflow_id: z.number().int().positive().optional().describe('Optional workflow ID. When supplied, explicit workflow-server links constrain the returned targets.'),
    }) },
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
            }),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Generation routing error: ${(error as Error).message}` }] };
      }
    },
  );

  server.registerTool(
    'get_generation_job',
    { description: 'Get one durable generation job, its workflow availability, history IDs, and completed artifacts.', inputSchema: z.object({ job_id: z.number().int().positive() }) },
    async ({ job_id }) => {
      const job = await describeJob(job_id, context);
      return job
        ? { content: [{ type: 'text' as const, text: JSON.stringify(job) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
    },
  );

  server.registerTool(
    'wait_generation_job',
    { description: 'Wait until a generation job finishes (completed, failed or cancelled) or the timeout passes, then return it with its history IDs. Use this after submit_generation_job instead of calling get_generation_job repeatedly; call it again if finished is false.', inputSchema: z.object({
      job_id: z.number().int().positive(),
      timeout_seconds: z.number().int().min(5).max(180).default(90).describe('Longest wait before returning an unfinished job'),
    }) },
    async ({ job_id, timeout_seconds }) => {
      const deadline = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const record = GenerationQueueModel.findListRecordById(job_id);
        if (!record) {
          return { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
        }
        requireMcpResourceOwner(context, record);
        const finished = WAIT_TERMINAL_STATUSES.has(record.status);
        if (finished || Date.now() >= deadline) {
          const job = await describeJob(job_id, context);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ finished, ...job }) }] };
        }
        await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
      }
    },
  );

  server.registerTool(
    'get_generation_artifacts',
    { description: 'Get downloadable artifacts for one generation job. Calling it again issues fresh signed download URLs.', inputSchema: z.object({ job_id: z.number().int().positive() }) },
    async ({ job_id }) => {
      const job = await describeJob(job_id, context);
      return job
        ? { content: [{ type: 'text' as const, text: JSON.stringify({ job_id, status: job.status, artifacts: job.artifacts }) }] }
        : { isError: true, content: [{ type: 'text' as const, text: `Queue job ${job_id} not found` }] };
    },
  );

  server.registerTool(
    'refresh_artifact_download',
    { description: 'Issue a fresh signed download URL from a stable MCP artifact ID.', inputSchema: z.object({ artifact_id: z.string().min(1) }) },
    async ({ artifact_id }) => {
      if (!context.baseUrl) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Artifact downloads require the Streamable HTTP transport' }] };
      }
      if (context.requester) {
        const identity = McpArtifactService.identity(artifact_id);
        // Sprite frame ZIPs and audio exports check their owner (audio files: audio.view) inside refreshDescriptor.
        if (!identity || !['history', 'sprite-frames', 'audio', 'audio-export'].includes(identity.kind)) return { isError: true, content: [{ type: 'text' as const, text: 'Artifact not accessible to this account' }] };
        if (identity.kind === 'history') requireMcpResourceOwner(context, HistoryQueryRepository.findAllWithMetadata({ ids: [identity.id], limit: 1 })[0], true);
      }
      const artifact = await McpArtifactService.refreshDescriptor(artifact_id, context.baseUrl, context.requester).catch((error: Error) => {
        if (error.message === 'Resource is not accessible to this account.') return null;
        throw error;
      });
      return artifact
        ? { content: [{ type: 'text' as const, text: JSON.stringify(artifact) }] }
        : { isError: true, content: [{ type: 'text' as const, text: 'Artifact not found or artifact ID is invalid' }] };
    },
  );

  server.registerTool(
    'cancel_generation_job',
    { description: 'Request cancellation for one generation job.', inputSchema: z.object({ job_id: z.number().int().positive() }) },
    async ({ job_id }) => {
      try {
        requireMcpResourceOwner(context, GenerationQueueModel.findListRecordById(job_id));
        await GenerationQueueService.requestCancellation(job_id, { origin: 'user' });
        return { content: [{ type: 'text' as const, text: JSON.stringify(await describeJob(job_id, context)) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Cancellation error: ${(error as Error).message}` }] };
      }
    },
  );
}
