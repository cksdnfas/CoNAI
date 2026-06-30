import { readFileSync } from 'node:fs'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function extractFunction(sourceText: string, functionName: string) {
  const start = sourceText.indexOf(`export function ${functionName}`)
  assert(start !== -1, `${functionName} export must exist`)

  const bodyStart = sourceText.indexOf('{', start)
  assert(bodyStart !== -1, `${functionName} body must exist`)

  let depth = 0
  for (let index = bodyStart; index < sourceText.length; index += 1) {
    const char = sourceText[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return sourceText.slice(start, index + 1)
      }
    }
  }

  throw new Error(`${functionName} body must be closed`)
}

function assertExecutionStatusLookupPolicy() {
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const syncSource = source('features/module-graph/use-module-graph-workspace-sync.ts')
  const typesSource = source('features/module-graph/module-graph-types.ts')
  const portCellsSource = source('features/module-graph/components/module-graph-port-cells.tsx')
  const workflowRunnerSource = source('features/module-graph/components/workflow-runner-panel.tsx')
  const statusSource = extractFunction(sharedSource, 'getNodeExecutionStatus')
  const branchOutputStateSource = extractFunction(syncSource, 'buildConditionalOutputStates')
  const skippedNodeReasonSource = extractFunction(syncSource, 'buildSkippedNodeReasonMap')
  const buildFlowFromGraphRecordSource = extractFunction(sharedSource, 'buildFlowFromGraphRecord')

  assert(
    sharedSource.includes('export function buildNodeOrderIndex'),
    'module graph execution status should expose a reusable node-order index builder',
  )
  assert(
    statusSource.includes('nodeOrderIndex: ReadonlyMap<string, number>'),
    'execution status resolver should accept the precomputed node-order index',
  )
  assert(
    !statusSource.includes('orderedNodeIds.indexOf'),
    'execution status resolver must not scan orderedNodeIds for every node status check',
  )
  assert(
    syncSource.includes('buildNodeOrderIndex(orderedNodeIds)'),
    'workspace sync should build the node-order index once per execution plan',
  )
  assert(
    syncSource.includes('const orderedNodeIdSet = new Set(orderedNodeIds)'),
    'workspace sync should build the ordered-node membership set once per execution plan',
  )
  assert(
    syncSource.includes('orderedNodeIdSet.has(node.id)'),
    'workspace sync should use Set.has for per-node execution-plan membership',
  )
  assert(
    typesSource.includes("export type ModuleGraphConditionalOutputState = 'active' | 'inactive'")
      && typesSource.includes('conditionalOutputStates?: Record<string, ModuleGraphConditionalOutputState> | null'),
    'module graph nodes should carry conditional output state for post-run branch diagnostics',
  )
  assert(
    typesSource.includes("export type ModuleGraphExecutionStatus = 'idle' | 'completed' | 'failed' | 'blocked' | 'skipped'")
      && typesSource.includes("export type ModuleGraphExecutionSkipReason = 'disabled' | 'inactive-branch' | 'source-node-skipped' | 'source-output-disabled' | 'unknown'")
      && typesSource.includes('executionSkipReason?: ModuleGraphExecutionSkipReason | null'),
    'module graph nodes should carry skipped execution status and reasons',
  )
  assert(
    branchOutputStateSource.includes("metadata?.operationKey !== 'system.logic_if_branch'")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, artifact.node_id, activePort, 'active')")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, artifact.node_id, inactivePort, 'inactive')"),
    'workspace sync should derive active and inactive IF branch output paths from execution artifacts',
  )
  assert(
    branchOutputStateSource.includes("log.event_type !== 'node_skipped_inactive_branch'")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, sourceNodeId, sourcePortKey, 'inactive')"),
    'workspace sync should preserve inactive upstream branch paths from skip logs',
  )
  assert(
    syncSource.includes('conditionalOutputStateSignature')
      && syncSource.includes('conditionalOutputStates: conditionalOutputStatesByNode[node.id] ?? null'),
    'workspace sync should include branch output states in node sync and signature calculation',
  )
  assert(
    skippedNodeReasonSource.includes("log.event_type === 'node_skipped_disabled'")
      && skippedNodeReasonSource.includes("log.event_type === 'node_skipped_inactive_branch'")
      && skippedNodeReasonSource.includes("skippedNodeReasons.set(log.node_id, 'disabled')")
      && syncSource.includes('skippedNodeReasonSignature')
      && syncSource.includes('executionSkipReason: skippedNodeReasons.get(node.id) ?? null'),
    'workspace sync should derive skipped-node reasons from execution logs and sync them to node cards',
  )
  assert(
    statusSource.includes('skippedNodeReasons?: ReadonlyMap<string, ModuleGraphExecutionSkipReason>')
      && sharedSource.includes("if (skippedNodeReasons?.has(nodeId))")
      && sharedSource.includes("return 'skipped'"),
    'execution status resolver should expose skipped nodes before failed-run fallback states',
  )
  assert(
    portCellsSource.includes('outputState?: ModuleGraphConditionalOutputState | null')
      && portCellsSource.includes("t({ ko: '활성 경로', en: 'Active path' })")
      && portCellsSource.includes("t({ ko: '비활성 경로', en: 'Inactive path' })"),
    'node output ports should show active and inactive conditional branch path labels',
  )
  assert(
    !syncSource.includes('orderedNodeIds.includes(node.id)'),
    'workspace sync must not scan orderedNodeIds while mapping each node',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('const nodeById = new Map(nodes.map((node) => [node.id, node]))'),
    'saved workflow loading should build a node lookup map once before edge conversion',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.source_node_id)'),
    'saved workflow loading should use the node lookup for source edge ports',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.target_node_id)'),
    'saved workflow loading should use the node lookup for target edge ports',
  )
  assert(
    !buildFlowFromGraphRecordSource.includes('nodes.find((node) => node.id === edge.'),
    'saved workflow loading must not scan graph nodes for every edge',
  )
  assert(
    workflowRunnerSource.includes('const runReadinessMessage = !selectedGraph'),
    'workflow runner should compute one actionable run-readiness message before execution',
  )
  assert(
    workflowRunnerSource.includes('const firstBlockingIssue = validationIssues.find((issue) => issue.severity === \'error\') ?? null'),
    'workflow runner should surface the first blocking validation issue near the run action',
  )
  assert(
    workflowRunnerSource.includes('Action needed before running'),
    'workflow runner should render an explicit action-needed state when validation blocks execution',
  )
  assert(
    workflowRunnerSource.includes('const shouldShowRunReadinessAlert = isExecuting || !canExecute || warningIssueCount > 0'),
    'workflow runner should only show readiness alerts when action, warning, or execution feedback is needed',
  )
  assert(
    !/필수 실행 조건이 충족|Required run conditions are satisfied|<span>\{canExecute \? t\(\{ ko: '실행 준비'/.test(workflowRunnerSource),
    'workflow runner must not show repeated success readiness copy',
  )

  const workflowValidationPanelSource = source('features/module-graph/components/workflow-validation-panel.tsx')
  const workflowEditorViewSource = source('features/module-graph/components/module-workflow-editor-view.tsx')
  assert(
    workflowValidationPanelSource.includes('if (issues.length === 0 && !showHeader)'),
    'workflow validation panel should render nothing for empty inline validation state',
  )
  assert(
    !/지금 바로 실행 가능|Ready to run now|필수 입력 확인 완료|Required inputs confirmed/.test(workflowValidationPanelSource),
    'workflow validation panel must not show repeated success readiness copy',
  )
  assert(
    workflowEditorViewSource.includes('if (validationIssues.length > 0)')
      && workflowEditorViewSource.includes('open={isValidationPopupOpen && validationIssues.length > 0}'),
    'workflow editor validation popup should open only when there are validation issues',
  )
  assert(
    !/지금 상태 좋아|Everything looks good|막히는 이슈는 없어|There are no blocking issues/.test(workflowEditorViewSource),
    'workflow editor validation popup must not show repeated success readiness copy',
  )
}

assertExecutionStatusLookupPolicy()

console.log('Module graph execution status contracts verified.')
