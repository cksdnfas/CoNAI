import './support/testTemp'
// The runtime base must point at a scratch folder before anything reads runtimePaths: this import must stay first.
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { GenerationQueueModel } from '../src/models/GenerationQueue'
import { externalizeQueueInputDataUrls, externalizeStoredQueuePayloads, hydrateQueueInputDataUrls, isQueueInputRef, resolveQueueInputFilePath, storeQueueInputBuffer } from '../src/services/generation-queue/queueInputStore'
import { parseCodexQueuePayload, parseNaiQueuePayload } from '../src/services/generation-queue/queuePayloads'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { scratchDir } from './support/scratchRuntime'
import { parseCodexGenerationRequest } from '../src/services/codexGenerationOptions'
import { buildCodexExecArgs, buildCodexPrompt, discoverOutputFiles, writeAttachedImage } from '../src/services/codexGenerationExecutor'
import { createCodexStrictPreservation } from '../src/services/codexImageInputs'
import { buildCodexMetadataPatch } from '../src/services/generation-queue/queuePayloads'
import { sanitizeSnapshotValue } from '../src/services/generationHistoryRequestSnapshot'
import { FileSaver } from '../src/utils/fileSaver'
import { runtimePaths } from '../src/config/runtimePaths'

initializeUserSettingsDb()

/** A PNG-looking data URL well above the 8KB externalization floor. */
const bigDataUrl = `data:image/png;base64,${Buffer.alloc(64 * 1024, 7).toString('base64')}`

test('stored payloads with base64 beside prompt_data are rewritten to references once', () => {
  const jobId = GenerationQueueModel.create({
    service_type: 'comfyui',
    workflow_id: null,
    workflow_name: 'director',
    request_summary: 'backfill test',
    // The shape the MCP enqueue path used to store: the raw node inputs copied next to prompt_data.
    request_payload: {
      prompt_data: { '7': { mode: 'FL2VA' } },
      '7___minimax_h3_director_node__': { mode: 'FL2VA', media: [{ type: 'image', data_url: bigDataUrl }] },
    },
  } as never)

  const first = externalizeStoredQueuePayloads()
  assert.equal(first.rewritten, 1)
  assert.ok(first.savedBytes > 60 * 1024)

  const row = getUserSettingsDb().prepare('SELECT request_payload FROM generation_queue_jobs WHERE id = ?').get(jobId) as { request_payload: string }
  assert.ok(!row.request_payload.includes(';base64,'))
  const ref = JSON.parse(row.request_payload)['7___minimax_h3_director_node__'].media[0].data_url
  assert.ok(isQueueInputRef(ref))
  assert.ok(resolveQueueInputFilePath(ref), 'the blob was written to the store')
  const refs = getUserSettingsDb().prepare('SELECT sha256 FROM generation_queue_input_refs WHERE job_id = ?').all(jobId) as Array<{ sha256: string }>
  assert.deepEqual(refs.map((entry) => entry.sha256), [ref.sha256])

  const second = externalizeStoredQueuePayloads()
  assert.equal(second.rewritten, 0)
  assert.equal(second.scanned, 0)
})

test('NovelAI inputs survive externalization and hydration with references claimed by every repeat', () => {
  const payload = {
    prompt: '1.5::artist:matrix16::',
    model: 'nai-diffusion-5-full',
    action: 'img2img',
    image: bigDataUrl,
    character_refs: [{ image: bigDataUrl }],
    seed: undefined,
  }
  const { value } = externalizeQueueInputDataUrls(payload)
  assert.ok(isQueueInputRef(value.image))
  assert.deepEqual(hydrateQueueInputDataUrls(value), payload)

  const jobIds = GenerationQueueModel.createMany(Array.from({ length: 32 }, () => ({
    service_type: 'novelai' as const,
    request_payload: value,
  })))
  const storedJob = GenerationQueueModel.findById(jobIds[0])!
  const storedPayload = parseNaiQueuePayload(storedJob)
  assert.deepEqual(hydrateQueueInputDataUrls(storedPayload), JSON.parse(JSON.stringify(payload)))
  // retryJob preserves the stored payload and creates another row through the same createMany path.
  const retryId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: storedPayload })
  const refRows = getUserSettingsDb().prepare(
    `SELECT job_id FROM generation_queue_input_refs WHERE job_id IN (${[...jobIds, retryId].map(() => '?').join(',')})`,
  ).all(...jobIds, retryId) as Array<{ job_id: number }>
  assert.deepEqual(refRows.map((row) => row.job_id).sort((a, b) => a - b), [...jobIds, retryId])

  assert.throws(
    () => hydrateQueueInputDataUrls({ image: { __ref: 'queue-input', sha256: '0'.repeat(64), bytes: 1, mimeType: 'image/png' } }),
    /Queue input blob is missing/,
  )
})

