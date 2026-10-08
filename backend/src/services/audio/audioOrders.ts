import crypto from 'crypto';
import path from 'path';
import { getAudioDb, hasAudioDb } from '../../database/audioDb';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { GenerationQueueModel } from '../../models/GenerationQueue';
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue';
import type { McpRequestContext } from '../../mcp/context';
import { resolveMcpGenerationRoutingInput } from '../../mcp/tools/generationJobRouting';
import { normalizeMcpWorkflowInputs } from '../../mcp/tools/mcpComfyWorkflowService';
import { normalizeWorkflowNumericPromptValues } from '../workflowNumericFieldPolicy';
import { GenerationQueueService } from '../generationQueueService';
import { publishQueueJobEvent } from '../runtime-events/runtimeEventPublishers';
import { linkChatGeneration } from '../codex-chat/chatReplyRegistry';
import { ingestAudioFile } from './audioStore';
import { AudioServiceError, getAudioGroup, registerGeneratedAudioCandidate, type AudioCandidate } from './audioService';
import { AUDIO_SEED_LIMIT, freshAudioWorkflowCompatibility, requireBoundAudioWorkflow } from './audioWorkflows';
import type { ComfyCollectedOutputFile } from '../comfyGenerationExecutor';

/**
 * Audio orders: "make `count` sounds for this group". Each sound is one ComfyUI queue job with its own seed
 * (base_seed + idx), so a failure or a retry concerns one candidate only, and every job's result lands in the audio
 * store through the queue executor's output sink (never the image library).
 *
 * Durability: the order and all its rows are written to audio.db before anything is queued; each row then gets its
 * queue job through an idempotency key `audio:<order>:<idx>:<attempt>`. A crash in between leaves rows without a
 * job id that `reconcileAudioOrder` (startup, every order read) queues again — the key makes that safe to repeat.
 */

export const AUDIO_ORDER_QUEUE_SCOPE = 'audio-orders';
export const AUDIO_ORDER_MAX_COUNT = 50;
export const AUDIO_ORDER_MAX_TEXT = 8000;
/** Upper bound when no server reports one (the original app's limit). */
export const AUDIO_ORDER_DEFAULT_MAX_SECONDS = 1200;
const RANDOM_SEED_SPAN = 2 ** 31;

export type AudioOrderJobStatus = 'pending' | GenerationQueueJobStatus;

export interface AudioOrderJob {
  idx: number;
  seed: number;
  attempt: number;
  job_id: number | null;
  status: AudioOrderJobStatus;
  failure_message: string | null;
  candidate_ids: string[];
}

export interface AudioOrder {
  id: string;
  request_key: string;
  group_id: string;
  workflow_id: number;
  text: string;
  seconds: number;
  count: number;
  base_seed: number;
  server_id: number | null;
  server_tag: string | null;
  created_by_account_id: number | null;
  created_at: string;
  status: 'active' | 'completed' | 'partial' | 'failed' | 'cancelled';
  counts: Record<AudioOrderJobStatus, number>;
  jobs: AudioOrderJob[];
  /** Every queue job id of the order (handy for waiting and chat references). */
  job_ids: number[];
  audio_candidate_ids: string[];
}

export interface AudioOrderInput {
  group_id?: unknown;
  text?: unknown;
  seconds?: unknown;
  count?: unknown;
  seed?: unknown;
  workflow_id?: unknown;
  request_key?: unknown;
  server_id?: unknown;
  server_tag?: unknown;
}

/** Who places the order. `scope` separates idempotency keys (one account / MCP key cannot reuse another's key). */
export interface AudioOrderActor {
  accountId: number | null;
  accountType: string | null;
  scope: string;
  /** Set for orders placed by a chat bot: links the jobs to the reply and records the dispatch-time grant. */
  chat?: { context: McpRequestContext; toolName: string };
}

const db = () => getAudioDb();
const now = () => new Date().toISOString();
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/* ------------------------------------------------------------------------------------------------ helpers */

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new AudioServiceError(`${field}은(는) ${min}~${max} 사이의 정수여야 해.`);
  return parsed;
}

type OrderRow = Omit<AudioOrder, 'status' | 'counts' | 'jobs' | 'job_ids' | 'audio_candidate_ids'> & { request_scope: string; request_hash: string; created_by_account_type: string | null };
type OrderJobRow = { order_id: string; idx: number; seed: number; attempt: number; job_id: number | null; status_cache: string; candidate_id: string | null; error: string | null; updated_at: string };

