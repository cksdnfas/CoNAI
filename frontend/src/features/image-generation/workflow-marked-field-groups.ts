import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'

const WORKFLOW_NODE_INPUT_PATH_PATTERN = /^([^.[\]]+)\.inputs(?:\.|$)/

export type WorkflowMarkedFieldGroup = {
  key: string
  nodeId: string | null
  nodeTitle: string | null
  fields: WorkflowMarkedField[]
}

type WorkflowMarkedFieldNodeSource = {
  nodeId: string | null
  nodeTitle: string | null
}

type WorkflowNodeSource = {
  id: string
  title: string
}

function normalizeSourceValue(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/** Resolve a marked field's source node from metadata or its legacy JSON path. */
export function resolveWorkflowMarkedFieldNodeSource(field: WorkflowMarkedField): WorkflowMarkedFieldNodeSource {
  const metadataNodeId = normalizeSourceValue(field.source_node_id)
  const legacyNodeId = field.jsonPath.match(WORKFLOW_NODE_INPUT_PATH_PATTERN)?.[1] ?? null
  const nodeId = metadataNodeId ?? legacyNodeId
  const metadataNodeTitle = normalizeSourceValue(field.source_node_title)

  return {
    nodeId,
    nodeTitle: metadataNodeTitle ?? (nodeId ? `Node ${nodeId}` : null),
  }
}

/** Group marked fields by source node while preserving group and field order. */
export function groupWorkflowMarkedFieldsByNode(fields: readonly WorkflowMarkedField[]): WorkflowMarkedFieldGroup[] {
  const groups: WorkflowMarkedFieldGroup[] = []
  const groupByKey = new Map<string, WorkflowMarkedFieldGroup>()

  fields.forEach((field, index) => {
    const source = resolveWorkflowMarkedFieldNodeSource(field)
    const key = source.nodeId ? `node:${source.nodeId}` : `field:${field.id}:${index}`
    const existingGroup = groupByKey.get(key)

    if (existingGroup) {
      existingGroup.fields.push(field)
      if (existingGroup.nodeTitle === `Node ${existingGroup.nodeId}` && field.source_node_title?.trim()) {
        existingGroup.nodeTitle = field.source_node_title.trim()
      }
      return
    }

    const group: WorkflowMarkedFieldGroup = {
      key,
      nodeId: source.nodeId,
      nodeTitle: source.nodeTitle,
      fields: [field],
    }
    groups.push(group)
    groupByKey.set(key, group)
  })

  return groups
}

/** Add stable node-source metadata to fields that can be matched to workflow nodes. */
export function enrichWorkflowMarkedFieldsWithNodeSources(
  fields: readonly WorkflowMarkedField[],
  nodes: readonly WorkflowNodeSource[],
) {
  const nodeTitleById = new Map(nodes.map((node) => [node.id, node.title]))

  return fields.map((field) => {
    const source = resolveWorkflowMarkedFieldNodeSource(field)
    if (!source.nodeId) {
      return field
    }

    const nodeTitle = normalizeSourceValue(field.source_node_title) ?? nodeTitleById.get(source.nodeId)?.trim()
    return {
      ...field,
      source_node_id: source.nodeId,
      source_node_title: nodeTitle || undefined,
    }
  })
}

/** Reorder complete source-node groups without changing field order inside a group. */
export function reorderWorkflowMarkedFieldGroup(
  fields: readonly WorkflowMarkedField[],
  sourceGroupKey: string,
  targetGroupKey: string,
) {
  if (sourceGroupKey === targetGroupKey) {
    return [...fields]
  }

  const groups = groupWorkflowMarkedFieldsByNode(fields)
  const sourceIndex = groups.findIndex((group) => group.key === sourceGroupKey)
  const targetIndex = groups.findIndex((group) => group.key === targetGroupKey)
  if (sourceIndex < 0 || targetIndex < 0) {
    return [...fields]
  }

  const [movedGroup] = groups.splice(sourceIndex, 1)
  groups.splice(targetIndex, 0, movedGroup)
  return groups.flatMap((group) => group.fields)
}

/** Reorder fields only when both fields belong to the same source-node group. */
export function reorderWorkflowMarkedFieldWithinGroup(
  fields: readonly WorkflowMarkedField[],
  sourceFieldId: string,
  targetFieldId: string,
) {
  if (sourceFieldId === targetFieldId) {
    return [...fields]
  }

  const groups = groupWorkflowMarkedFieldsByNode(fields)
  const sourceGroup = groups.find((group) => group.fields.some((field) => field.id === sourceFieldId))
  const targetGroup = groups.find((group) => group.fields.some((field) => field.id === targetFieldId))
  if (!sourceGroup || sourceGroup !== targetGroup) {
    return [...fields]
  }

  const sourceIndex = sourceGroup.fields.findIndex((field) => field.id === sourceFieldId)
  const targetIndex = sourceGroup.fields.findIndex((field) => field.id === targetFieldId)
  const [movedField] = sourceGroup.fields.splice(sourceIndex, 1)
  sourceGroup.fields.splice(targetIndex, 0, movedField)
  return groups.flatMap((group) => group.fields)
}
