import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const markedFieldsEditorSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx'),
  'utf8',
)
const authoringGraphSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-graph.tsx'),
  'utf8',
)
const comfyModuleSaveModalSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-module-save-modal.tsx'),
  'utf8',
)
const moduleSaveModalSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/module-save-modal.tsx'),
  'utf8',
)
const comfyGenerationPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-generation-panel.tsx'),
  'utf8',
)
const comfyWorkflowControllerPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-controller-panel.tsx'),
  'utf8',
)

match(
  markedFieldsEditorSource,
  /const expandedFieldIdSet = useMemo\(\(\) => new Set\(expandedFieldIds\), \[expandedFieldIds\]\)/,
  'Comfy workflow marked-fields editor should memoize expanded field ids for list rendering',
)
match(
  markedFieldsEditorSource,
  /const isExpanded = expandedFieldIdSet\.has\(field\.id\)/,
  'Comfy workflow marked-fields rows should use Set.has for expansion membership',
)
doesNotMatch(
  markedFieldsEditorSource,
  /expandedFieldIds\.includes\(field\.id\)/,
  'Comfy workflow marked-fields rows must not scan expanded ids for every rendered field',
)
match(
  authoringGraphSource,
  /const markedJsonPathSet = useMemo\(\(\) => new Set\(data\.markedJsonPaths\), \[data\.markedJsonPaths\]\)/,
  'Comfy workflow authoring node cards should memoize marked JSON paths for input rendering',
)
match(
  authoringGraphSource,
  /const selected = markedJsonPathSet\.has\(path\)/,
  'Comfy workflow authoring inputs should use Set.has for marked-path membership',
)
doesNotMatch(
  authoringGraphSource,
  /markedJsonPaths\.includes\(path\)/,
  'Comfy workflow authoring inputs must not scan marked JSON paths for every rendered input',
)
match(
  comfyModuleSaveModalSource,
  /const exposedFieldIdSet = useMemo\(\(\) => new Set\(exposedFieldIds\), \[exposedFieldIds\]\)/,
  'Comfy module save modal should memoize exposed field ids for checkbox rendering',
)
match(
  comfyModuleSaveModalSource,
  /const checked = exposedFieldIdSet\.has\(field\.key\)/,
  'Comfy module save modal checkboxes should use Set.has for exposed-field membership',
)
doesNotMatch(
  comfyModuleSaveModalSource,
  /exposedFieldIds\.includes\(field\.key\)/,
  'Comfy module save modal must not scan exposedFieldIds for every field option',
)
match(
  moduleSaveModalSource,
  /const exposedFieldKeySet = useMemo\(\(\) => new Set\(exposedFieldKeys\), \[exposedFieldKeys\]\)/,
  'Module save modal should memoize exposed field keys for checkbox rendering',
)
match(
  moduleSaveModalSource,
  /const checked = exposedFieldKeySet\.has\(field\.key\)/,
  'Module save modal checkboxes should use Set.has for exposed-field membership',
)
doesNotMatch(
  moduleSaveModalSource,
  /exposedFieldKeys\.includes\(field\.key\)/,
  'Module save modal must not scan exposedFieldKeys for every field option',
)
match(
  comfyGenerationPanelSource,
  /const workflowById = useMemo\(\s*\(\) => new Map<number, GenerationWorkflow>\(\(workflowsQuery\.data \?\? \[\]\)\.map\(\(workflow\) => \[workflow\.id, workflow\]\)\),\s*\[workflowsQuery\.data\],\s*\)/,
  'Comfy generation panel should memoize workflow id lookups from the workflow query result',
)
match(
  comfyGenerationPanelSource,
  /selectedWorkflowId === null \? null : workflowById\.get\(selectedWorkflowId\) \?\? null/,
  'Selected workflow lookup should use the memoized workflow map',
)
match(
  comfyGenerationPanelSource,
  /moduleSaveWorkflowId === null \? null : workflowById\.get\(moduleSaveWorkflowId\) \?\? null/,
  'Module-save workflow lookup should use the memoized workflow map',
)
doesNotMatch(
  comfyGenerationPanelSource,
  /workflowsQuery\.data\?\.find\(\(workflow\) => workflow\.id === selectedWorkflowId\)/,
  'Selected workflow lookup must not rescan workflows for every render',
)
doesNotMatch(
  comfyGenerationPanelSource,
  /workflowsQuery\.data\?\.find\(\(workflow\) => workflow\.id === moduleSaveWorkflowId\)/,
  'Module-save workflow lookup must not rescan workflows for every render',
)
match(
  comfyGenerationPanelSource,
  /const dropdownListById = useMemo\(\s*\(\) => new Map\(\(dropdownListsQuery\.data \?\? \[\]\)\.map\(\(list\) => \[list\.id, list\]\)\),\s*\[dropdownListsQuery\.data\],\s*\)/,
  'Comfy generation panel should memoize dropdown list id lookups from the dropdown query result',
)
match(
  comfyGenerationPanelSource,
  /const list = dropdownListById\.get\(listId\)/,
  'Dropdown list deletion should use the memoized id map',
)
doesNotMatch(
  comfyGenerationPanelSource,
  /dropdownListsQuery\.data\?\.find\(\(item\) => item\.id === listId\)/,
  'Dropdown list deletion must not rescan dropdown lists for every delete action',
)
match(
  comfyWorkflowControllerPanelSource,
  /const missingRequiredFields = useMemo\(/,
  'Comfy workflow controller should derive missing required fields before queueing',
)
match(
  comfyWorkflowControllerPanelSource,
  /hasWorkflowFieldValue\(workflowDraft\[field\.id\]\)/,
  'Comfy workflow controller should reuse the shared workflow-field value helper for readiness',
)
match(
  comfyWorkflowControllerPanelSource,
  /const readinessIssues = useMemo\(\(\) => \{/,
  'Comfy workflow controller should render actionable readiness issues for inputs and routing',
)
match(
  comfyWorkflowControllerPanelSource,
  /routingCanGenerate && missingRequiredFields\.length === 0 && queueRegistrationCountValid/,
  'Comfy workflow controller should gate queueing on routing, required fields, and queue count',
)
doesNotMatch(
  comfyWorkflowControllerPanelSource,
  /실행 준비 완료|Ready to queue|필수 입력과 라우팅 상태가 확인/,
  'Comfy workflow controller must not show repeated success readiness copy',
)

console.log('Comfy workflow authoring contracts verified.')
