import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import type { AxiosInstance } from 'axios'

test('ComfyUI transfer streams output and removes incomplete files', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-comfy-transfer-'))
  process.env.RUNTIME_BASE_PATH = root
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const { downloadComfyOutputFile } = await import('../src/services/comfyui/fileTransfer')
  const bytes = Buffer.from('output bytes')
  const axios = {
    get: async (_url: string, options: { responseType: string }) => {
      assert.equal(options.responseType, 'stream')
      return { data: Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]) }
    },
  } as unknown as AxiosInstance
  const file = await downloadComfyOutputFile(axios, 'video.mp4')
  assert.deepEqual(await fs.promises.readFile(file), bytes)
  await fs.promises.unlink(file)

  const controller = new AbortController()
  const aborted = {
    get: async () => ({
      data: Readable.from((async function* () {
        yield bytes
        controller.abort()
        yield bytes
      })()),
    }),
  } as unknown as AxiosInstance
  await assert.rejects(downloadComfyOutputFile(aborted, 'video.mp4', '', 'output', controller.signal))
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [])

  const broken = {
    get: async () => ({
      data: Readable.from((async function* () {
        yield bytes
        throw new Error('broken stream')
      })()),
    }),
  } as unknown as AxiosInstance
  await assert.rejects(downloadComfyOutputFile(broken, 'video.mp4'), /broken stream/)
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [])
  const errorStream = new Readable({ read() {} })
  const errorResponse = Object.assign(new Error('HTTP failure'), { isAxiosError: true, response: { data: errorStream } })
  const failedResponse = { get: async () => { throw errorResponse } } as unknown as AxiosInstance
  await assert.rejects(downloadComfyOutputFile(failedResponse, 'video.mp4'), /HTTP failure/)
  assert.equal(errorStream.destroyed, true, 'unread error streams release their sockets')

  const { ComfyUIService, COMFYUI_EXECUTION_CANCELLED_MESSAGE } = await import('../src/services/comfyuiService')
  let mode: 'broken' | 'held' = 'broken'
  let secondStarted!: () => void
  let modalResponse: unknown
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      req.resume()
      req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(modalResponse)) })
      return
    }
    const filename = new URL(req.url ?? '/', 'http://stub').searchParams.get('filename')
    if (filename === 'first.png') { res.end(bytes); return }
    res.writeHead(200)
    res.write('partial')
    if (mode === 'broken') res.destroy()
    else secondStarted()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const service = new ComfyUIService(endpoint)
  t.mock.method(service, 'waitForCompletion', async () => ({
    prompt: { status: { completed: true }, outputs: { '1': { images: [
      { filename: 'first.png', subfolder: '', type: 'output' },
      { filename: 'second.png', subfolder: '', type: 'output' },
    ] } } },
  }) as any)
  await assert.rejects(service.collectGeneratedOutputs('prompt', { onlyFinalOutput: false }))
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [], 'a later failure removes earlier downloads')

  mode = 'held'
  const started = new Promise<void>(resolve => { secondStarted = resolve })
  const cancel = new AbortController()
  let notices = 0
  const collection = service.collectGeneratedOutputs('prompt', { onlyFinalOutput: false, signal: cancel.signal, onCancelRequested: () => { notices++ } })
  await started
  cancel.abort()
  await assert.rejects(collection, { message: COMFYUI_EXECUTION_CANCELLED_MESSAGE })
  assert.equal(notices, 1)
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [], 'abort removes completed and partial downloads')

  await t.test('cleanup failures preserve the collection error and cancellation', async t => {
    const retained = path.join(root, 'temp', 'retained.png')
    await fs.promises.writeFile(retained, bytes)
    const originalRm = fs.promises.rm
    t.mock.method(fs.promises, 'rm', async (target, options) => {
      if (String(target) === retained) throw new Error('cleanup denied')
      return originalRm(target, options)
    })
    const controller = new AbortController()
    let cancel = true
    let downloadFailure = new Error('download failed')
    t.mock.method(service, 'downloadOutputFile', async (filename) => {
      if (filename === 'first.png') return retained
      if (cancel) controller.abort()
      throw downloadFailure
    })
    const error = await service.collectGeneratedOutputs('prompt', { onlyFinalOutput: false, signal: controller.signal })
      .then(() => null, failure => failure as Error & { cleanupFailures?: unknown[] })
    assert.equal(error?.message, COMFYUI_EXECUTION_CANCELLED_MESSAGE)
    assert.equal(error?.cleanupFailures?.length, 1)
    cancel = false
    downloadFailure = new Error('download failed')
    const original = await service.collectGeneratedOutputs('prompt', { onlyFinalOutput: false })
      .then(() => null, failure => failure as Error & { cleanupFailures?: unknown[] })
    assert.equal(original, downloadFailure, 'a cleanup failure never replaces the original collection error')
    assert.equal(original?.cleanupFailures?.length, 1)
  })
  await fs.promises.rm(path.join(root, 'temp', 'retained.png'), { force: true })

  const modal = new ComfyUIService(endpoint, { backendType: 'modal' })
  const longData = Buffer.alloc(100_003, 0xfb).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  const encoded = `${longData.slice(0, 65535)} \n!${longData.slice(65535)}`
  modalResponse = { images: [{ filename: 'first.png', data_base64: bytes.toString('base64') }], videos: [{ filename: 'last.mp4', data_base64: encoded }] }
  const outputs = await modal.runModalWorkflowAndCollectOutputs({}, 'modal')
  assert.equal(outputs.length, 1)
  assert.deepEqual(await fs.promises.readFile(outputs[0].tempPath), Buffer.from(encoded, 'base64'))
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [path.basename(outputs[0].tempPath)], 'unreturned Modal outputs are removed')
  await fs.promises.unlink(outputs[0].tempPath)
  const retainedModalPaths: string[] = []
  await t.test('discard cleanup failure does not fail a successful Modal result', async t => {
    const originalRm = fs.promises.rm
    t.mock.method(fs.promises, 'rm', async (target, options) => {
      if (String(target).includes('modal_comfyui_')) {
        retainedModalPaths.push(String(target))
        throw new Error('cleanup denied')
      }
      return originalRm(target, options)
    })
    const result = await modal.runModalWorkflowAndCollectOutputs({}, 'modal')
    retainedModalPaths.push(result[0].tempPath)
    assert.equal(result.length, 1)
    assert.deepEqual(await fs.promises.readFile(result[0].tempPath), Buffer.from(encoded, 'base64'))
  })
  for (const tempPath of retainedModalPaths) await fs.promises.rm(tempPath, { force: true })
  modalResponse = { images: [{ filename: 'first.png', data_base64: bytes.toString('base64') }, { filename: 'bad.png' }] }
  await assert.rejects(modal.runModalWorkflowAndCollectOutputs({}, 'modal'), /did not include data_base64/)
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [], 'a malformed later Modal output removes earlier files')

  const { writeModalOutputToTemp } = await import('../src/services/comfyui/outputCollector')
  const modalCancel = new AbortController()
  const write = writeModalOutputToTemp({ data_base64: 'A'.repeat(4 * 1024 * 1024) }, 'cancel.mp4', 'video', modalCancel.signal)
  setImmediate(() => modalCancel.abort())
  await assert.rejects(write, { name: 'AbortError' })
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'temp')), [], 'cancelled Modal writes remove their partial file')
  const failedModalPaths: string[] = []
  await t.test('Modal write cleanup failure keeps the original abort', async t => {
    const originalRm = fs.promises.rm
    t.mock.method(fs.promises, 'rm', async (target, options) => {
      if (String(target).includes('modal_comfyui_')) {
        failedModalPaths.push(String(target))
        throw new Error('cleanup denied')
      }
      return originalRm(target, options)
    })
    const controller = new AbortController()
    const result = writeModalOutputToTemp({ data_base64: 'A'.repeat(4 * 1024 * 1024) }, 'cancel.mp4', 'video', controller.signal)
    setImmediate(() => controller.abort())
    const error = await result.then(() => null, failure => failure as Error & { cleanupError?: unknown })
    assert.equal(error?.name, 'AbortError')
    assert.ok(error?.cleanupError)
  })
  for (const tempPath of failedModalPaths) await fs.promises.rm(tempPath, { force: true })
})
