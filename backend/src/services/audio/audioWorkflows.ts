import axios from 'axios';
import { getAudioDb } from '../../database/audioDb';
import { ComfyUIServerModel } from '../../models/ComfyUIServer';
import { WorkflowModel } from '../../models/Workflow';
import type { MarkedField, WorkflowRecord } from '../../types/workflow';
import { getMcpGenerationRoutingOptions } from '../../mcp/tools/generationJobRouting';
import { AudioServiceError } from './audioService';

/**
 * Audio workflows are ordinary generation-side workflows (user.db `workflows`, kind = 'audio'). The audio workspace
 * only binds three of their marked fields to roles (prompt, seconds, seed) and remembers whether the ComfyUI servers
 * that may run them have the nodes, models and ranges the graph needs.
 */

export type AudioWorkflowRole = 'prompt' | 'seconds' | 'seed';

export interface AudioWorkflowBinding {
  workflow_id: number;
  prompt_field_id: string;
  seconds_field_id: string;
  seed_field_id: string;
  is_default: boolean;
  compat: AudioWorkflowCompat | null;
  compat_checked_at: string | null;
  updated_at: string;
}

export interface AudioServerCompat {
  server_id: number;
  server_name: string;
  /** ok: every check passed; incompatible: a definite problem; unreachable: object_info could not be read. */
  status: 'ok' | 'incompatible' | 'unreachable';
  issues: string[];
  seconds_max: number | null;
  seed_max: number | null;
}

export interface AudioWorkflowCompat {
  checked_at: string;
  /** True when at least one eligible server is compatible. */
  ok: boolean;
  servers: AudioServerCompat[];
  /** Smallest maximum among compatible servers (null = unknown / no limit reported). */
  seconds_max: number | null;
  seed_max: number | null;
  issues: string[];
}

export interface AudioWorkflowSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  updated_date: string;
  fields: Array<{ id: string; label: string; type: MarkedField['type']; json_path: string; node_class_type: string | null }>;
  binding: AudioWorkflowBinding | null;
  suggested: Partial<Record<AudioWorkflowRole, string>>;
}

const OBJECT_INFO_TTL_MS = 300_000;
const COMPAT_STALE_MS = 10 * 60_000;
const OBJECT_INFO_TIMEOUT_MS = 8_000;
export const AUDIO_SEED_LIMIT = Number.MAX_SAFE_INTEGER;

const db = () => getAudioDb();
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------------------------------- default workflow */

export const DEFAULT_STABLE_AUDIO_WORKFLOW_NAME = 'Stable Audio 3 · Medium Base';

/**
 * The original SFX manager's default graph (API format). batch_size stays 1 in the graph (one job = one candidate),
 * the seed node gets a concrete integer per job, and the save prefix no longer matters (outputs are fetched by /view).
 */
export const DEFAULT_STABLE_AUDIO_GRAPH: Record<string, unknown> = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'stable_audio_3_medium_base.safetensors' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 't5gemma_b_b_ul2.safetensors', type: 'stable_audio', device: 'default' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  '5': { class_type: 'EmptyLatentAudio', inputs: { seconds: 3.0, batch_size: 1 } },
  '6': {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0], seed: ['9', 0], steps: 50, cfg: 7.0, sampler_name: 'lcm', scheduler: 'simple',
      positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], denoise: 1.0,
    },
  },
  '7': { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
  '8': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['7', 0], filename_prefix: 'audio/conai_sfx/sfx', format: 'flac' } },
  '9': { class_type: 'Seed (rgthree)', inputs: { seed: 0 } },
};

export const DEFAULT_STABLE_AUDIO_FIELDS: MarkedField[] = [
  { id: 'prompt', label: '효과음 설명', jsonPath: '3.inputs.text', type: 'textarea', required: true, default_value: '', source_node_id: '3', node_class_type: 'CLIPTextEncode' },
  { id: 'seconds', label: '길이(초)', jsonPath: '5.inputs.seconds', type: 'number', default_value: 3, min: 0.1, max: 47, step: 0.1, source_node_id: '5', node_class_type: 'EmptyLatentAudio' },
  { id: 'seed', label: 'seed', jsonPath: '9.inputs.seed', type: 'number', default_value: 0, min: 0, max: 1125899906842624, step: 1, source_node_id: '9', node_class_type: 'Seed (rgthree)' },
];

/* ---------------------------------------------------------------------------------------------- reading */

