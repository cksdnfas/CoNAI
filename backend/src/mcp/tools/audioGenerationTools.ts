import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { isChatMcpSource, type McpRequestContext } from '../context';
import { requireMcpResourceOwner } from '../toolAccess';
import { requireActiveChatReply } from '../../services/codex-chat/chatReplyRegistry';
import {
  audioOrderOwner,
  cancelAudioOrder,
  createAudioOrder,
  getAudioOrder,
  retryAudioOrderJob,
  type AudioOrder,
  type AudioOrderActor,
} from '../../services/audio/audioOrders';
import { listAudioWorkflows } from '../../services/audio/audioWorkflows';

/**
 * Audio generation: an order makes `count` sound candidates in one audio group, one ComfyUI job each (seed base + i).
 * Results land in the audio workspace as candidates (`audio_candidate_ids`); a person reviews them in the web app.
 *
 * The order tool takes `audio_group_id`, not `group_id`: generate-scope tools with a `group_id` are image-library
 * group writes in the shared access check.
 */

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

async function run(action: () => unknown) {
  try { return textResult(await action()); } catch (error) { return errorResult(error); }
}

/** What a bot needs: status per job and the candidate ids, which the chat shows as players. */
function orderSummary(order: AudioOrder) {
  return {
    order_id: order.id,
    audio_group_id: order.group_id,
    workflow_id: order.workflow_id,
    text: order.text,
    seconds: order.seconds,
    count: order.count,
    base_seed: order.base_seed,
    status: order.status,
    counts: order.counts,
    jobs: order.jobs.map((job) => ({ idx: job.idx, seed: job.seed, attempt: job.attempt, job_id: job.job_id, status: job.status, failure_message: job.failure_message, audio_candidate_ids: job.candidate_ids })),
    job_ids: order.job_ids,
    audio_candidate_ids: order.audio_candidate_ids,
    created_at: order.created_at,
  };
}

/** Idempotency keys are per account (chat) or per MCP key, like generation jobs. */
function orderScope(context: McpRequestContext): string {
  if (isChatMcpSource(context.source) && context.requester) return `chat-account:${context.requester.accountId ?? 'bootstrap'}`;
  return context.keyId ? `mcp-key:${context.keyId}` : 'mcp-local';
}

function actorOf(context: McpRequestContext, toolName: string): AudioOrderActor {
  const chat = isChatMcpSource(context.source) && context.chatContext ? { context, toolName } : undefined;
  if (chat) requireActiveChatReply(context.chatContext);
  return {
    accountId: context.requester?.accountId ?? null,
    accountType: context.requester?.accountType ?? null,
    scope: orderScope(context),
    chat,
  };
}

const WAIT_POLL_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerAudioGenerationTools(server: McpServer, context: McpRequestContext): void {
  const chat = isChatMcpSource(context.source);

  server.registerTool('list_audio_workflows', { description: 'List the ComfyUI workflows bound for audio generation, with which marked fields carry the prompt, length and seed, the default one, and the last server compatibility check (including the longest length the servers accept).', inputSchema: z.object({}) },
    () => run(() => listAudioWorkflows().map((workflow) => ({
      workflow_id: workflow.id,
      name: workflow.name,
      is_active: workflow.is_active,
      is_default: workflow.binding?.is_default ?? false,
      bound: workflow.binding !== null,
      compatible: workflow.binding?.compat?.ok ?? null,
      seconds_max: workflow.binding?.compat?.seconds_max ?? null,
      compat_checked_at: workflow.binding?.compat_checked_at ?? null,
    }))));

  server.registerTool('order_audio', { description: `Generate sound-effect candidates into one audio group: count (1-50) separate jobs with seeds seed, seed+1, ... (random base when omitted). Write the prompt in English as a sound description (e.g. "soft footstep on fresh snow, single step, close mic, dry"). ${chat ? 'The app attaches the finished candidates to your reply by itself; do not wait for or poll the order.' : 'Then call wait_audio_order with the returned order_id.'} A person reviews (adopts/rejects) the results in the web app.`, inputSchema: z.object({
    audio_group_id: z.string().trim().min(1).max(64).describe('Target audio group id (list_audio_groups)'),
    text: z.string().trim().min(1).max(8000).describe('Sound description prompt in English; start from the group\'s representative prompt (list_audio_groups `prompt`), not its description'),
    seconds: z.number().min(0.1).max(1200).default(3).describe('Length in seconds'),
    count: z.number().int().min(1).max(50).default(4),
    seed: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional().describe('Base seed; omit or -1 for random'),
    workflow_id: z.number().int().positive().optional().describe('Audio workflow; omit for the default one'),
    server_tag: z.string().trim().min(1).max(64).optional().describe('Route to servers with this exact routing tag'),
    request_key: z.string().trim().min(8).max(128).optional().describe('Retry key: the same key and request return the original order; a different request conflicts'),
  }) }, ({ audio_group_id, text, seconds, count, seed, workflow_id, server_tag, request_key }) => run(async () => orderSummary(await createAudioOrder({
    group_id: audio_group_id, text, seconds, count, seed, workflow_id, server_tag, request_key,
  }, actorOf(context, 'order_audio')))));

  server.registerTool('get_audio_order', { description: 'Read an audio order: per-job status, failure messages and the candidate ids made so far.', inputSchema: z.object({
    order_id: z.string().trim().min(1).max(64),
  }) }, ({ order_id }) => run(() => {
    requireMcpResourceOwner(context, audioOrderOwner(order_id));
    return orderSummary(getAudioOrder(order_id));
  }));

  server.registerTool('wait_audio_order', { description: 'Wait until an audio order has no queued or running jobs (or the timeout passes), then return it. Re-call it to keep waiting.', inputSchema: z.object({
    order_id: z.string().trim().min(1).max(64),
    timeout_seconds: z.number().int().min(5).max(180).default(90),
  }) }, ({ order_id, timeout_seconds }) => run(async () => {
    requireMcpResourceOwner(context, audioOrderOwner(order_id));
    const deadline = Date.now() + timeout_seconds * 1000;
    let order = getAudioOrder(order_id);
    while (order.status === 'active' && Date.now() < deadline) {
      await sleep(WAIT_POLL_MS);
      order = getAudioOrder(order_id);
    }
    return { finished: order.status !== 'active', ...orderSummary(order) };
  }));

  server.registerTool('cancel_audio_order', { description: 'Cancel every job of an audio order that has not finished. Candidates already made stay.', inputSchema: z.object({
    order_id: z.string().trim().min(1).max(64),
  }) }, ({ order_id }) => run(async () => {
    requireMcpResourceOwner(context, audioOrderOwner(order_id));
    return orderSummary(await cancelAudioOrder(order_id));
  }));

  server.registerTool('retry_audio_order_job', { description: 'Run one failed or cancelled job of an audio order again with the same seed.', inputSchema: z.object({
    order_id: z.string().trim().min(1).max(64),
    idx: z.number().int().min(0).max(49).describe('Job index within the order (jobs[].idx)'),
  }) }, ({ order_id, idx }) => run(() => {
    requireMcpResourceOwner(context, audioOrderOwner(order_id));
    return orderSummary(retryAudioOrderJob(order_id, idx, { chat: actorOf(context, 'retry_audio_order_job').chat }));
  }));
}
