import { deepEqual, equal, ok } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { ComfyUIServer } from '../lib/api-image-generation-types'
import type { ComfyUIServerTestState } from '../features/image-generation/image-generation-shared'
import {
  buildComfyWorkflowServerRoutingSummary,
  isComfyWorkflowModalServer,
  isComfyWorkflowServerRoutable,
} from '../features/image-generation/components/comfy-workflow-routing'

function makeServer(overrides: Partial<ComfyUIServer>): ComfyUIServer {
  return {
    id: 1,
    name: 'Server',
    endpoint: 'http://127.0.0.1:8188',
    backend_type: 'comfyui',
    capacity: 1,
    routing_tags: [],
    is_active: true,
    is_default: false,
    ...overrides,
  }
}

function makeTestState(overrides: Partial<NonNullable<ComfyUIServerTestState['status']>>): ComfyUIServerTestState {
  return {
    isLoading: false,
    status: {
      server_id: 1,
      server_name: 'Server',
      endpoint: 'http://127.0.0.1:8188',
      is_connected: false,
      ...overrides,
    },
  }
}

function assertRoutingSummary() {
  const connectedRender = makeServer({ id: 1, name: 'Connected render', routing_tags: ['render', 'fast'] })
  const disconnectedRender = makeServer({ id: 2, name: 'Disconnected render', routing_tags: ['render'] })
  const modalRender = makeServer({ id: 3, name: 'Modal render', backend_type: 'modal', routing_tags: ['modal', 'render'] })
  const statusModalRender = makeServer({ id: 4, name: 'Status modal render', routing_tags: ['burst', 'render'] })
  const statusModalConnected = makeServer({ id: 5, name: 'Status modal connected', routing_tags: ['modal'] })

  const servers = [connectedRender, disconnectedRender, modalRender, statusModalRender, statusModalConnected]
  const serverTests: Record<number, ComfyUIServerTestState> = {
    1: makeTestState({ server_id: 1, server_name: 'Connected render', is_connected: true }),
    2: makeTestState({ server_id: 2, server_name: 'Disconnected render', is_connected: false }),
    3: makeTestState({ server_id: 3, server_name: 'Modal render', is_connected: false }),
    4: makeTestState({ server_id: 4, server_name: 'Status modal render', backend_type: 'modal', is_connected: false }),
    5: makeTestState({ server_id: 5, server_name: 'Status modal connected', backend_type: 'modal', is_connected: true }),
  }

  const summary = buildComfyWorkflowServerRoutingSummary(servers, serverTests)

  deepEqual(summary.routingTags, ['burst', 'fast', 'modal', 'render'], 'routing tags should be unique and sorted once')
  equal(summary.autoRoutableCount, 1, 'auto routing should count only connected non-Modal servers')
  equal(summary.tagRoutableCounts.get('render'), 3, 'tag routing should count connected and Modal-capable servers once per server')
  equal(summary.tagRoutableCounts.get('fast'), 1, 'connected tagged server should be counted as tag-routable')
  equal(summary.tagRoutableCounts.get('modal'), 2, 'backend Modal and status Modal servers should be tag-routable')
  equal(summary.tagRoutableCounts.get('missing') ?? 0, 0, 'missing tag counts should fall back to zero')
  equal(summary.serverById.get(3), modalRender, 'server lookup map should preserve server records by id')
  equal(isComfyWorkflowServerRoutable(disconnectedRender, serverTests[2]), false, 'disconnected non-Modal servers should not be routable')
  equal(isComfyWorkflowServerRoutable(modalRender, serverTests[3]), true, 'backend Modal servers should be routable without a live connection')
  equal(isComfyWorkflowServerRoutable(statusModalRender, serverTests[4]), true, 'status Modal servers should be routable without a live connection')
  equal(isComfyWorkflowModalServer(statusModalConnected, serverTests[5]), true, 'status Modal should override the configured backend type')
}

function assertControllerUsesIndexedRoutingSummary() {
  const controllerSource = readFileSync(new URL('../features/image-generation/components/comfy-workflow-controller-panel.tsx', import.meta.url), 'utf8')

  ok(
    controllerSource.includes('buildComfyWorkflowServerRoutingSummary(servers, serverTests)'),
    'controller should build the server routing summary once per server/test update',
  )
  ok(
    controllerSource.includes('routingSummary.tagRoutableCounts.get(tag) ?? 0'),
    'target options should reuse tag routable counts from the routing summary',
  )
  ok(
    controllerSource.includes('routingSummary.serverById.get(Number(selectedTarget.slice'),
    'selected server lookup should use the precomputed server map',
  )
  equal(
    controllerSource.indexOf('servers.filter((server) => (server.routing_tags ?? []).includes(tag)'),
    -1,
    'target option rendering must not rescan all servers for every routing tag',
  )
}

assertRoutingSummary()
assertControllerUsesIndexedRoutingSummary()

console.log('Comfy workflow routing contracts verified.')
