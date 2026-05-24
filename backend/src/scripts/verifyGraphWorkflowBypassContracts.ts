import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function source(path: string) {
  return readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
}

function verifyGraphWorkflowDisabledNodeContract() {
  const typeSource = source('types/moduleGraph.ts')
  const executorSource = source('services/graphWorkflowExecutor.ts')

  assert(typeSource.includes('disabled?: boolean'), 'backend graph workflow node type should expose disabled flag')
  assert(executorSource.includes('function markNodeOutputsSkipped'), 'executor should share skipped-output marking for branch and disabled skips')
  assert(executorSource.includes('if (node.disabled === true)'), 'executor should skip disabled nodes before input resolution and engine execution')
  assert(executorSource.includes("eventType: 'node_skipped_disabled'"), 'executor should write a disabled-node skip log event')
  assert(executorSource.includes('disabledOutputKeys: moduleDefinition.output_ports.map((port) => port.key)'), 'executor should disable all outputs on skipped disabled nodes')
  assert(executorSource.indexOf('if (node.disabled === true)') < executorSource.indexOf('const incomingArtifacts = await getIncomingArtifacts'), 'disabled nodes must skip before artifact/input resolution')
  assert(executorSource.indexOf('if (node.disabled === true)') < executorSource.indexOf('validateRequiredInputs(node, moduleDefinition, resolvedInputs)'), 'disabled nodes must skip before required-input validation')
}

verifyGraphWorkflowDisabledNodeContract()

console.log('Graph workflow bypass execution contracts verified.')