test('Codex edit inputs rewritten by the startup backfill still reach the executor', () => {
  const jobId = GenerationQueueModel.create({
    service_type: 'codex',
    request_payload: { prompt: 'make it blue', operation: 'infill', image: bigDataUrl, mask: bigDataUrl },
  } as never)
  externalizeStoredQueuePayloads()

  const stored = GenerationQueueModel.findById(jobId)!
  assert.ok(isQueueInputRef(JSON.parse(stored.request_payload).image))
  const parsed = parseCodexQueuePayload(stored)
  assert.equal(parsed.image, bigDataUrl)
  assert.equal(parsed.mask, bigDataUrl)
})

test('Codex validates legacy inputs and role-tagged references before enqueue', async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#123456' } }).png().toBuffer()
  const image = `data:image/png;base64,${png.toString('base64')}`
  const jpeg = `data:image/jpeg;base64,${(await sharp(png).jpeg().toBuffer()).toString('base64')}`
  const webp = `data:image/webp;base64,${(await sharp(png).webp().toBuffer()).toString('base64')}`
  assert.equal((await parseCodexGenerationRequest({ prompt: 'legacy', image })).attachment_descriptors.length, 1)
  const legacy = await parseCodexGenerationRequest({ prompt: 'legacy', operation: 'infill', image, mask: image })
  assert.equal(legacy.preserve, undefined)
  assert.equal(legacy.attachment_descriptors.length, 2)
  assert.equal((await parseCodexGenerationRequest({ prompt: 'refs', references: [{ role: 'style', data_url: jpeg }, { role: 'item', data_url: webp }] })).attachment_descriptors.length, 2)
  const invalid = [
    { image: 'data:image/png;base64,!!!!' },
    { image: 'data:image/png;base64,YQ==' },
    { image: image.replace('image/png', 'image/jpeg') },
    { image: image + '\n' },
    { image, references: Array.from({ length: 5 }, () => ({ role: 'item', data_url: image })) },
    { references: [{ role: 'unknown', data_url: image }] },
    { references: [{ role: 'style', label: 'x'.repeat(129), data_url: image }] },
    { operation: 'infill', image, mask: jpeg },
    { operation: 'edit', image, preserve: 'strict' },
    { image: `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')}` },
    { references: Array.from({ length: 4 }, () => ({ role: 'item', data_url: `data:image/png;base64,${Buffer.alloc(9 * 1024 * 1024).toString('base64')}` })) },
  ]
  for (const value of invalid) await assert.rejects(parseCodexGenerationRequest({ prompt: 'invalid', ...value }))
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'white' } }).png().toBuffer()
  await assert.rejects(parseCodexGenerationRequest({ prompt: 'wide', image: `data:image/png;base64,${wide.toString('base64')}` }), /4096/)
  const small = await sharp(png).resize(8, 8).png().toBuffer()
  await assert.rejects(parseCodexGenerationRequest({ prompt: 'mask', operation: 'infill', image, mask: `data:image/png;base64,${small.toString('base64')}` }), /match/)
})

