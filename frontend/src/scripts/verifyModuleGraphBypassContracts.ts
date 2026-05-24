import { readFileSync } from 'node:fs'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function verifySavedGraphDisabledFlagContract() {
  const apiSource = source('lib/api-module-graph.ts')
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const validationSource = source('features/module-graph/module-graph-validation.ts')
  const viewModelSource = source('features/module-graph/use-module-graph-page-view-model.ts')
  const interactionsSource = source('features/module-graph/use-module-graph-editor-interactions.ts')

  assert(apiSource.includes('disabled?: boolean'), 'graph workflow node API type should expose disabled flag')
  assert(sharedSource.includes('disabled: node.data.disabled === true ? true : undefined'), 'graph payload should persist disabled nodes')
  assert(sharedSource.includes('if (node.disabled === true)'), 'saved graph loading should restore disabled node state')
  assert(sharedSource.includes("(node.disabled === undefined || typeof node.disabled === 'boolean')"), 'clipboard parser should accept only boolean disabled node state')
  assert(interactionsSource.includes('disabled: nodeToDuplicate.data.disabled === true ? true : undefined'), 'node duplication should preserve disabled node state')
  assert(interactionsSource.includes('disabled: copiedNode.disabled === true ? true : undefined'), 'clipboard paste should preserve disabled node state')
  assert(validationSource.includes('const activeNodes = nodes.filter((node) => node.disabled !== true)'), 'workflow validation should ignore disabled nodes')
  assert(viewModelSource.includes('disabled: node.data.disabled === true'), 'editor validation should pass disabled node state')
  assert(viewModelSource.includes('disabled: node.disabled === true'), 'saved-workflow validation should pass disabled node state')
}

function verifyCanvasBypassActionContract() {
  const actionMenuSource = source('features/module-graph/components/module-graph-action-menu.tsx')
  const canvasSource = source('features/module-graph/components/module-graph-canvas.tsx')
  const nodeCardSource = source('features/module-graph/components/module-graph-node-card.tsx')
  const interactionsSource = source('features/module-graph/use-module-graph-editor-interactions.ts')
  const pageActionsSource = source('features/module-graph/use-module-graph-page-actions.ts')
  const pagePanelsSource = source('features/module-graph/use-module-graph-page-editor-panels.tsx')

  assert(actionMenuSource.includes('PowerOff'), 'node quick menu should expose a disable/enable icon action')
  assert(actionMenuSource.includes("aria-label={state.disabled"), 'node quick menu disable action should expose state-aware labels')
  assert(canvasSource.includes('disabled: node.data.disabled === true'), 'node action menu should receive disabled state')
  assert(canvasSource.includes('onToggleNodeDisabled(actionMenuState.nodeId)'), 'node action menu should invoke disabled toggle handler')
  assert(interactionsSource.includes('const handleToggleNodeDisabled = useCallback'), 'editor interactions should own disabled toggle state')
  assert(pageActionsSource.includes('handleToggleNodeDisabled'), 'page actions should return disabled toggle handler')
  assert(pagePanelsSource.includes('onToggleNodeDisabled={onToggleNodeDisabled}'), 'page panels should wire disabled toggle into canvas')
  assert(nodeCardSource.includes("t({ ko: '비활성', en: 'Disabled' })"), 'node card should show disabled status badge')
  assert(nodeCardSource.includes("data.disabled === true ? 'opacity-60 grayscale'"), 'node card should visually dim disabled nodes')
}

verifySavedGraphDisabledFlagContract()
verifyCanvasBypassActionContract()

console.log('Module graph bypass UI contracts verified.')