function parseFields(workflow: Pick<WorkflowRecord, 'marked_fields'>): MarkedField[] {
  if (!workflow.marked_fields) return [];
  try {
    const parsed = JSON.parse(workflow.marked_fields);
    return Array.isArray(parsed) ? parsed as MarkedField[] : [];
  } catch {
    return [];
  }
}

function parseGraph(workflow: Pick<WorkflowRecord, 'workflow_json'>): Record<string, { class_type?: string; inputs?: Record<string, unknown> }> {
  try {
    const parsed = JSON.parse(workflow.workflow_json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nodeOfPath(jsonPath: string): { nodeId: string; input: string } | null {
  const match = /^([^.]+)\.inputs\.([^.]+)$/.exec(String(jsonPath ?? ''));
  return match ? { nodeId: match[1], input: match[2] } : null;
}

function fieldClassType(field: MarkedField, graph: ReturnType<typeof parseGraph>): string | null {
  const location = nodeOfPath(field.jsonPath);
  return field.node_class_type ?? (location ? graph[location.nodeId]?.class_type ?? null : null);
}

type BindingRow = Omit<AudioWorkflowBinding, 'is_default' | 'compat'> & { is_default: number; compat_json: string | null };

function toBinding(row: BindingRow | undefined): AudioWorkflowBinding | null {
  if (!row) return null;
  let compat: AudioWorkflowCompat | null = null;
  try { compat = row.compat_json ? JSON.parse(row.compat_json) : null; } catch { compat = null; }
  return {
    workflow_id: row.workflow_id,
    prompt_field_id: row.prompt_field_id,
    seconds_field_id: row.seconds_field_id,
    seed_field_id: row.seed_field_id,
    is_default: row.is_default === 1,
    compat,
    compat_checked_at: row.compat_checked_at,
    updated_at: row.updated_at,
  };
}

export function getAudioWorkflowBinding(workflowId: number): AudioWorkflowBinding | null {
  return toBinding(db().prepare('SELECT * FROM audio_workflow_bindings WHERE workflow_id = ?').get(workflowId) as BindingRow | undefined);
}

export function getDefaultAudioWorkflowBinding(): AudioWorkflowBinding | null {
  return toBinding(db().prepare('SELECT * FROM audio_workflow_bindings WHERE is_default = 1').get() as BindingRow | undefined);
}

/** Pick a likely field for each role from the marked fields; the user confirms or changes it. */
export function suggestAudioWorkflowRoles(workflow: Pick<WorkflowRecord, 'marked_fields' | 'workflow_json'>): Partial<Record<AudioWorkflowRole, string>> {
  const fields = parseFields(workflow);
  const graph = parseGraph(workflow);
  const suggested: Partial<Record<AudioWorkflowRole, string>> = {};
  const textFields = fields.filter((field) => field.type === 'text' || field.type === 'textarea');
  const prompt = textFields.find((field) => /cliptextencode|textencode/i.test(fieldClassType(field, graph) ?? '') && /\.inputs\.text$/.test(field.jsonPath))
    ?? textFields.find((field) => /prompt|text/i.test(field.id))
    ?? textFields[0];
  if (prompt) suggested.prompt = prompt.id;
  const numbers = fields.filter((field) => field.type === 'number');
  const seconds = numbers.find((field) => /\.seconds$/.test(field.jsonPath));
  if (seconds) suggested.seconds = seconds.id;
  const seeds = numbers.filter((field) => /\.(noise_)?seed$/.test(field.jsonPath));
  const seed = seeds.find((field) => fieldClassType(field, graph) === 'Seed (rgthree)') ?? seeds[0];
  if (seed) suggested.seed = seed.id;
  return suggested;
}

export function listAudioWorkflows(): AudioWorkflowSummary[] {
  return WorkflowModel.findAll(false, 'audio').map((workflow) => summarize(workflow));
}

function summarize(workflow: WorkflowRecord): AudioWorkflowSummary {
  const graph = parseGraph(workflow);
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? null,
    is_active: workflow.is_active,
    updated_date: workflow.updated_date,
    fields: parseFields(workflow).map((field) => ({
      id: field.id, label: field.label, type: field.type, json_path: field.jsonPath, node_class_type: fieldClassType(field, graph),
    })),
    binding: getAudioWorkflowBinding(workflow.id),
    suggested: suggestAudioWorkflowRoles(workflow),
  };
}

/** The workflow behind an order: active, kind audio, with a binding. */
export function requireBoundAudioWorkflow(workflowId?: number | null): { workflow: WorkflowRecord; binding: AudioWorkflowBinding; fields: MarkedField[] } {
  const binding = workflowId ? getAudioWorkflowBinding(workflowId) : getDefaultAudioWorkflowBinding();
  if (!binding) {
    throw new AudioServiceError(workflowId ? '이 워크플로는 음향 설정에서 연결되지 않았어.' : '기본 음향 워크플로가 없어. 음향 설정에서 워크플로를 연결해줘.', workflowId ? 400 : 409);
  }
  const workflow = WorkflowModel.findById(binding.workflow_id);
  if (!workflow) throw new AudioServiceError('연결된 워크플로가 삭제됐어.', 404);
  if (workflow.kind !== 'audio') throw new AudioServiceError('음향 종류 워크플로가 아니야.');
  if (!workflow.is_active) throw new AudioServiceError('비활성 워크플로야.');
  return { workflow, binding, fields: parseFields(workflow) };
}

/* ---------------------------------------------------------------------------------------------- binding */

export interface AudioWorkflowBindingInput {
  prompt_field_id?: unknown;
  seconds_field_id?: unknown;
  seed_field_id?: unknown;
  is_default?: unknown;
}

function validateRoleField(fields: MarkedField[], value: unknown, role: AudioWorkflowRole): string {
  if (typeof value !== 'string' || !value.trim()) throw new AudioServiceError(`${role} 필드를 골라줘.`);
  const field = fields.find((entry) => entry.id === value.trim());
  if (!field) throw new AudioServiceError(`${role} 필드 ${value}가 워크플로에 없어.`);
  const allowed = role === 'prompt' ? ['text', 'textarea'] : ['number'];
  if (!allowed.includes(field.type)) throw new AudioServiceError(`${role} 필드는 ${allowed.join('/')} 형식이어야 해 (지금: ${field.type}).`);
  return field.id;
}

/** Save (or replace) a workflow's role binding, then check it against the servers that may run it. */
export async function saveAudioWorkflowBinding(workflowId: number, input: AudioWorkflowBindingInput): Promise<AudioWorkflowBinding> {
  const workflow = WorkflowModel.findById(workflowId);
  if (!workflow) throw new AudioServiceError('워크플로를 찾을 수 없어.', 404);
  if (workflow.kind !== 'audio') throw new AudioServiceError('음향 종류 워크플로만 연결할 수 있어. 워크플로 편집에서 종류를 음향으로 바꿔줘.');
  const fields = parseFields(workflow);
  const prompt = validateRoleField(fields, input.prompt_field_id, 'prompt');
  const seconds = validateRoleField(fields, input.seconds_field_id, 'seconds');
  const seed = validateRoleField(fields, input.seed_field_id, 'seed');
  if (new Set([prompt, seconds, seed]).size !== 3) throw new AudioServiceError('세 역할에는 서로 다른 필드를 골라줘.');
  const at = now();
  db().transaction(() => {
    const existing = getAudioWorkflowBinding(workflowId);
    const hasDefault = Boolean(getDefaultAudioWorkflowBinding());
    const makeDefault = input.is_default === true || (!hasDefault && !existing) || (input.is_default === undefined && existing?.is_default === true);
    if (makeDefault) db().prepare('UPDATE audio_workflow_bindings SET is_default = 0 WHERE is_default = 1 AND workflow_id <> ?').run(workflowId);
    db().prepare(`
      INSERT INTO audio_workflow_bindings (workflow_id, prompt_field_id, seconds_field_id, seed_field_id, is_default, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET prompt_field_id = excluded.prompt_field_id, seconds_field_id = excluded.seconds_field_id,
        seed_field_id = excluded.seed_field_id, is_default = excluded.is_default, updated_at = excluded.updated_at,
        compat_json = NULL, compat_checked_at = NULL
    `).run(workflowId, prompt, seconds, seed, makeDefault ? 1 : 0, at);
  }).immediate();
  await checkAudioWorkflowCompatibility(workflowId, { force: true }).catch(() => undefined);
  return getAudioWorkflowBinding(workflowId)!;
}

export function deleteAudioWorkflowBinding(workflowId: number): { deleted: boolean } {
  return { deleted: db().prepare('DELETE FROM audio_workflow_bindings WHERE workflow_id = ?').run(workflowId).changes > 0 };
}

/** Register the original app's Stable Audio 3 graph on the generation side and bind it (default when none is). */
export async function addDefaultStableAudioWorkflow(): Promise<AudioWorkflowSummary> {
  let name = DEFAULT_STABLE_AUDIO_WORKFLOW_NAME;
  for (let suffix = 2; WorkflowModel.existsByName(name); suffix += 1) name = `${DEFAULT_STABLE_AUDIO_WORKFLOW_NAME} (${suffix})`;
  const id = WorkflowModel.create({
    name,
    description: 'Stable Audio 3 효과음 생성 (원래 SFX 매니저 기본 그래프)',
    workflow_json: JSON.stringify(DEFAULT_STABLE_AUDIO_GRAPH, null, 2),
    marked_fields: DEFAULT_STABLE_AUDIO_FIELDS,
    is_active: true,
    kind: 'audio',
    color: '#7c4dff',
  });
  await saveAudioWorkflowBinding(id, { prompt_field_id: 'prompt', seconds_field_id: 'seconds', seed_field_id: 'seed' });
  return summarize(WorkflowModel.findById(id)!);
}

/* ---------------------------------------------------------------------------------------------- compatibility */

type ObjectInfoNode = { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } };
const objectInfoCache = new Map<string, { at: number; value: ObjectInfoNode | null }>();

/** Forget cached /object_info answers (tests, or after a server's models change). */
export function clearAudioObjectInfoCache(): void {
  objectInfoCache.clear();
}

async function fetchObjectInfo(endpoint: string, classType: string, force: boolean): Promise<ObjectInfoNode | null> {
  const key = `${endpoint}|${classType}`;
  const cached = objectInfoCache.get(key);
  if (!force && cached && Date.now() - cached.at < OBJECT_INFO_TTL_MS) return cached.value;
  const response = await axios.get(`${endpoint.replace(/\/+$/, '')}/object_info/${encodeURIComponent(classType)}`, { timeout: OBJECT_INFO_TIMEOUT_MS });
  const value = (response.data && typeof response.data === 'object' ? (response.data as Record<string, ObjectInfoNode>)[classType] : undefined) ?? null;
  objectInfoCache.set(key, { at: Date.now(), value });
  return value;
}

function inputSpec(info: ObjectInfoNode, name: string): unknown[] | null {
  const spec = info.input?.required?.[name] ?? info.input?.optional?.[name];
  return Array.isArray(spec) ? spec : null;
}

/** Enum choices of an input spec, for both the classic `[[...choices]]` and the newer `['COMBO', {options}]` forms. */
function enumChoices(spec: unknown[]): unknown[] | null {
  if (Array.isArray(spec[0])) return spec[0] as unknown[];
  const options = (spec[1] as { options?: unknown } | undefined)?.options;
  return spec[0] === 'COMBO' && Array.isArray(options) ? options : null;
}

function numericBounds(spec: unknown[]): { min: number | null; max: number | null } | null {
  if (spec[0] !== 'INT' && spec[0] !== 'FLOAT') return null;
  const opts = (spec[1] ?? {}) as { min?: unknown; max?: unknown };
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return { min: num(opts.min), max: num(opts.max) };
}

async function checkServer(
  server: { id: number; name: string; endpoint: string },
  graph: ReturnType<typeof parseGraph>,
  binding: Pick<AudioWorkflowBinding, 'seconds_field_id' | 'seed_field_id'> | null,
  fields: MarkedField[],
  force: boolean,
): Promise<AudioServerCompat> {
  const result: AudioServerCompat = { server_id: server.id, server_name: server.name, status: 'ok', issues: [], seconds_max: null, seed_max: null };
  const infos = new Map<string, ObjectInfoNode | null>();
  try {
    for (const classType of new Set(Object.values(graph).map((node) => node?.class_type).filter((value): value is string => typeof value === 'string'))) {
      infos.set(classType, await fetchObjectInfo(server.endpoint, classType, force));
    }
  } catch (error) {
    return { ...result, status: 'unreachable', issues: [`object_info를 읽지 못했어: ${(error as Error).message}`] };
  }

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node?.class_type;
    if (typeof classType !== 'string') continue;
    const info = infos.get(classType);
    if (!info) {
      result.issues.push(`노드 ${nodeId}: ${classType} 노드가 서버에 없어.`);
      continue;
    }
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if (Array.isArray(value)) continue; // a link to another node
      const spec = inputSpec(info, name);
      if (!spec) continue;
      const choices = enumChoices(spec);
      if (choices && typeof value === 'string' && !choices.includes(value)) {
        result.issues.push(`노드 ${nodeId} ${classType}.${name}: "${value}"이(가) 서버 목록에 없어.`);
        continue;
      }
      const bounds = numericBounds(spec);
      if (bounds && typeof value === 'number') {
        if (bounds.min !== null && value < bounds.min) result.issues.push(`노드 ${nodeId} ${classType}.${name}: ${value} < 최소 ${bounds.min}`);
        if (bounds.max !== null && value > bounds.max) result.issues.push(`노드 ${nodeId} ${classType}.${name}: ${value} > 최대 ${bounds.max}`);
      }
    }
  }

  const boundsOfField = (fieldId: string | undefined) => {
    const field = fields.find((entry) => entry.id === fieldId);
    const location = field ? nodeOfPath(field.jsonPath) : null;
    const classType = location ? graph[location.nodeId]?.class_type : undefined;
    const info = classType ? infos.get(classType) : null;
    const spec = info && location ? inputSpec(info, location.input) : null;
    return spec ? numericBounds(spec) : null;
  };
  result.seconds_max = boundsOfField(binding?.seconds_field_id)?.max ?? null;
  result.seed_max = boundsOfField(binding?.seed_field_id)?.max ?? null;
  for (const field of fields) {
    if (field.type !== 'number' || typeof field.default_value !== 'number') continue;
    if (field.id === binding?.seconds_field_id || field.id === binding?.seed_field_id) continue;
    const bounds = boundsOfField(field.id);
    if (bounds?.max !== null && bounds?.max !== undefined && field.default_value > bounds.max) result.issues.push(`필드 ${field.id}: 기본값 ${field.default_value} > 최대 ${bounds.max}`);
    if (bounds?.min !== null && bounds?.min !== undefined && field.default_value < bounds.min) result.issues.push(`필드 ${field.id}: 기본값 ${field.default_value} < 최소 ${bounds.min}`);
  }
  if (result.issues.length > 0) result.status = 'incompatible';
  return result;
}