test('Codex reference roles and order survive externalize, hydrate, retry, and sanitized history', async (t) => {
  const buffer = await sharp(randomBytes(128 * 128 * 3), { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer()
  const image = `data:image/png;base64,${buffer.toString('base64')}`
  const payload = await parseCodexGenerationRequest({
    prompt: 'ordered refs', operation: 'edit', image,
    references: [{ role: 'item', label: 'first', data_url: image }, { role: 'style', label: 'second', data_url: image }],
  })
  const stored = externalizeQueueInputDataUrls(payload).value
  assert.ok(isQueueInputRef(stored.references![0].data_url))
  assert.deepEqual(hydrateQueueInputDataUrls(stored), payload)
  const id = GenerationQueueModel.create({ service_type: 'codex', request_payload: stored })
  GenerationQueueModel.updateIfCurrentStatus(id, ['queued'], { status: 'failed' })
  t.after(() => { GenerationQueueModel.updateIfCurrentStatus(id, ['failed'], { status: 'queued' }) })
  const { GenerationQueueService } = await import('../src/services/generationQueueService')
  t.mock.method(GenerationQueueService, 'requestDispatch', () => {})
  const retry = GenerationQueueService.retryJob(id)!
  const parsed = parseCodexQueuePayload(GenerationQueueModel.findById(retry.id)!)
  assert.deepEqual(parsed.references, payload.references)
  const snapshot = sanitizeSnapshotValue(stored) as typeof stored
  assert.equal(snapshot.references![0].data_url, null)
  assert.deepEqual(snapshot.attachment_descriptors, payload.attachment_descriptors)
  assert.ok(!JSON.stringify(snapshot).includes('base64'))
  assert.ok(!JSON.stringify(snapshot).includes('queue-input'))
  assert.ok(!JSON.stringify(snapshot).includes(scratchDir))
  const { buildIdempotencyRequestHash } = await import('../src/mcp/tools/generationJobTools')
  const hash = buildIdempotencyRequestHash(payload)
  assert.equal(hash, buildIdempotencyRequestHash(JSON.parse(JSON.stringify(payload))))
  for (const references of [
    [...payload.references!].reverse(),
    [{ ...payload.references![0], role: 'material' }, payload.references![1]],
    [{ ...payload.references![0], data_url: bigDataUrl }, payload.references![1]],
  ]) assert.notEqual(hash, buildIdempotencyRequestHash({ ...payload, references }))
})

test('Codex CLI attaches unchanged files in order and never discovers them as outputs', async () => {
  const buffer = await sharp({ create: { width: 12, height: 10, channels: 3, background: 'red' } }).png().toBuffer()
  const image = `data:image/png;base64,${buffer.toString('base64')}`
  const payload = await parseCodexGenerationRequest({ prompt: 'edit', operation: 'infill', image, mask: image, references: [{ role: 'item', label: 'boots', data_url: image }] })
  const directory = await fs.mkdtemp(path.join(scratchDir, 'attachments-'))
  const files = []
  for (let index = 0; index < 3; index++) files.push(await writeAttachedImage(directory, `attachment-${index}`, image))
  for (const file of files) assert.deepEqual(await fs.readFile(file), buffer)
  const args = buildCodexExecArgs(directory, 'prompt', files, 'agent-model')
  assert.deepEqual(args.flatMap((arg, index) => arg === '--image' ? [args[index + 1]] : []), files)
  const manifest = payload.attachment_descriptors.map((entry, index) => ({ ...entry, path: files[index] }))
  const prompt = buildCodexPrompt(payload, ['result.png'], manifest)
  assert.ok(prompt.includes(JSON.stringify(files)))
  assert.ok(prompt.includes('ONLY edit canvas'))
  assert.ok(prompt.includes('referenced_image_paths'))
  const ignored = new Set(files.map((file) => path.basename(file)))
  assert.deepEqual(await discoverOutputFiles(directory, ['missing.png'], ignored), [])
  assert.deepEqual(await discoverOutputFiles(directory, [path.basename(files[0])], ignored), [])
  const output = path.join(directory, 'result.png')
  await fs.writeFile(output, buffer)
  assert.deepEqual((await discoverOutputFiles(directory, [], ignored)).map((file) => file.absolutePath), [output])
  const metadata = buildCodexMetadataPatch({ ...payload, size: '2048x2048' }, 0, 1, null, { width: 12, height: 10 })
  assert.equal(metadata.width, 12)
  assert.equal(metadata.codex_requested_width, 2048)
  assert.equal(metadata.codex_size_mismatch, true)
  assert.equal(buildCodexMetadataPatch({ prompt: 'text', size: '2048x2048' }, 0, 1, null).width, undefined)
})

test('strict infill composites only inside the mask and verifies the final PNG save', async () => {
  const width = 4, height = 4
  const pixels = randomBytes(width * height * 4)
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const maskPixels = Buffer.alloc(width * height, 0)
  maskPixels[5] = 255
  const mask = await sharp(maskPixels, { raw: { width, height, channels: 1 } }).png().toBuffer()
  const image = `data:image/png;base64,${source.toString('base64')}`
  const maskUrl = `data:image/png;base64,${mask.toString('base64')}`
  const request = await parseCodexGenerationRequest({ prompt: 'strict', operation: 'infill', image, mask: maskUrl, preserve: 'strict', output_format: 'jpeg', imageSaveOptions: { format: 'webp', resizeEnabled: true } })
  assert.equal(request.output_format, 'png')
  assert.equal(request.imageSaveOptions?.resizeEnabled, false)
  const strict = await createCodexStrictPreservation(image, maskUrl)
  const directory = await fs.mkdtemp(path.join(scratchDir, 'strict-'))
  const generated = path.join(directory, 'generated.png')
  await sharp({ create: { width, height, channels: 4, background: '#abcdef' } }).png().toFile(generated)
  const composite = path.join(directory, 'composite.png')
  await strict.composite(generated, composite)
  const saved = await FileSaver.saveGeneratedFile(composite, 'codex', { ...request.imageSaveOptions, metadataPatch: { prompt: 'strict' }, verifySavedFile: strict.verifySavedFile })
  const finalPath = path.join(runtimePaths.uploadsDir, saved.originalPath)
  const finalPixels = await sharp(finalPath).ensureAlpha().raw().toBuffer()
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (pixel !== 5) assert.deepEqual(finalPixels.subarray(pixel * 4, pixel * 4 + 4), pixels.subarray(pixel * 4, pixel * 4 + 4))
  }
  assert.deepEqual([...finalPixels.subarray(20, 24)], [171, 205, 239, 255])
  await assert.rejects(strict.verifySavedFile(generated), /protected pixels/)
  const wrongSize = path.join(directory, 'wrong.png')
  await sharp(source).resize(8, 8).png().toFile(wrongSize)
  await assert.rejects(strict.composite(wrongSize, composite), /resizing is forbidden/)
})

test('conditional queue updates preserve payload and cancellation when the expected status is stale', () => {
  const jobId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { prompt: 'before' } })
  getUserSettingsDb().prepare('UPDATE generation_queue_jobs SET updated_date = ? WHERE id = ?').run('2000-01-01 00:00:00', jobId)
  const queued = GenerationQueueModel.findById(jobId)!

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, [], { status: 'failed' }), false)
  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['running'], { status: 'failed' }), false)
  assert.deepEqual(GenerationQueueModel.findById(jobId), queued)

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['queued', 'dispatching'], {
    status: 'running',
    request_payload: { prompt: 'after' },
    cancel_requested: true,
    provider_job_id: undefined,
  }), true)
  const running = GenerationQueueModel.findById(jobId)!
  assert.equal(running.status, 'running')
  assert.equal(running.cancel_requested, 1)
  assert.equal(running.provider_job_id, null)
  assert.deepEqual(JSON.parse(running.request_payload), { prompt: 'after' })
  assert.notEqual(running.updated_date, queued.updated_date)

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(jobId, ['queued'], {
    status: 'completed',
    request_payload: { prompt: 'stale' },
    cancel_requested: false,
  }), false)
  assert.deepEqual(GenerationQueueModel.findById(jobId), running)
})

