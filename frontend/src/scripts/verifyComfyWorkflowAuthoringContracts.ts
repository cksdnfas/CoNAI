import { deepEqual, doesNotMatch, equal, match } from 'node:assert/strict'
import * as ts from 'typescript'
import verifyHelpers from '../../../scripts/verify-helpers'
import { buildComfyWorkflowPayload, buildPublicQueueRoleLimitsPayload } from '../features/image-generation/components/comfy-workflow-public-settings'

const { createSourceReader, reportVerificationSuccess } = verifyHelpers
const source = createSourceReader(process.cwd())

const markedFieldsEditorSource = source('src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx')
const authoringGraphSource = source('src/features/image-generation/components/comfy-workflow-authoring-graph.tsx')
const authoringModalSource = source('src/features/image-generation/components/comfy-workflow-authoring-modal.tsx')
const authoringControllerSource = source('src/features/image-generation/components/use-comfy-workflow-authoring-controller.ts')
const publicSettingsSource = source('src/features/image-generation/components/comfy-workflow-public-settings.ts')
const comfyModuleSaveModalSource = source('src/features/image-generation/components/comfy-module-save-modal.tsx')
const moduleSaveModalSource = source('src/features/image-generation/components/module-save-modal.tsx')
const comfyGenerationPanelSource = source('src/features/image-generation/components/comfy-generation-panel.tsx')
const comfyWorkflowControllerPanelSource = source('src/features/image-generation/components/comfy-workflow-controller-panel.tsx')

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

function collectHookDependencyKeys(sourceText: string, hookName: string) {
  const sourceFile = ts.createSourceFile('contract.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const dependencyKeys: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === hookName
      && node.arguments[1]
      && ts.isArrayLiteralExpression(node.arguments[1])
    ) {
      dependencyKeys.push(node.arguments[1].elements.map((element) => element.getText(sourceFile)).join(','))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return dependencyKeys
}

function collectControllerWiring(sourceText: string) {
  const sourceFile = ts.createSourceFile('modal.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const optionKeys = new Set<string>()
  const bindings = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'useComfyWorkflowAuthoringController'
    ) {
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) bindings.add(element.name.getText(sourceFile))
      }
      const options = node.initializer.arguments[0]
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (ts.isShorthandPropertyAssignment(property)) optionKeys.add(property.name.text)
          else if (ts.isPropertyAssignment(property)) optionKeys.add(property.name.getText(sourceFile))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { bindings, optionKeys }
}

