import { ComfyUIServerModel } from '../../models/ComfyUIServer';
import { WorkflowModel } from '../../models/Workflow';
import { getMcpGenerationRoutingOptions } from '../generation-queue/generationJobRouting';
import type { ComfyUIServerRecord } from '../../types/comfyuiServer';
import { comboChoices, fetchComfyNodeInfo, isRecord, specOf, specOptions, type ComfyObjectInfoNode } from './uiWorkflowConversion';

/**
 * Check an API workflow against the ComfyUI servers that may run it: missing node types, model/option values the
 * server does not list, and numbers outside the server's limits. The first server that answers also tells which
 * nodes are outputs, so the editor can tell nodes that never run (they reach no output) from the rest.
 */

export type ComfyWorkflowNodeIssue = { node_id: string; message: string };

export type ComfyWorkflowServerCheck = {
  server_id: number;
  server_name: string;
  /** ok: nothing found; incompatible: at least one issue; unreachable: /object_info could not be read. */
  status: 'ok' | 'incompatible' | 'unreachable';
  issues: ComfyWorkflowNodeIssue[];
};

export type ComfyWorkflowCheckResult = {
  servers: ComfyWorkflowServerCheck[];
  /** Null until some server answered. */
  output_node_ids: string[] | null;
  unused_node_ids: string[] | null;
};

type ApiNode = { class_type?: unknown; inputs?: Record<string, unknown> };

const MAX_CHECK_SERVERS = 6;

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number';
}

/** The non-modal servers this workflow may run on: its linked servers, or every active one for a new or unlinked workflow. */
function checkServers(workflowId?: number | null): ComfyUIServerRecord[] {
  const servers = workflowId && WorkflowModel.findById(workflowId)
    ? getMcpGenerationRoutingOptions(workflowId).eligible_servers
      .map((server) => ComfyUIServerModel.findById(server.id))
      .filter((server): server is ComfyUIServerRecord => Boolean(server))
    : ComfyUIServerModel.findActiveServers();
  return servers.filter((server) => server.backend_type !== 'modal').slice(0, MAX_CHECK_SERVERS);
}

function checkNodes(graph: Record<string, ApiNode>, infos: Map<string, ComfyObjectInfoNode | null>): ComfyWorkflowNodeIssue[] {
  const issues: ComfyWorkflowNodeIssue[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = typeof node.class_type === 'string' ? node.class_type : null;
    if (!classType) continue;
    const info = infos.get(classType);
    if (!info) {
      issues.push({ node_id: nodeId, message: `${classType} 노드가 서버에 없어.` });
      continue;
    }
    const inputs = isRecord(node.inputs) ? node.inputs : {};
    for (const [name, value] of Object.entries(inputs)) {
      if (isLink(value)) continue;
      const spec = specOf(info, name);
      if (!spec) continue;
      const choices = comboChoices(spec);
      // An empty list is a dynamic combo: its options travel as the node's own inputs, not in object_info.
      const dynamicHit = choices?.length === 0 && Object.entries(inputs).some(([other, entry]) => other !== name && entry === value);
      // Model paths are matched without regard to the separator; generation reconciles it per server anyway.
      if (choices && typeof value === 'string' && !choices.some((choice) => typeof choice === 'string' && choice.replace(/\\/g, '/') === value.replace(/\\/g, '/')) && !dynamicHit) {
        issues.push({ node_id: nodeId, message: `${name}: "${value.slice(0, 120)}"이(가) 서버 목록에 없어.` });
        continue;
      }
      if ((spec[0] === 'INT' || spec[0] === 'FLOAT') && typeof value === 'number') {
        const { min, max } = specOptions(spec);
        if (typeof min === 'number' && value < min) issues.push({ node_id: nodeId, message: `${name}: ${value} < 최소 ${min}` });
        if (typeof max === 'number' && value > max) issues.push({ node_id: nodeId, message: `${name}: ${value} > 최대 ${max}` });
      }
    }
  }
  return issues;
}

/** Nodes an output node never reaches through its inputs: ComfyUI skips them. */
function findUnusedNodes(graph: Record<string, ApiNode>, outputIds: string[]) {
  const reached = new Set<string>();
  const pending = [...outputIds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reached.has(id) || !graph[id]) continue;
    reached.add(id);
    for (const value of Object.values(isRecord(graph[id].inputs) ? graph[id].inputs! : {})) {
      if (isLink(value)) pending.push(String(value[0]));
    }
  }
  return Object.keys(graph).filter((id) => !reached.has(id));
}

export function checkComfyWorkflowOnServers(workflowJson: string, options: { workflowId?: number | null } = {}): Promise<ComfyWorkflowCheckResult> {
  return checkComfyWorkflowAgainst(workflowJson, checkServers(options.workflowId));
}

export async function checkComfyWorkflowAgainst(
  workflowJson: string,
  servers: Array<Pick<ComfyUIServerRecord, 'id' | 'name' | 'endpoint'>>,
): Promise<ComfyWorkflowCheckResult> {
  const parsed = JSON.parse(workflowJson) as unknown;
  if (!isRecord(parsed) || Array.isArray(parsed.nodes)) throw new Error('API 형식 워크플로만 점검할 수 있어.');
  const graph = Object.fromEntries(Object.entries(parsed).filter(([, node]) => isRecord(node))) as Record<string, ApiNode>;
  const classTypes = [...new Set(Object.values(graph).map((node) => node.class_type).filter((value): value is string => typeof value === 'string'))];

  const result: ComfyWorkflowCheckResult = { servers: [], output_node_ids: null, unused_node_ids: null };
  for (const server of servers) {
    let infos: Map<string, ComfyObjectInfoNode | null>;
    try {
      infos = new Map(await Promise.all(classTypes.map(async (type) => [type, await fetchComfyNodeInfo(server.endpoint, type)] as const)));
    } catch {
      result.servers.push({ server_id: server.id, server_name: server.name, status: 'unreachable', issues: [] });
      continue;
    }
    const issues = checkNodes(graph, infos);
    result.servers.push({ server_id: server.id, server_name: server.name, status: issues.length > 0 ? 'incompatible' : 'ok', issues });
    if (!result.output_node_ids) {
      result.output_node_ids = Object.keys(graph).filter((id) => infos.get(String(graph[id].class_type))?.output_node === true);
      result.unused_node_ids = findUnusedNodes(graph, result.output_node_ids);
    }
  }
  return result;
}