/** The non-modal servers this workflow may run on (its links, or every active server when it has none). */
export function audioWorkflowServers(workflowId: number): Array<{ id: number; name: string; endpoint: string }> {
  const options = getMcpGenerationRoutingOptions(workflowId);
  return options.eligible_servers
    .filter((server) => server.backend_type !== 'modal')
    .map((server) => ComfyUIServerModel.findById(server.id))
    .filter((server): server is NonNullable<typeof server> => Boolean(server))
    .map((server) => ({ id: server.id, name: server.name, endpoint: server.endpoint }));
}

/** Check a workflow against every server that may run it and store the result on its binding (when bound). */
export async function checkAudioWorkflowCompatibility(workflowId: number, options: { force?: boolean } = {}): Promise<AudioWorkflowCompat> {
  const workflow = WorkflowModel.findById(workflowId);
  if (!workflow) throw new AudioServiceError('워크플로를 찾을 수 없어.', 404);
  const graph = parseGraph(workflow);
  const fields = parseFields(workflow);
  const binding = getAudioWorkflowBinding(workflowId);
  const servers = audioWorkflowServers(workflowId);
  const results: AudioServerCompat[] = [];
  for (const server of servers) results.push(await checkServer(server, graph, binding, fields, options.force === true));
  const compatible = results.filter((entry) => entry.status === 'ok');
  const minOf = (values: Array<number | null>) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? Math.min(...known) : null;
  };
  const compat: AudioWorkflowCompat = {
    checked_at: now(),
    ok: compatible.length > 0,
    servers: results,
    seconds_max: minOf(compatible.map((entry) => entry.seconds_max)),
    seed_max: minOf(compatible.map((entry) => entry.seed_max)),
    issues: servers.length === 0 ? ['이 워크플로를 돌릴 수 있는 ComfyUI 서버가 없어.'] : [],
  };
  if (binding) {
    db().prepare('UPDATE audio_workflow_bindings SET compat_json = ?, compat_checked_at = ? WHERE workflow_id = ?')
      .run(JSON.stringify(compat), compat.checked_at, workflowId);
  }
  return compat;
}

/** The stored check when it is recent enough, otherwise a new one. */
export async function freshAudioWorkflowCompatibility(workflowId: number): Promise<AudioWorkflowCompat> {
  const binding = getAudioWorkflowBinding(workflowId);
  const checkedAt = binding?.compat_checked_at ? Date.parse(binding.compat_checked_at) : NaN;
  if (binding?.compat && Number.isFinite(checkedAt) && Date.now() - checkedAt < COMPAT_STALE_MS) return binding.compat;
  return checkAudioWorkflowCompatibility(workflowId);
}