const controllerEffectDependencies = collectHookDependencyKeys(authoringControllerSource, 'useEffect')
deepEqual(
  new Set(controllerEffectDependencies),
  new Set([
    'initialData,mode,open',
    'isPublicPage,open,publicSlug.length,workflowName',
    'authoringFlowInstance,open,parsedGraph,workflowEditorTab',
    'graphSearchQuery,workflowEditorTab',
    'graphSearchIndex,graphSearchQuery,jsonSearchMatches,workflowEditorTab',
    'activeGraphSearchNodeId,authoringFlowInstance,parsedGraph',
  ]),
  'authoring controller should keep the six established effects and dependency boundaries',
)
equal(controllerEffectDependencies.length, 6, 'authoring controller should own exactly six effects')
equal(collectHookDependencyKeys(authoringModalSource, 'useEffect').length, 0, 'authoring modal should not regain controller effects')
const controllerWiring = collectControllerWiring(authoringModalSource)
deepEqual(
  controllerWiring.optionKeys,
  new Set(['dropdownLists', 'initialData', 'mode', 'onClose', 'onSaved', 'open']),
  'authoring modal should pass the complete lifecycle contract into its controller',
)
for (const binding of ['workflowName', 'workflowJson', 'handleSave', 'parsedGraph', 'roleLimitGroups', 'setWorkflowEditorTab']) {
  equal(controllerWiring.bindings.has(binding), true, `authoring modal should wire controller binding ${binding}`)
}
match(
  authoringModalSource,
  /headerClassName="flex-col items-stretch lg:flex-row lg:items-center"/,
  'Comfy workflow editor controls should stack below the desktop breakpoint',
)
match(
  authoringModalSource,
  /useComfyWorkflowAuthoringController\(\{/,
  'Comfy workflow modal should delegate authoring state and effects to the controller hook',
)
doesNotMatch(
  authoringModalSource,
  /createGenerationWorkflow|updateGenerationWorkflow|useQuery\(/,
  'Comfy workflow modal should remain a render-only consumer of the authoring controller',
)
match(
  authoringControllerSource,
  /buildComfyWorkflowPayload\(\{/,
  'Comfy workflow controller should use the shared public-settings payload builder',
)
match(
  publicSettingsSource,
  /public_queue_role_limits: isPublicPage \? buildPublicQueueRoleLimitsPayload\(publicQueueRoleLimits\) : null/,
  'public workflow payload builder should own queue role-limit nullability',
)
match(
  authoringModalSource,
  /className="flex w-full flex-wrap items-center justify-start gap-2 lg:w-auto lg:justify-end"/,
  'Comfy workflow editor actions should use the available width when stacked',
)
match(
  authoringModalSource,
  /className="relative min-w-0 basis-full flex-1 sm:basis-auto sm:min-w-\[280px\]"/,
  'Comfy workflow search should take its own row without forcing narrow viewports wider',
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
  /routingCanGenerate && missingRequiredFields\.length === 0 && workflowNodeIssues\.length === 0 && queueRegistrationCountValid/,
  'Comfy workflow controller should gate queueing on routing, required fields, composite-node issues, and queue count',
)

deepEqual(
  buildPublicQueueRoleLimitsPayload({ guest: '', admin: '1005', blocked: '-2', invalid: 'nope' }),
  { admin: 999, blocked: 0 },
  'public role-limit builder should preserve unlimited omission and inclusive 0..999 clamping',
)
const privatePayload = buildComfyWorkflowPayload({
  artifactDirectoryMode: 'shared', artifactRootPath: ' ', color: '#2196f3', description: ' ', isActive: true,
  isPublicPage: false, markedFields: [], publicQueueMaxCount: '7', publicQueueRoleLimits: { guest: '2' },
  publicSlug: 'Ignored Slug', resultViewMode: 'history', workflowJson: '{}', workflowName: ' Workflow ',
})
equal(privatePayload.name, 'Workflow', 'payload builder should trim workflow names')
equal(privatePayload.description, undefined, 'payload builder should omit empty descriptions')
equal(privatePayload.public_slug, null, 'private workflows should clear public slugs')
equal(privatePayload.public_queue_max_count, null, 'private workflows should clear per-request queue limits')
equal(privatePayload.public_queue_role_limits, null, 'private workflows should clear role queue limits')

const publicPayload = buildComfyWorkflowPayload({
  artifactDirectoryMode: 'per_run', artifactRootPath: ' runtime/results ', color: '#fff', description: 'desc', isActive: false,
  isPublicPage: true, markedFields: [], publicQueueMaxCount: '99', publicQueueRoleLimits: { guest: '4' },
  publicSlug: ' Public Workflow ', resultViewMode: 'artifact_explorer', workflowJson: '{}', workflowName: 'Workflow',
})
equal(publicPayload.public_slug, 'public-workflow', 'public payload should normalize its slug')
equal(publicPayload.public_queue_max_count, 32, 'public payload should keep the 1..32 request clamp')
deepEqual(publicPayload.public_queue_role_limits, { guest: 4 }, 'public payload should retain per-role per-member limits')
equal(publicPayload.artifact_root_path, 'runtime/results', 'payload builder should trim artifact roots')
doesNotMatch(
  comfyWorkflowControllerPanelSource,
  /실행 준비 완료|Ready to queue|필수 입력과 라우팅 상태가 확인/,
  'Comfy workflow controller must not show repeated success readiness copy',
)

reportVerificationSuccess('Comfy workflow authoring contracts verified.')
