import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { ComfyUIServerModel } from '../src/models/ComfyUIServer'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { WorkflowModel } from '../src/models/Workflow'
import { attemptQueueUpstreamCancellation } from '../src/services/generation-queue/queueUpstreamCancellation'
import { compensateComfySubmit } from '../src/services/generation-queue/queueOrphanReconciler'
import type { ComfyUIServerRecord } from '../src/types/comfyuiServer'
import type { GenerationQueueJobListRecord } from '../src/types/generationQueue'
import type { WorkflowRecord } from '../src/types/workflow'

test('ordinary and compensating cancellation preserve endpoint priority and safe fallbacks', { timeout: 60000 }, async (t) => {
  const requests: Array<{ server: string; method: string | undefined; url: string | undefined; body: unknown }> = []
  const endpoints: Record<string, string> = {}
  for (const name of ['provided', 'assigned', 'workflow']) {
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        requests.push({ server: name, method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET' && req.url === '/queue') {
          res.end(JSON.stringify({
            queue_pending: [[1, 'owned-prompt', {}, {}, []]],
            queue_running: [[2, 'foreign-prompt', {}, {}, []]],
          }))
        } else if (req.method === 'POST' && req.url === '/queue') {
          res.end('{}')
        } else {
          res.statusCode = 404
          res.end('{"error":"unexpected cancellation request"}')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
    endpoints[name] = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }

  const serverRecord = (endpoint: string, id = 17): ComfyUIServerRecord => ({
    id, endpoint, name: 'routing fixture', backend_type: 'comfyui', capacity: 1,
    is_active: true, is_default: false, created_date: '2026-01-01', updated_date: '2026-01-01',
  })
  const baseJob = {
    id: 7, service_type: 'comfyui', assigned_server_id: 17, workflow_id: 31, provider_job_id: 'owned-prompt',
  } as GenerationQueueJobListRecord
  let job = baseJob
  let storedServer: ComfyUIServerRecord | null = null
  let storedWorkflow: WorkflowRecord | null = null
  const submitStates: Array<{ state: string; patch: unknown }> = []
  const cancelStates: string[] = []
  t.mock.method(GenerationQueueModel, 'findListRecordById', (id: number) => id === 7 ? job : null)
  t.mock.method(ComfyUIServerModel, 'findById', (id: number) => id === 17 ? storedServer : null)
  t.mock.method(WorkflowModel, 'findById', (id: number) => id === 31 ? storedWorkflow : null)
  t.mock.method(GenerationQueueModel, 'markProviderSubmitState', (_id: number, state: string, patch: unknown) => {
    submitStates.push({ state, patch })
  })
  t.mock.method(GenerationQueueModel, 'markProviderCancelState', (_id: number, state: string) => {
    cancelStates.push(state)
  })
  t.mock.method(GenerationQueueModel, 'updateDebugMeta', () => {})

  const scenarios: Array<{
    name: string
    provided?: ComfyUIServerRecord
    stored: ComfyUIServerRecord | null
    workflow: boolean
    target: string | null
  }> = [
    { name: 'provided endpoint wins over stored server and workflow', provided: serverRecord(endpoints.provided, 99), stored: serverRecord(endpoints.assigned), workflow: true, target: 'provided' },
    { name: 'stored assigned server wins over workflow', stored: serverRecord(endpoints.assigned), workflow: true, target: 'assigned' },
    { name: 'a provided server without an endpoint still falls back to its stored assignment', provided: serverRecord('', 99), stored: serverRecord(endpoints.assigned), workflow: true, target: 'assigned' },
    { name: 'a missing assigned server falls back to the workflow', stored: null, workflow: true, target: 'workflow' },
    { name: 'missing endpoints never send a request', stored: null, workflow: false, target: null },
  ]

  for (const mode of ['ordinary', 'compensating'] as const) {
    for (const scenario of scenarios) {
      await t.test(`${mode}: ${scenario.name}`, async () => {
        job = baseJob
        storedServer = scenario.stored
        storedWorkflow = scenario.workflow ? { id: 31, api_endpoint: endpoints.workflow } as WorkflowRecord : null
        requests.length = 0
        submitStates.length = 0
        cancelStates.length = 0

        if (mode === 'ordinary') {
          const result = await attemptQueueUpstreamCancellation(7, { assignedServer: scenario.provided })
          assert.equal(result?.deleted ?? false, scenario.target !== null)
        } else {
          const result = await compensateComfySubmit(7, { assignedServer: scenario.provided, attempts: 1 })
          assert.equal(result, scenario.target === null ? 'orphan_unresolved' : 'cancel_confirmed')
        }

        if (scenario.target === null) {
          assert.deepEqual(requests, [])
          assert.deepEqual(submitStates, mode === 'ordinary' ? [] : [{ state: 'orphan_unresolved', patch: { providerCancelState: 'missing_endpoint' } }])
          assert.deepEqual(cancelStates, mode === 'ordinary' ? ['missing_endpoint'] : [])
        } else {
          assert.deepEqual(requests, [
            { server: scenario.target, method: 'GET', url: '/queue', body: null },
            { server: scenario.target, method: 'POST', url: '/queue', body: { delete: ['owned-prompt'] } },
          ], 'only the selected server may remove the owned prompt; the foreign running prompt is never interrupted')
          assert.deepEqual(submitStates, [{
            state: 'cancel_confirmed',
            patch: { providerCancelState: mode === 'ordinary' ? 'requested' : 'deleted', providerJobId: 'owned-prompt' },
          }])
          assert.deepEqual(cancelStates, [])
        }
      })
    }
    await t.test(`${mode}: non-ComfyUI jobs never contact any server`, async () => {
      job = { ...baseJob, service_type: 'novelai' }
      requests.length = 0
      submitStates.length = 0
      cancelStates.length = 0
      const result = mode === 'ordinary'
        ? await attemptQueueUpstreamCancellation(7, { assignedServer: serverRecord(endpoints.provided) })
        : await compensateComfySubmit(7, { assignedServer: serverRecord(endpoints.provided), attempts: 1 })
      assert.equal(result, mode === 'ordinary' ? null : 'not_found')
      assert.deepEqual(requests, [])
      assert.deepEqual(submitStates, [])
      assert.deepEqual(cancelStates, [])
    })
  }
})
