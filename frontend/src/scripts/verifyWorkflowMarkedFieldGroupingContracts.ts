import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import {
  enrichWorkflowMarkedFieldsWithNodeSources,
  groupWorkflowMarkedFieldsByNode,
  reorderWorkflowMarkedFieldGroup,
  reorderWorkflowMarkedFieldWithinGroup,
} from '@/features/image-generation/workflow-marked-field-groups'

function createField(id: string, jsonPath: string, source?: { nodeId?: string; nodeTitle?: string }): WorkflowMarkedField {
  return {
    id,
    label: id,
    jsonPath,
    source_node_id: source?.nodeId,
    source_node_title: source?.nodeTitle,
    type: 'text',
  }
}

const fields = [
  createField('seed', '6.inputs.seed'),
  createField('prompt', '7.inputs.text', { nodeId: '7', nodeTitle: 'CLIP Text Encode' }),
  createField('steps', '6.inputs.steps'),
  createField('orphan-a', 'settings.value'),
  createField('orphan-b', 'settings.other'),
]

const groups = groupWorkflowMarkedFieldsByNode(fields)
assert.deepEqual(
  groups.map((group) => ({ key: group.key, nodeId: group.nodeId, title: group.nodeTitle, fields: group.fields.map((field) => field.id) })),
  [
    { key: 'node:6', nodeId: '6', title: 'Node 6', fields: ['seed', 'steps'] },
    { key: 'node:7', nodeId: '7', title: 'CLIP Text Encode', fields: ['prompt'] },
    { key: 'field:orphan-a:3', nodeId: null, title: null, fields: ['orphan-a'] },
    { key: 'field:orphan-b:4', nodeId: null, title: null, fields: ['orphan-b'] },
  ],
  'grouping should prefer source metadata, fall back to JSON paths, preserve order, and isolate unknown sources',
)

const enrichedFields = enrichWorkflowMarkedFieldsWithNodeSources(fields, [
  { id: '6', title: 'KSampler' },
  { id: '7', title: 'Changed title must not replace saved metadata' },
])
assert.deepEqual(
  enrichedFields.slice(0, 3).map((field) => [field.id, field.source_node_id, field.source_node_title]),
  [
    ['seed', '6', 'KSampler'],
    ['prompt', '7', 'CLIP Text Encode'],
    ['steps', '6', 'KSampler'],
  ],
  'save enrichment should add node metadata without overwriting an existing source title',
)

assert.deepEqual(
  reorderWorkflowMarkedFieldGroup(fields, 'node:6', 'node:7').map((field) => field.id),
  ['prompt', 'seed', 'steps', 'orphan-a', 'orphan-b'],
  'dragging a node group should move all of its fields together',
)
assert.deepEqual(
  reorderWorkflowMarkedFieldWithinGroup(fields, 'steps', 'seed').map((field) => field.id),
  ['steps', 'seed', 'prompt', 'orphan-a', 'orphan-b'],
  'field dragging should reorder fields inside the same node group',
)
assert.deepEqual(
  reorderWorkflowMarkedFieldWithinGroup(fields, 'seed', 'prompt').map((field) => field.id),
  fields.map((field) => field.id),
  'field dragging must not move a field into a different node group',
)

const authoringGraphSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-graph.tsx'),
  'utf8',
)
const authoringModalSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-modal.tsx'),
  'utf8',
)
const markedFieldsEditorSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx'),
  'utf8',
)
const controllerSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-controller-panel.tsx'),
  'utf8',
)
const groupListSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-group-list.tsx'),
  'utf8',
)
const publicPageSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/public-comfy-workflow-page.tsx'),
  'utf8',
)

assert.match(authoringGraphSource, /source_node_id: nodeId,[\s\S]*source_node_title: nodeTitle/, 'new marked fields should record their source node')
assert.match(authoringModalSource, /marked_fields: enrichWorkflowMarkedFieldsWithNodeSources\(markedFields, workflowNodeSources\)/, 'saved legacy fields should be enriched from the workflow graph')
assert.match(markedFieldsEditorSource, /groupWorkflowMarkedFieldsByNode\(markedFields\)[\s\S]*onReorderMarkedFieldGroup/, 'the authoring editor should render and reorder node groups')
assert.match(controllerSource, /<WorkflowFieldGroupList[\s\S]*fields=\{workflowFields\}/, 'the internal generation controller should use the shared grouped list')
assert.match(publicPageSource, /<WorkflowFieldGroupList[\s\S]*fields=\{workflowFields\}/, 'the public generation page should use the shared grouped list')
assert.match(groupListSource, /group\.fields\.length === 1[\s\S]*<WorkflowFieldDisclosureCard[\s\S]*<WorkflowNodeFieldDisclosureCard/, 'single fields should keep their existing card while multi-field nodes use one grouped card')
assert.match(groupListSource, /<WorkflowFieldDisclosureCard[\s\S]*loraOptions=\{loraOptions\}[\s\S]*<WorkflowNodeFieldDisclosureCard[\s\S]*loraOptions=\{loraOptions\}/, 'single and grouped fields should preserve shared LoRA options')

console.log('Workflow marked-field grouping contracts verified.')
