import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('ComfyUI collected outputs are cleaned or handed off across cancellation and failures', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-executor-'))
  process.env.RUNTIME_BASE_PATH = root
  await fs.promises.mkdir(path.join(root, 'database'), { recursive: true })
  const { executeComfyGeneration } = await import('../src/services/comfyGenerationExecutor')
  const { COMFYUI_EXECUTION_CANCELLED_MESSAGE } = await import('../src/services/comfyuiService')
  t.after(async () => {
    ;(await import('../src/database/init')).closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>(resolve => logger.close(resolve))
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  let sequence = 0
  const makeOutput = async () => {
    const tempPath = path.join(root, `output-${sequence++}.mp4`)
    await fs.promises.writeFile(tempPath, 'video contents')
    return { tempPath, filename: 'video.mp4', subfolder: '', type: 'output', nodeId: '1', kind: 'video' as const }
  }
  const service = (output: Awaited<ReturnType<typeof makeOutput>>, onCollect?: () => void) => ({
    isModalBackend: () => false,
    submitPrompt: async () => 'prompt',
    collectGeneratedOutputs: async () => { onCollect?.(); return [output] },
  }) as any
  const gone = async (tempPath: string) => assert.equal(await fs.promises.access(tempPath).then(() => true, () => false), false)

  for (const sink of [false, true]) {
    const output = await makeOutput()
    let collected = false
    let sinkCalled = false
    await assert.rejects(executeComfyGeneration({
      comfyService: service(output, () => { collected = true }), workflow: {},
      shouldCancel: () => collected,
      ...(sink ? { outputSink: async () => { sinkCalled = true } } : {}),
    }), { message: COMFYUI_EXECUTION_CANCELLED_MESSAGE })
    assert.equal(sinkCalled, false)
    await gone(output.tempPath)
  }

  const abortedOutput = await makeOutput()
  const controller = new AbortController()
  await assert.rejects(executeComfyGeneration({
    comfyService: service(abortedOutput, () => controller.abort()), workflow: {}, signal: controller.signal,
  }), { message: COMFYUI_EXECUTION_CANCELLED_MESSAGE })
  await gone(abortedOutput.tempPath)

  const failedCheckOutput = await makeOutput()
  let collected = false
  await assert.rejects(executeComfyGeneration({
    comfyService: service(failedCheckOutput, () => { collected = true }), workflow: {},
    shouldCancel: () => { if (collected) throw new Error('cancel state failed'); return false },
  }), /cancel state failed/)
  await gone(failedCheckOutput.tempPath)

  const monitorOutput = await makeOutput()
  const monitored = {
    ...service(monitorOutput),
    createProgressMonitor: () => ({ start: async () => undefined, setPromptId: () => undefined, close: () => { throw new Error('monitor close failed') } }),
  } as any
  const monitoredResult = await executeComfyGeneration({
    comfyService: monitored, workflow: {}, queueJobId: 1, onProgress: () => undefined,
    outputSink: async outputs => fs.promises.readFile(outputs[0].tempPath, 'utf8'),
  })
  assert.equal(monitoredResult.sinkResult, 'video contents')
  await gone(monitorOutput.tempPath)

  const sinkOutput = await makeOutput()
  const sinkResult = await executeComfyGeneration({
    comfyService: service(sinkOutput), workflow: {},
    outputSink: async outputs => fs.promises.readFile(outputs[0].tempPath, 'utf8'),
  })
  assert.equal(sinkResult.sinkResult, 'video contents')
  await gone(sinkOutput.tempPath)

  const artifactOutput = await makeOutput()
  const artifactRoot = path.join(root, 'artifacts')
  const artifactWorkflow = { id: 1, name: 'fixture', result_view_mode: 'artifact_explorer', artifact_directory_mode: 'shared', artifact_root_path: artifactRoot } as any
  const result = await executeComfyGeneration({ comfyService: service(artifactOutput), workflow: {}, artifactWorkflow })
  assert.equal(result.savedArtifactCount, 1)
  assert.equal(await fs.promises.readFile(result.savedArtifacts[0].absolutePath, 'utf8'), 'video contents')
  await gone(artifactOutput.tempPath)

  const failedArtifact = await makeOutput()
  const blockedRoot = path.join(root, 'not-a-directory')
  await fs.promises.writeFile(blockedRoot, 'keep')
  const failed = await executeComfyGeneration({
    comfyService: service(failedArtifact), workflow: {}, artifactWorkflow: { ...artifactWorkflow, artifact_root_path: blockedRoot },
  })
  assert.equal(failed.savedArtifactCount, 0)
  assert.equal(await fs.promises.readFile(blockedRoot, 'utf8'), 'keep')
  await gone(failedArtifact.tempPath)

  await t.test('cleanup failure preserves successful outputs and cancellation', async t => {
    const first = await makeOutput()
    const second = await makeOutput()
    const originalRm = fs.promises.rm
    t.mock.method(fs.promises, 'rm', async (target, options) => {
      if (String(target) === first.tempPath) throw new Error('cleanup denied')
      return originalRm(target, options)
    })
    const { APIImageProcessor } = await import('../src/services/APIImageProcessor')
    t.mock.method(APIImageProcessor, 'processGeneratedFile', async (tempPath) => ({
      originalPath: String(tempPath), fileSize: 1, compositeHash: String(tempPath),
    }) as any)
    let saved = 0
    const multiple = { ...service(first), collectGeneratedOutputs: async () => [first, second] }
    const result = await executeComfyGeneration({ comfyService: multiple, workflow: {}, onImageSaved: () => { saved++ } })
    assert.equal(result.savedImageCount, 2)
    assert.equal(saved, 2, 'a cleanup failure does not stop the next durable output')
    await gone(second.tempPath)
    const controller = new AbortController()
    const cancelled = await executeComfyGeneration({
      comfyService: service(first, () => controller.abort()), workflow: {}, signal: controller.signal,
    }).then(() => null, error => error as Error & { cleanupFailures?: unknown[] })
    assert.equal(cancelled?.message, COMFYUI_EXECUTION_CANCELLED_MESSAGE)
    assert.equal(cancelled?.cleanupFailures?.length, 1)
  })

  await t.test('direct graph execution passes its abort signal to output collection', async t => {
    const { ComfyUIService } = await import('../src/services/comfyuiService')
    const { executeComfyModule } = await import('../src/services/graph-workflow-executor/execute-comfy')
    const controller = new AbortController()
    t.mock.method(ComfyUIService.prototype, 'submitPrompt', async () => 'graph-prompt')
    t.mock.method(ComfyUIService.prototype, 'collectGeneratedOutputs', async (_promptId, options) => {
      assert.equal(options?.signal, controller.signal)
      controller.abort()
      throw new Error(COMFYUI_EXECUTION_CANCELLED_MESSAGE)
    })
    const context = { executionId: 1, signal: controller.signal, getAbortReason: () => ({ kind: 'user_cancel' }), artifactsByNode: new Map() } as any
    const node = { id: '1' } as any
    const module = { name: 'direct', source_workflow_id: null, template_defaults: { workflow_json: {}, marked_fields: [], api_endpoint: 'http://unused.invalid' }, output_ports: [] } as any
    await assert.rejects(executeComfyModule(context, node, module, {}), { name: 'GraphAbortError' })
  })
})
