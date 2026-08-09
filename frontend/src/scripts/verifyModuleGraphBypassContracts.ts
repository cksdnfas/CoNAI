import verifyHelpers from '../../../scripts/verify-helpers'

const { assertContract, createSourceReader, reportVerificationSuccess } = verifyHelpers

const source = createSourceReader(new URL('../', import.meta.url))

function verifySavedGraphDisabledFlagContract() {
  const apiSource = source('lib/api-module-graph.ts')
  const apiTypeSource = source('lib/api-module-graph-types.ts')
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const validationSource = source('features/module-graph/module-graph-validation.ts')
  const viewModelSource = source('features/module-graph/use-module-graph-page-view-model.ts')
  const interactionsSource = source('features/module-graph/use-module-graph-editor-interactions.ts')

  assertContract(apiSource.includes('GraphWorkflowNode'), 'graph workflow API module should re-export the workflow node type')
  assertContract(apiTypeSource.includes('disabled?: boolean'), 'graph workflow node API type should expose disabled flag')
  assertContract(sharedSource.includes('disabled: node.data.disabled === true ? true : undefined'), 'graph payload should persist disabled nodes')
  assertContract(sharedSource.includes('if (node.disabled === true)'), 'saved graph loading should restore disabled node state')
  assertContract(sharedSource.includes("(node.disabled === undefined || typeof node.disabled === 'boolean')"), 'clipboard parser should accept only boolean disabled node state')
  assertContract(interactionsSource.includes('disabled: nodeToDuplicate.data.disabled === true ? true : undefined'), 'node duplication should preserve disabled node state')
  assertContract(interactionsSource.includes('disabled: copiedNode.disabled === true ? true : undefined'), 'clipboard paste should preserve disabled node state')
  assertContract(validationSource.includes('const activeNodes = nodes.filter((node) => node.disabled !== true)'), 'workflow validation should ignore disabled nodes')
  assertContract(viewModelSource.includes('disabled: node.data.disabled === true'), 'editor validation should pass disabled node state')
  assertContract(viewModelSource.includes('disabled: node.disabled === true'), 'saved-workflow validation should pass disabled node state')
}

function verifyCanvasBypassActionContract() {
  const actionMenuSource = source('features/module-graph/components/module-graph-action-menu.tsx')
  const canvasSource = source('features/module-graph/components/module-graph-canvas.tsx')
  const nodeCardSource = source('features/module-graph/components/module-graph-node-card.tsx')
  const interactionsSource = source('features/module-graph/use-module-graph-editor-interactions.ts')
  const pageActionsSource = source('features/module-graph/use-module-graph-page-actions.ts')
  const pagePanelsSource = source('features/module-graph/use-module-graph-page-editor-panels.tsx')

  assertContract(actionMenuSource.includes('PowerOff'), 'node quick menu should expose a disable/enable icon action')
  assertContract(actionMenuSource.includes("aria-label={state.disabled"), 'node quick menu disable action should expose state-aware labels')
  assertContract(canvasSource.includes('disabled: node.data.disabled === true'), 'node action menu should receive disabled state')
  assertContract(canvasSource.includes('onToggleNodeDisabled(actionMenuState.nodeId)'), 'node action menu should invoke disabled toggle handler')
  assertContract(interactionsSource.includes('const handleToggleNodeDisabled = useCallback'), 'editor interactions should own disabled toggle state')
  assertContract(pageActionsSource.includes('handleToggleNodeDisabled'), 'page actions should return disabled toggle handler')
  assertContract(pagePanelsSource.includes('onToggleNodeDisabled={onToggleNodeDisabled}'), 'page panels should wire disabled toggle into canvas')
  assertContract(nodeCardSource.includes("t({ ko: '비활성', en: 'Disabled' })"), 'node card should show disabled status badge')
  assertContract(nodeCardSource.includes("data.disabled === true ? 'opacity-60 grayscale'"), 'node card should visually dim disabled nodes')
}

function verifyEditorInteractionLookupContract() {
  const interactionsSource = source('features/module-graph/use-module-graph-editor-interactions.ts')

  assertContract(interactionsSource.includes('const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])'), 'editor interactions should build one node-id map per node snapshot')
  assertContract(interactionsSource.includes('nodeById.get(connection.source)'), 'connection validation should use the node-id map')
  assertContract(interactionsSource.includes('nodeById.get(connectionStart.nodeId)'), 'drag-connect node creation should use the node-id map')
  assertContract(interactionsSource.includes('nodeById.get(nodeId)'), 'node duplication should use the node-id map')
  assertContract(!interactionsSource.includes('nodes.find((node) => node.id ==='), 'editor interactions should avoid repeated node array scans by id')
}

verifySavedGraphDisabledFlagContract()
verifyCanvasBypassActionContract()
verifyEditorInteractionLookupContract()

reportVerificationSuccess('Module graph bypass UI contracts verified.')