function findOrderRow(id: string): OrderRow {
  const row = db().prepare('SELECT * FROM audio_orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!row) throw new AudioServiceError('주문을 찾을 수 없어.', 404);
  return row;
}

function orderJobRows(orderId: string): OrderJobRow[] {
  return db().prepare('SELECT * FROM audio_order_jobs WHERE order_id = ? ORDER BY idx').all(orderId) as OrderJobRow[];
}

/* ------------------------------------------------------------------------------------------------ create */

/** Validate, store the order + rows, then queue one job per row. Same request_key + same body returns the order. */
export async function createAudioOrder(input: AudioOrderInput, actor: AudioOrderActor): Promise<AudioOrder> {
  if (typeof input.group_id !== 'string' || !input.group_id) throw new AudioServiceError('group_id가 필요해.');
  const group = getAudioGroup(input.group_id);
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || [...text].length > AUDIO_ORDER_MAX_TEXT) throw new AudioServiceError(`text는 1~${AUDIO_ORDER_MAX_TEXT}자여야 해.`);
  const seconds = Number(input.seconds ?? 3);
  if (!Number.isFinite(seconds) || seconds < 0.1) throw new AudioServiceError('seconds는 0.1 이상이어야 해.');
  const count = optionalInt(input.count ?? 1, 'count', 1, AUDIO_ORDER_MAX_COUNT) ?? 1;
  const requestedSeed = input.seed === -1 || input.seed === '-1' ? null : optionalInt(input.seed, 'seed', 0, AUDIO_SEED_LIMIT);
  const workflowId = optionalInt(input.workflow_id, 'workflow_id', 1, Number.MAX_SAFE_INTEGER);
  const serverId = optionalInt(input.server_id, 'server_id', 1, Number.MAX_SAFE_INTEGER);
  const serverTag = typeof input.server_tag === 'string' && input.server_tag.trim() ? input.server_tag.trim() : null;
  if (serverId !== null && serverTag !== null) throw new AudioServiceError('server_id와 server_tag는 같이 쓸 수 없어.');
  const requestKey = typeof input.request_key === 'string' && input.request_key.trim()
    ? input.request_key.trim()
    : crypto.randomUUID();
  if (requestKey.length < 8 || requestKey.length > 128) throw new AudioServiceError('request_key는 8~128자여야 해.');

  const { workflow, binding, fields } = requireBoundAudioWorkflow(workflowId);
  const requestHash = sha256(stableJson({
    group_id: group.id, workflow_id: workflow.id, text, seconds, count, seed: requestedSeed, server_id: serverId, server_tag: serverTag,
  }));
  const existing = db().prepare('SELECT id, request_hash FROM audio_orders WHERE request_scope = ? AND request_key = ?')
    .get(actor.scope, requestKey) as { id: string; request_hash: string } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new AudioServiceError(`request_key "${requestKey}"는 다른 주문에 이미 쓰였어.`, 409);
    return getAudioOrder(existing.id);
  }

  // Routing first (a bad server_id/tag must fail before anything is stored); modal servers cannot return audio.
  const routing = resolveMcpGenerationRoutingInput({ serviceType: 'comfyui', workflowId: workflow.id, serverId, serverTag });
  if (routing.eligibleServers.length > 0 && routing.eligibleServers.every((server) => server.backend_type === 'modal')) {
    throw new AudioServiceError('오디오 생성은 Modal 서버에서 돌릴 수 없어. 일반 ComfyUI 서버를 골라줘.');
  }

  const compat = await freshAudioWorkflowCompatibility(workflow.id);
  const scopedServers = serverId !== null ? compat.servers.filter((entry) => entry.server_id === serverId) : compat.servers;
  if (scopedServers.length > 0 && scopedServers.every((entry) => entry.status === 'incompatible')) {
    throw new AudioServiceError(`이 워크플로를 돌릴 수 있는 서버가 없어: ${scopedServers.flatMap((entry) => entry.issues).slice(0, 3).join(' / ')}`, 409);
  }
  const secondsMax = compat.seconds_max ?? AUDIO_ORDER_DEFAULT_MAX_SECONDS;
  if (seconds > secondsMax) throw new AudioServiceError(`seconds는 ${secondsMax} 이하여야 해 (서버 한도).`);
  // The queue clamps numeric fields to their marked min/max at run time, so the marked max bounds the seed too.
  const seedFieldMax = fields.find((field) => field.id === binding.seed_field_id)?.max;
  const fieldMax = typeof seedFieldMax === 'number' && Number.isFinite(seedFieldMax) ? seedFieldMax : AUDIO_SEED_LIMIT;
  const secondsField = fields.find((field) => field.id === binding.seconds_field_id);
  if (typeof secondsField?.max === 'number' && seconds > secondsField.max) throw new AudioServiceError(`seconds는 ${secondsField.max} 이하여야 해 (워크플로 필드 한도).`);
  if (typeof secondsField?.min === 'number' && seconds < secondsField.min) throw new AudioServiceError(`seconds는 ${secondsField.min} 이상이어야 해 (워크플로 필드 한도).`);
  const seedMax = Math.min(compat.seed_max ?? AUDIO_SEED_LIMIT, fieldMax, AUDIO_SEED_LIMIT);
  let baseSeed: number;
  if (requestedSeed === null) {
    baseSeed = crypto.randomInt(0, Math.max(1, Math.min(RANDOM_SEED_SPAN, seedMax + 1) - count + 1));
  } else {
    if (requestedSeed + count - 1 > seedMax) throw new AudioServiceError(`seed + count - 1이 seed 최대값 ${seedMax}을 넘어.`);
    baseSeed = requestedSeed;
  }

  const id = crypto.randomUUID();
  const at = now();
  try {
    db().transaction(() => {
      db().prepare(`
        INSERT INTO audio_orders (id, request_scope, request_key, request_hash, group_id, workflow_id, text, seconds, count, base_seed,
          server_id, server_tag, created_by_account_id, created_by_account_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, actor.scope, requestKey, requestHash, group.id, workflow.id, text, seconds, count, baseSeed,
        serverId, serverTag, actor.accountId, actor.accountType, at);
      const insertRow = db().prepare(`INSERT INTO audio_order_jobs (order_id, idx, seed, attempt, status_cache, updated_at) VALUES (?, ?, ?, 1, 'pending', ?)`);
      for (let idx = 0; idx < count; idx += 1) insertRow.run(id, idx, baseSeed + idx, at);
    }).immediate();
  } catch (error) {
    // A concurrent request with the same key won the insert: answer like a repeat.
    const winner = db().prepare('SELECT id, request_hash FROM audio_orders WHERE request_scope = ? AND request_key = ?')
      .get(actor.scope, requestKey) as { id: string; request_hash: string } | undefined;
    if (winner?.request_hash === requestHash) return getAudioOrder(winner.id);
    throw error;
  }

  queuePendingRows(id, { binding, chat: actor.chat });
  return getAudioOrder(id);
}

/* ------------------------------------------------------------------------------------------------ queueing */

/** Queue every row of an order that has no job yet. Safe to repeat: the idempotency key returns the same job. */
function queuePendingRows(orderId: string, options: { binding?: ReturnType<typeof requireBoundAudioWorkflow>['binding']; chat?: AudioOrderActor['chat'] } = {}): number {
  const order = findOrderRow(orderId);
  const rows = orderJobRows(orderId).filter((row) => row.job_id === null && row.status_cache === 'pending');
  if (rows.length === 0) return 0;
  let bound: ReturnType<typeof requireBoundAudioWorkflow>;
  try {
    bound = requireBoundAudioWorkflow(order.workflow_id);
  } catch (error) {
    const message = (error as Error).message;
    const mark = db().prepare("UPDATE audio_order_jobs SET status_cache = 'failed', error = ?, updated_at = ? WHERE order_id = ? AND idx = ?");
    for (const row of rows) mark.run(message, now(), orderId, row.idx);
    return 0;
  }
  const binding = options.binding ?? bound.binding;
  const group = getAudioGroup(order.group_id);
  let queued = 0;
  for (const row of rows) {
    const inputs: Record<string, unknown> = {
      [binding.prompt_field_id]: order.text,
      [binding.seconds_field_id]: order.seconds,
      [binding.seed_field_id]: row.seed,
    };
    const promptData = normalizeMcpWorkflowInputs(bound.fields, normalizeWorkflowNumericPromptValues(bound.fields, inputs));
    // The numeric policy clamps to the field's min/max: the seed must reach ComfyUI exactly as recorded.
    promptData[binding.seed_field_id] = row.seed;
    const payload: Record<string, unknown> = {
      prompt_data: promptData,
      __conaiAudioOrder: { order_id: orderId, idx: row.idx, attempt: row.attempt },
    };
    if (options.chat) payload.__conaiChatGrant = { toolName: options.chat.toolName, context: options.chat.context, usesImages: false };
    const routing = resolveMcpGenerationRoutingInput({ serviceType: 'comfyui', workflowId: order.workflow_id, serverId: order.server_id, serverTag: order.server_tag });
    const key = `audio:${orderId}:${row.idx}:${row.attempt}`;
    const created = getUserSettingsDb().transaction(() => GenerationQueueModel.createIdempotent({
      service_type: 'comfyui',
      priority: 100,
      workflow_id: order.workflow_id,
      workflow_name: bound.workflow.name,
      requested_group_id: null,
      requested_server_id: routing.requestedServerId,
      requested_server_tag: routing.requestedServerTag,
      request_payload: payload,
      request_summary: `오디오 · ${group.name} · seed ${row.seed}`,
      requested_by_account_id: order.created_by_account_id,
      requested_by_account_type: (order.created_by_account_type ?? null) as GenerationQueueJobRecord['requested_by_account_type'],
    }, { scope: AUDIO_ORDER_QUEUE_SCOPE, key, requestHash: sha256(stableJson({ order: orderId, idx: row.idx, attempt: row.attempt, seed: row.seed })) })).immediate();
    db().prepare("UPDATE audio_order_jobs SET job_id = ?, status_cache = 'queued', error = NULL, updated_at = ? WHERE order_id = ? AND idx = ?")
      .run(created.jobId, now(), orderId, row.idx);
    if (!created.reused) {
      if (options.chat) linkChatGeneration(options.chat.context.chatContext, created.jobId);
      publishQueueJobEvent('queue.job.created', GenerationQueueModel.findListRecordById(created.jobId));
      queued += 1;
    }
  }
  GenerationQueueService.requestDispatch();
  return queued;
}

/** Re-queue rows a crash left without a job. Called on order reads and at startup. */
export function reconcileAudioOrder(orderId: string): number {
  return queuePendingRows(orderId);
}

/** Startup pass over every order that still has unqueued rows. */
export function reconcileAllAudioOrders(): number {
  if (!hasAudioDb()) return 0;
  const ids = (db().prepare("SELECT DISTINCT order_id FROM audio_order_jobs WHERE job_id IS NULL AND status_cache = 'pending'").all() as Array<{ order_id: string }>)
    .map((row) => row.order_id);
  let queued = 0;
  for (const id of ids) {
    try { queued += reconcileAudioOrder(id); } catch (error) { console.warn(`⚠️ Audio order ${id} could not be re-queued:`, (error as Error).message); }
  }
  return queued;
}

/* ------------------------------------------------------------------------------------------------ reading */

function readQueueJobs(jobIds: number[]): Map<number, { status: GenerationQueueJobStatus; failure_message: string | null }> {
  const result = new Map<number, { status: GenerationQueueJobStatus; failure_message: string | null }>();
  if (jobIds.length === 0) return result;
  const rows = getUserSettingsDb().prepare(`SELECT id, status, failure_message FROM generation_queue_jobs WHERE id IN (${jobIds.map(() => '?').join(',')})`)
    .all(...jobIds) as Array<{ id: number; status: GenerationQueueJobStatus; failure_message: string | null }>;
  rows.forEach((row) => result.set(row.id, { status: row.status, failure_message: row.failure_message }));
  return result;
}

function candidatesOfOrder(orderId: string): Map<string, string[]> {
  const byJob = new Map<string, string[]>();
  const rows = db().prepare('SELECT id, job_id FROM audio_candidates WHERE order_id = ? AND deleted_at IS NULL ORDER BY created_at, id').all(orderId) as Array<{ id: string; job_id: string | null }>;
  for (const row of rows) if (row.job_id) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row.id]);
  return byJob;
}

function buildOrder(row: OrderRow): AudioOrder {
  const rows = orderJobRows(row.id);
  const queue = readQueueJobs(rows.map((entry) => entry.job_id).filter((value): value is number => value !== null));
  const candidates = candidatesOfOrder(row.id);
  const jobs: AudioOrderJob[] = rows.map((entry) => {
    const queued = entry.job_id !== null ? queue.get(entry.job_id) : undefined;
    const status: AudioOrderJobStatus = entry.job_id === null
      ? (entry.status_cache === 'failed' || entry.status_cache === 'cancelled' ? entry.status_cache : 'pending')
      : queued?.status ?? (entry.status_cache as AudioOrderJobStatus);
    return {
      idx: entry.idx, seed: entry.seed, attempt: entry.attempt, job_id: entry.job_id, status,
      failure_message: queued?.failure_message ?? entry.error ?? null,
      candidate_ids: entry.job_id !== null ? candidates.get(String(entry.job_id)) ?? [] : [],
    };
  });
  const updateCache = db().prepare('UPDATE audio_order_jobs SET status_cache = ?, updated_at = ? WHERE order_id = ? AND idx = ? AND status_cache <> ?');
  for (const job of jobs) if (job.job_id !== null) updateCache.run(job.status, now(), row.id, job.idx, job.status);
  const counts = { pending: 0, queued: 0, dispatching: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } as Record<AudioOrderJobStatus, number>;
  jobs.forEach((job) => { counts[job.status] = (counts[job.status] ?? 0) + 1; });
  const active = counts.pending + counts.queued + counts.dispatching + counts.running;
  const status: AudioOrder['status'] = active > 0 ? 'active'
    : counts.completed === jobs.length ? 'completed'
      : counts.completed > 0 ? 'partial'
        : counts.failed > 0 ? 'failed' : 'cancelled';
  const { request_scope: _scope, request_hash: _hash, created_by_account_type: _type, ...order } = row;
  return {
    ...order,
    status,
    counts,
    jobs,
    job_ids: jobs.map((job) => job.job_id).filter((value): value is number => value !== null),
    audio_candidate_ids: jobs.flatMap((job) => job.candidate_ids),
  };
}

export function getAudioOrder(id: string): AudioOrder {
  findOrderRow(id);
  try { reconcileAudioOrder(id); } catch (error) { console.warn(`⚠️ Audio order ${id} reconcile failed:`, (error as Error).message); }
  return buildOrder(findOrderRow(id));
}

export function listAudioOrders(options: { groupId?: unknown; limit?: unknown; offset?: unknown } = {}): { items: AudioOrder[]; total: number } {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(options.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const groupId = typeof options.groupId === 'string' && options.groupId ? options.groupId : null;
  if (groupId) getAudioGroup(groupId);
  const where = groupId ? 'WHERE group_id = ?' : '';
  const params = groupId ? [groupId] : [];
  const rows = db().prepare(`SELECT * FROM audio_orders ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).all(...params, limit, offset) as OrderRow[];
  const total = (db().prepare(`SELECT count(*) AS n FROM audio_orders ${where}`).get(...params) as { n: number }).n;
  return { items: rows.map(buildOrder), total };
}

/** Owner of an order, for MCP ownership checks (shaped like a queue job). */
export function audioOrderOwner(id: string): { requested_by_account_id: number | null } {
  return { requested_by_account_id: findOrderRow(id).created_by_account_id };
}

/* ------------------------------------------------------------------------------------------------ control */

/** Cancel every row that has not finished: unqueued rows are marked, queued/running jobs get a cancellation request. */
export async function cancelAudioOrder(id: string): Promise<AudioOrder> {
  findOrderRow(id);
  db().prepare("UPDATE audio_order_jobs SET status_cache = 'cancelled', updated_at = ? WHERE order_id = ? AND job_id IS NULL AND status_cache = 'pending'").run(now(), id);
  for (const row of orderJobRows(id)) {
    if (row.job_id === null) continue;
    const job = GenerationQueueModel.findListRecordById(row.job_id);
    if (job && !TERMINAL.has(job.status)) await GenerationQueueService.requestCancellation(row.job_id, { origin: 'user' });
  }
  return buildOrder(findOrderRow(id));
}

/** Run one failed or cancelled row again with the same seed, as a new queue job (attempt + 1). */
export function retryAudioOrderJob(id: string, idx: number, actor?: Pick<AudioOrderActor, 'chat'>): AudioOrder {
  findOrderRow(id);
  const row = orderJobRows(id).find((entry) => entry.idx === idx);
  if (!row) throw new AudioServiceError('그 순번의 작업이 없어.', 404);
  const status = row.job_id !== null ? GenerationQueueModel.findListRecordById(row.job_id)?.status ?? row.status_cache : row.status_cache;
  if (status !== 'failed' && status !== 'cancelled') throw new AudioServiceError('실패했거나 취소된 작업만 다시 돌릴 수 있어.', 409);
  db().prepare("UPDATE audio_order_jobs SET job_id = NULL, attempt = attempt + 1, status_cache = 'pending', error = NULL, updated_at = ? WHERE order_id = ? AND idx = ?")
    .run(now(), id, idx);
  queuePendingRows(id, { chat: actor?.chat });
  return buildOrder(findOrderRow(id));
}

/** Before a group (or its project) is deleted: stop whatever its orders still have in the queue. */
export async function cancelAudioOrdersInGroups(groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  const orders = db().prepare(`SELECT id FROM audio_orders WHERE group_id IN (${groupIds.map(() => '?').join(',')})`).all(...groupIds) as Array<{ id: string }>;
  for (const order of orders) {
    try { await cancelAudioOrder(order.id); } catch (error) { console.warn(`⚠️ Audio order ${order.id} could not be cancelled:`, (error as Error).message); }
  }
}

/* ------------------------------------------------------------------------------------------------ results */

export interface AudioOrderJobBinding {
  order: OrderRow;
  row: OrderJobRow;
}

/** The order row a queue job belongs to, or null (the audio.db row is authoritative, not the payload marker). */
export function findAudioOrderJobByQueueJob(jobId: number): AudioOrderJobBinding | null {
  if (!hasAudioDb()) return null;
  const row = db().prepare('SELECT * FROM audio_order_jobs WHERE job_id = ?').get(jobId) as OrderJobRow | undefined;
  if (!row) return null;
  return { order: findOrderRow(row.order_id), row };
}

export interface AudioOrderSinkContext {
  queueJobId: number;
  promptId: string;
  serverId: number | null;
  serverName: string | null;
  workflow: { id: number; name: string; updated_date: string };
}

/**
 * Output sink for one audio-order job: every audio output becomes a candidate in the order's group. The temp files
 * are consumed (moved into the audio store). Throws when nothing usable came back, so the job fails.
 */
export async function storeAudioOrderOutputs(binding: AudioOrderJobBinding, outputs: ComfyCollectedOutputFile[], context: AudioOrderSinkContext): Promise<{ order_id: string; candidate_ids: string[] }> {
  const { order, row } = binding;
  const group = getAudioGroup(order.group_id);
  const candidates: AudioCandidate[] = [];
  const failures: string[] = [];
  for (const [index, output] of outputs.entries()) {
    try {
      const originalName = path.basename(output.filename || output.tempPath);
      const { file } = await ingestAudioFile(output.tempPath, originalName);
      candidates.push(registerGeneratedAudioCandidate({
        groupId: group.id,
        file,
        name: outputs.length > 1 ? `${group.name} · ${row.seed} · ${index + 1}` : `${group.name} · ${row.seed}`,
        accountId: order.created_by_account_id,
        sourceKey: `gen:${context.queueJobId}:${output.nodeId}:${index}`,
        orderId: order.id,
        jobId: context.queueJobId,
        provenance: {
          source: 'generation',
          prompt: order.text,
          seconds: order.seconds,
          seed: row.seed,
          order_id: order.id,
          order_idx: row.idx,
          attempt: row.attempt,
          queue_job_id: context.queueJobId,
          prompt_id: context.promptId,
          workflow_id: context.workflow.id,
          workflow_name: context.workflow.name,
          workflow_updated_date: context.workflow.updated_date,
          server_id: context.serverId,
          server_name: context.serverName,
          output_node_id: output.nodeId,
          output_filename: originalName,
        },
      }));
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`Audio order job produced no usable audio${failures.length ? `: ${failures.join('; ')}` : ''}`);
  }
  db().prepare("UPDATE audio_order_jobs SET candidate_id = COALESCE(candidate_id, ?), status_cache = 'running', updated_at = ? WHERE order_id = ? AND idx = ?")
    .run(candidates[0].id, now(), order.id, row.idx);
  return { order_id: order.id, candidate_ids: candidates.map((candidate) => candidate.id) };
}

export { audioCandidatesByQueueJob } from './audioJobCandidates';

