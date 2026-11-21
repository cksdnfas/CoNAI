import {
  MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE,
  type RefModWorkflowIssue,
  type RefModWorkflowIssueCode,
  type RefModWorkflowRoles,
} from '@conai/shared';
import type { MarkedField } from '../../types/workflow';
import { isHiddenWorkflowField } from '../workflowHiddenFieldPolicy';

/**
 * The one place that says which marked fields of a RefMod creation workflow carry its roles. The entry form, the
 * build, the bundle import, record capture and the MCP schema all read roles from here; the frontend never re-derives them.
 */

export const MINIMAX_H3_DIRECTOR_CLASS_TYPE = 'MiniMaxH3Director';
export const MINIMAX_H3_DIRECTOR_NODE_EDITOR = 'minimax_h3_director_dasiwa';

type ApiGraph = Record<string, any>;

const ISSUE_SEVERITY: Record<RefModWorkflowIssueCode, RefModWorkflowIssue['severity']> = {
  'no-export-node': 'blocking',
  'multiple-export-nodes': 'blocking',
  'director-not-exposed': 'blocking',
  'name-not-exposed': 'blocking',
  'description-not-exposed': 'warning',
  'concept-not-exposed': 'warning',
  // Entry-level issues (refmodEntries.ts entryReadiness); a workflow never reports them.
  'name-not-plain': 'blocking',
  'required-input-empty': 'blocking',
};

const issue = (code: RefModWorkflowIssueCode): RefModWorkflowIssue => ({ code, severity: ISSUE_SEVERITY[code] });

/** An API-format graph from a JSON string or object; null when it is neither. */
export function parseComfyApiGraph(workflow: unknown): ApiGraph | null {
  let graph = workflow;
  if (typeof graph === 'string') {
    try { graph = JSON.parse(graph); } catch { return null; }
  }
  return graph && typeof graph === 'object' && !Array.isArray(graph) ? graph as ApiGraph : null;
}

export function refModExportNodeIds(graph: ApiGraph): string[] {
  return Object.keys(graph).filter((id) => graph[id]?.class_type === MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE);
}

/** The export node's Director: the one its timeline_data links to, else the only Director node of the graph. */
export function refModExportDirectorNodeId(graph: ApiGraph, exportNodeId: string): string | null {
  const timeline = graph[exportNodeId]?.inputs?.timeline_data;
  const directors = Object.keys(graph).filter((id) => graph[id]?.class_type === MINIMAX_H3_DIRECTOR_CLASS_TYPE);
  const linked = Array.isArray(timeline) ? directors.find((id) => id === String(timeline[0])) : undefined;
  return linked ?? (directors.length === 1 ? directors[0] : null);
}

/** The Director marked field of a Director node (node editors cannot be hidden). */
export function refModDirectorField(markedFields: readonly MarkedField[], directorNodeId: string | null): MarkedField | undefined {
  if (!directorNodeId) return undefined;
  return markedFields.find((field) => field.node_editor === MINIMAX_H3_DIRECTOR_NODE_EDITOR && field.jsonPath === `${directorNodeId}.inputs`);
}

function visibleExportInput(markedFields: readonly MarkedField[], exportNodeId: string, input: string): string | null {
  const field = markedFields.find((entry) => entry.jsonPath === `${exportNodeId}.inputs.${input}` && !isHiddenWorkflowField(entry));
  return field ? field.id : null;
}

export type RefModExportRoles = { exportNodeId: string; directorNodeId: string | null; roles: RefModWorkflowRoles; issues: RefModWorkflowIssue[] };

/** Roles of one export node. */
export function resolveRefModExportRoles(graph: ApiGraph, exportNodeId: string, markedFields: readonly MarkedField[]): RefModExportRoles {
  const directorNodeId = refModExportDirectorNodeId(graph, exportNodeId);
  const roles: RefModWorkflowRoles = {
    name: visibleExportInput(markedFields, exportNodeId, 'name'),
    description: visibleExportInput(markedFields, exportNodeId, 'description'),
    concept: visibleExportInput(markedFields, exportNodeId, 'concept_type'),
    director: refModDirectorField(markedFields, directorNodeId)?.id ?? null,
  };
  const issues: RefModWorkflowIssue[] = [];
  if (!roles.director) issues.push(issue('director-not-exposed'));
  if (!roles.name) issues.push(issue('name-not-exposed'));
  if (!roles.description) issues.push(issue('description-not-exposed'));
  if (!roles.concept) issues.push(issue('concept-not-exposed'));
  return { exportNodeId, directorNodeId, roles, issues };
}

export type RefModWorkflowRoleResult = {
  exportNodeId: string | null;
  directorNodeId: string | null;
  roles: RefModWorkflowRoles;
  issues: RefModWorkflowIssue[];
  /** An entry may link it (exactly one export node). */
  linkable: boolean;
  /** No blocking issue: an entry can be built with it. */
  buildable: boolean;
};

const NO_ROLES: RefModWorkflowRoles = { name: null, description: null, concept: null, director: null };

/** Roles of a creation workflow for an entry: it must have exactly one DaSiWaH3RefModExport node. */
export function resolveRefModWorkflowRoles(workflowJson: unknown, markedFields: readonly MarkedField[]): RefModWorkflowRoleResult {
  const graph = parseComfyApiGraph(workflowJson);
  const exportNodeIds = graph ? refModExportNodeIds(graph) : [];
  if (!graph || exportNodeIds.length !== 1) {
    return {
      exportNodeId: null, directorNodeId: null, roles: { ...NO_ROLES },
      issues: [issue(exportNodeIds.length > 1 ? 'multiple-export-nodes' : 'no-export-node')], linkable: false, buildable: false,
    };
  }
  const resolved = resolveRefModExportRoles(graph, exportNodeIds[0], markedFields);
  return { ...resolved, linkable: true, buildable: !resolved.issues.some((entry) => entry.severity === 'blocking') };
}
