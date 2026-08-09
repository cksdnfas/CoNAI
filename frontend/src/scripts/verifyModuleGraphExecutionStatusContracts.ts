import verifyHelpers from '../../../scripts/verify-helpers'

const { assertContract, createSourceReader, extractFunction, reportVerificationSuccess } = verifyHelpers

const source = createSourceReader(new URL('../', import.meta.url))

function assertExecutionStatusLookupPolicy() {
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const syncSource = source('features/module-graph/use-module-graph-workspace-sync.ts')
  const typesSource = source('features/module-graph/module-graph-types.ts')
  const portCellsSource = source('features/module-graph/components/module-graph-port-cells.tsx')
  const workflowRunnerSource = source('features/module-graph/components/workflow-runner-panel.tsx')
  const statusSource = extractFunction(sharedSource, 'getNodeExecutionStatus', { requireExport: true })
  const branchOutputStateSource = extractFunction(syncSource, 'buildConditionalOutputStates', { requireExport: true })
  const skippedNodeReasonSource = extractFunction(syncSource, 'buildSkippedNodeReasonMap', { requireExport: true })
  const buildFlowFromGraphRecordSource = extractFunction(sharedSource, 'buildFlowFromGraphRecord', { requireExport: true })

  assertContract(
    sharedSource.includes('export function buildNodeOrderIndex'),
    'module graph execution status should expose a reusable node-order index builder',
  )
  assertContract(
    statusSource.includes('nodeOrderIndex: ReadonlyMap<string, number>'),
    'execution status resolver should accept the precomputed node-order index',
  )
  assertContract(
    !statusSource.includes('orderedNodeIds.indexOf'),
    'execution status resolver must not scan orderedNodeIds for every node status check',
  )
  assertContract(
    syncSource.includes('buildNodeOrderIndex(orderedNodeIds)'),
    'workspace sync should build the node-order index once per execution plan',
  )
  assertContract(
    syncSource.includes('const orderedNodeIdSet = new Set(orderedNodeIds)'),
    'workspace sync should build the ordered-node membership set once per execution plan',
  )
  assertContract(
    syncSource.includes('orderedNodeIdSet.has(node.id)'),
    'workspace sync should use Set.has for per-node execution-plan membership',
  )
  assertContract(
    typesSource.includes("export type ModuleGraphConditionalOutputState = 'active' | 'inactive'")
      && typesSource.includes('conditionalOutputStates?: Record<string, ModuleGraphConditionalOutputState> | null'),
    'module graph nodes should carry conditional output state for post-run branch diagnostics',
  )
  assertContract(
    typesSource.includes("export type ModuleGraphExecutionStatus = 'idle' | 'completed' | 'failed' | 'blocked' | 'skipped'")
      && typesSource.includes("export type ModuleGraphExecutionSkipReason = 'disabled' | 'inactive-branch' | 'source-node-skipped' | 'source-output-disabled' | 'unknown'")
      && typesSource.includes('executionSkipReason?: ModuleGraphExecutionSkipReason | null'),
    'module graph nodes should carry skipped execution status and reasons',
  )
  assertContract(
    branchOutputStateSource.includes("metadata?.operationKey !== 'system.logic_if_branch'")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, artifact.node_id, activePort, 'active')")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, artifact.node_id, inactivePort, 'inactive')"),
    'workspace sync should derive active and inactive IF branch output paths from execution artifacts',
  )
  assertContract(
    branchOutputStateSource.includes("log.event_type !== 'node_skipped_inactive_branch'")
      && branchOutputStateSource.includes("writeConditionalOutputState(outputStatesByNode, sourceNodeId, sourcePortKey, 'inactive')"),
    'workspace sync should preserve inactive upstream branch paths from skip logs',
  )
  assertContract(
    syncSource.includes('conditionalOutputStateSignature')
      && syncSource.includes('conditionalOutputStates: conditionalOutputStatesByNode[node.id] ?? null'),
    'workspace sync should include branch output states in node sync and signature calculation',
  )
  assertContract(
    skippedNodeReasonSource.includes("log.event_type === 'node_skipped_disabled'")
      && skippedNodeReasonSource.includes("log.event_type === 'node_skipped_inactive_branch'")
      && skippedNodeReasonSource.includes("skippedNodeReasons.set(log.node_id, 'disabled')")
      && syncSource.includes('skippedNodeReasonSignature')
      && syncSource.includes('executionSkipReason: skippedNodeReasons.get(node.id) ?? null'),
    'workspace sync should derive skipped-node reasons from execution logs and sync them to node cards',
  )
  assertContract(
    statusSource.includes('skippedNodeReasons?: ReadonlyMap<string, ModuleGraphExecutionSkipReason>')
      && sharedSource.includes("if (skippedNodeReasons?.has(nodeId))")
      && sharedSource.includes("return 'skipped'"),
    'execution status resolver should expose skipped nodes before failed-run fallback states',
  )
  assertContract(
    portCellsSource.includes('outputState?: ModuleGraphConditionalOutputState | null')
      && portCellsSource.includes("t({ ko: '활성 경로', en: 'Active path' })")
      && portCellsSource.includes("t({ ko: '비활성 경로', en: 'Inactive path' })"),
    'node output ports should show active and inactive conditional branch path labels',
  )
  assertContract(
    !syncSource.includes('orderedNodeIds.includes(node.id)'),
    'workspace sync must not scan orderedNodeIds while mapping each node',
  )
  assertContract(
    buildFlowFromGraphRecordSource.includes('const nodeById = new Map(nodes.map((node) => [node.id, node]))'),
    'saved workflow loading should build a node lookup map once before edge conversion',
  )
  assertContract(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.source_node_id)'),
    'saved workflow loading should use the node lookup for source edge ports',
  )
  assertContract(
    buildFlowFromGraphRecordSource.includes('nodeById.get(edge.target_node_id)'),
    'saved workflow loading should use the node lookup for target edge ports',
  )
  assertContract(
    !buildFlowFromGraphRecordSource.includes('nodes.find((node) => node.id === edge.'),
    'saved workflow loading must not scan graph nodes for every edge',
  )
  assertContract(
    workflowRunnerSource.includes('const runReadinessMessage = !selectedGraph'),
    'workflow runner should compute one actionable run-readiness message before execution',
  )
  assertContract(
    workflowRunnerSource.includes('const firstBlockingIssue = validationIssues.find((issue) => issue.severity === \'error\') ?? null'),
    'workflow runner should surface the first blocking validation issue near the run action',
  )
  assertContract(
    workflowRunnerSource.includes('Action needed before running'),
    'workflow runner should render an explicit action-needed state when validation blocks execution',
  )
  assertContract(
    workflowRunnerSource.includes('const shouldShowRunReadinessAlert = isExecuting || !canExecute || warningIssueCount > 0'),
    'workflow runner should only show readiness alerts when action, warning, or execution feedback is needed',
  )
  assertContract(
    !/필수 실행 조건이 충족|Required run conditions are satisfied|<span>\{canExecute \? t\(\{ ko: '실행 준비'/.test(workflowRunnerSource),
    'workflow runner must not show repeated success readiness copy',
  )

  const workflowValidationPanelSource = source('features/module-graph/components/workflow-validation-panel.tsx')
  const workflowEditorViewSource = source('features/module-graph/components/module-workflow-editor-view.tsx')
  assertContract(
    workflowValidationPanelSource.includes('if (issues.length === 0 && !showHeader)'),
    'workflow validation panel should render nothing for empty inline validation state',
  )
  assertContract(
    !/지금 바로 실행 가능|Ready to run now|필수 입력 확인 완료|Required inputs confirmed/.test(workflowValidationPanelSource),
    'workflow validation panel must not show repeated success readiness copy',
  )
  assertContract(
    workflowEditorViewSource.includes('if (validationIssues.length > 0)')
      && workflowEditorViewSource.includes('open={isValidationPopupOpen && validationIssues.length > 0}'),
    'workflow editor validation popup should open only when there are validation issues',
  )
  assertContract(
    !/지금 상태 좋아|Everything looks good|막히는 이슈는 없어|There are no blocking issues/.test(workflowEditorViewSource),
    'workflow editor validation popup must not show repeated success readiness copy',
  )
}

assertExecutionStatusLookupPolicy()

reportVerificationSuccess('Module graph execution status contracts verified.')
