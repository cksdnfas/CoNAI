import type { ComfyUIServer } from '../../../lib/api-image-generation-types'
import type { ComfyUIServerTestState } from '../image-generation-shared'

export type ComfyWorkflowServerRoutingSummary = {
  autoRoutableCount: number
  routingTags: string[]
  tagRoutableCounts: ReadonlyMap<string, number>
  serverById: ReadonlyMap<number, ComfyUIServer>
}

export function isComfyWorkflowModalServer(server: ComfyUIServer, testState?: ComfyUIServerTestState) {
  return server.backend_type === 'modal' || testState?.status?.backend_type === 'modal'
}

export function isComfyWorkflowServerConnected(testState?: ComfyUIServerTestState) {
  return testState?.status?.is_connected === true
}

export function isComfyWorkflowServerRoutable(server: ComfyUIServer, testState?: ComfyUIServerTestState) {
  return isComfyWorkflowModalServer(server, testState) || isComfyWorkflowServerConnected(testState)
}

export function buildComfyWorkflowServerRoutingSummary(
  servers: ComfyUIServer[],
  serverTests: Record<number, ComfyUIServerTestState>,
): ComfyWorkflowServerRoutingSummary {
  const routingTagSet = new Set<string>()
  const tagRoutableCounts = new Map<string, number>()
  const serverById = new Map<number, ComfyUIServer>()
  let autoRoutableCount = 0

  for (const server of servers) {
    serverById.set(server.id, server)
    const testState = serverTests[server.id]
    const isModal = isComfyWorkflowModalServer(server, testState)
    const isConnected = isComfyWorkflowServerConnected(testState)

    if (isConnected && !isModal) {
      autoRoutableCount += 1
    }

    const isRoutable = isModal || isConnected
    for (const tag of server.routing_tags ?? []) {
      routingTagSet.add(tag)
      if (isRoutable) {
        tagRoutableCounts.set(tag, (tagRoutableCounts.get(tag) ?? 0) + 1)
      }
    }
  }

  return {
    autoRoutableCount,
    routingTags: Array.from(routingTagSet).sort((left, right) => left.localeCompare(right)),
    tagRoutableCounts,
    serverById,
  }
}