test('large terminal payload pruning preserves shared inputs until their last job is pruned', () => {
  const sharedBuffer = Buffer.alloc(9 * 1024, 23)
  const exclusiveBuffer = Buffer.alloc(12 * 1024, 24)
  const sharedRef = storeQueueInputBuffer(sharedBuffer, { mimeType: 'image/png' })
  const exclusiveRef = storeQueueInputBuffer(exclusiveBuffer, { mimeType: 'image/png' })
  const keeperId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { image: sharedRef } })
  const jobIds = GenerationQueueModel.createMany(Array.from({ length: 1001 }, () => ({
    service_type: 'novelai' as const,
    request_payload: { image: sharedRef },
  })))
  const exclusiveId = GenerationQueueModel.create({ service_type: 'novelai', request_payload: { image: exclusiveRef } })
  assert.equal(jobIds.length, 1001)

  const db = getUserSettingsDb()
  db.prepare("UPDATE generation_queue_jobs SET status = 'completed' WHERE id BETWEEN ? AND ?").run(jobIds[0], exclusiveId)
  const first = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(first.pruned, 1002)
  assert.equal(first.releasedInputFiles, 1)
  assert.equal(first.releasedInputBytes, exclusiveBuffer.byteLength)
  assert.equal(resolveQueueInputFilePath(exclusiveRef), null)
  assert.equal(hydrateQueueInputDataUrls({ image: sharedRef }).image, `data:image/png;base64,${sharedBuffer.toString('base64')}`)
  assert.equal(GenerationQueueModel.findById(keeperId)!.status, 'queued')

  assert.equal(GenerationQueueModel.updateIfCurrentStatus(keeperId, ['queued'], { status: 'completed' }), true)
  const last = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(last.pruned, 1)
  assert.equal(last.releasedInputFiles, 1)
  assert.equal(last.releasedInputBytes, sharedBuffer.byteLength)
  assert.equal(resolveQueueInputFilePath(sharedRef), null)
  const remaining = db.prepare('SELECT COUNT(*) AS count FROM generation_queue_input_refs WHERE sha256 IN (?, ?)').get(sharedRef.sha256, exclusiveRef.sha256) as { count: number }
  assert.equal(remaining.count, 0)

  const repeated = GenerationQueueModel.pruneTerminalRequestPayloads({ retainRecentTerminalJobs: 0 })
  assert.equal(repeated.pruned, 0)
  assert.equal(repeated.releasedInputFiles, 0)
})
