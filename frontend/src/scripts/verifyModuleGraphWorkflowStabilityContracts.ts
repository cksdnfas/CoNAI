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
  const exportedStart = sourceText.indexOf(`export function ${functionName}`)
  const localStart = sourceText.indexOf(`function ${functionName}`)
  const start = exportedStart !== -1 ? exportedStart : localStart
  assert(start !== -1, `${functionName} function must exist`)

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

function assertModuleGraphWorkflowStabilityContracts() {
  const sharedSource = source('features/module-graph/module-graph-shared.tsx')
  const syncSource = source('features/module-graph/use-module-graph-workspace-sync.ts')
  const validationSource = source('features/module-graph/module-graph-validation.ts')
  const viewModelSource = source('features/module-graph/use-module-graph-page-view-model.ts')
  const nodeCardSource = source('features/module-graph/components/module-graph-node-card.tsx')
  const typesSource = source('features/module-graph/module-graph-types.ts')
  const buildPlannedOrderSource = extractFunction(sharedSource, 'buildPlannedNodeExecutionOrder')
  const buildNodeOrderIndexSource = extractFunction(sharedSource, 'buildNodeOrderIndex')
  const buildFlowFromGraphRecordSource = extractFunction(sharedSource, 'buildFlowFromGraphRecord')

  assert(
    buildPlannedOrderSource.includes('const nodeIds = nodes.map((node) => node.id)')
      && buildPlannedOrderSource.includes('const queue = nodeIds.filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)')
      && buildPlannedOrderSource.includes('return orderedNodeIds.length === nodes.length ? orderedNodeIds : nodeIds'),
    'planned execution order should preserve canvas node order for ties and fall back to saved order on cycles',
  )
  assert(
    buildPlannedOrderSource.includes('const knownNodeIds = new Set(nodeIds)')
      && buildPlannedOrderSource.includes('if (!knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target))'),
    'planned execution order should ignore stale edges that reference missing nodes',
  )
  assert(
    buildNodeOrderIndexSource.includes('new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]))'),
    'planned execution order consumers should reuse a stable node-order index',
  )
  assert(
    syncSource.includes('const plannedOrderedNodeIds = buildPlannedNodeExecutionOrder(currentNodes, edges)')
      && syncSource.includes('plannedExecutionOrder: (plannedOrderIndex.get(node.id) ?? -1) + 1 || null')
      && syncSource.includes(".map((node) => `${node.id}:${node.data.module.id}:${node.data.disabled === true ? 'disabled' : 'enabled'}`)"),
    'workspace sync should keep disabled nodes in the planned order signature and node-card display',
  )
  assert(
    typesSource.includes('disabled?: boolean')
      && buildFlowFromGraphRecordSource.includes('if (node.disabled === true)')
      && buildFlowFromGraphRecordSource.includes('data.disabled = true')
      && sharedSource.includes('disabled: node.data.disabled === true ? true : undefined'),
    'saved workflow compatibility should preserve disabled-node state through load and save',
  )
  assert(
    buildFlowFromGraphRecordSource.includes('const nodes = applySavedWorkflowInputMetadataToNodes(baseNodes, graph.graph.metadata?.exposed_inputs)')
      && buildFlowFromGraphRecordSource.includes('sourceHandle: buildHandleId(\'out\', edge.source_port_key)')
      && buildFlowFromGraphRecordSource.includes('targetHandle: buildHandleId(\'in\', edge.target_port_key)'),
    'saved workflow loading should preserve workflow input metadata and legacy edge handles',
  )
  assert(
    validationSource.includes('const activeNodes = nodes.filter((node) => node.disabled !== true)')
      && viewModelSource.includes('disabled: node.data.disabled === true,')
      && viewModelSource.includes('disabled: node.disabled === true,'),
    'validation should ignore disabled nodes while both editor and saved-workflow views pass disabled state',
  )
  assert(
    nodeCardSource.includes("data.disabled === true")
      && nodeCardSource.includes("t({ ko: '비활성', en: 'Disabled' })")
      && nodeCardSource.includes("t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })")
      && nodeCardSource.includes("t({ ko: '입력 {count}개 필요', en: '{count} inputs needed' }")
      && nodeCardSource.includes("t({ ko: '조건 입력', en: 'Conditional input' })")
      && nodeCardSource.includes("t({ ko: '실행 가능', en: 'Runnable' })"),
    'node cards should keep activation labels for disabled, waiting, missing-input, conditional, and runnable states',
  )
  assert(
    nodeCardSource.includes("data.executionSkipReason === 'disabled'")
      && nodeCardSource.includes("data.executionSkipReason === 'source-node-skipped'")
      && nodeCardSource.includes("data.executionSkipReason === 'source-output-disabled'")
      && nodeCardSource.includes("data.executionSkipReason === 'inactive-branch'"),
    'node cards should keep distinct skipped activation labels for disabled, upstream, output, and branch skips',
  )
  assert(
    nodeCardSource.includes('title={activationTitle}')
      && nodeCardSource.includes('현재 연결과 값 기준으로 실행 경로에 들어갈 수 있어.')
      && nodeCardSource.includes('필수 입력이 비어 있거나 연결되지 않아 실행 전 확인이 필요해.'),
    'activation labels should remain inspectable through hover titles with operator-facing readiness reasons',
  )
}

assertModuleGraphWorkflowStabilityContracts()

console.log('Module graph workflow stability contracts verified.')
