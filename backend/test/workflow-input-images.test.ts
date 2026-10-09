import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

test('workflow input images: data URLs go into the library once and come back as data for non-ComfyUI engines', { timeout: 60000 }, async (t) => {
  const temp = path.resolve(__dirname, '../../temp')
  fs.mkdirSync(temp, { recursive: true })
  const root = fs.mkdtempSync(path.join(temp, 'conai-workflow-input-images-test-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  process.env.RUNTIME_SAVE_DIR = path.join(root, 'save')
  process.env.RUNTIME_UPLOADS_DIR = path.join(root, 'uploads')
  process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
  const settings = await import('../src/database/userSettingsDb')
  settings.initializeUserSettingsDb()
  ;(await import('../src/database/apiGenerationDb')).initializeApiGenerationDb()
  const auth = await import('../src/database/authDb')
  auth.initializeAuthDb()
  const images = await import('../src/database/init')
  await images.initializeDatabase()
  const {
    WORKFLOW_INPUT_IMAGE_GROUP_PATH,
    WorkflowInputImageError,
    ingestWorkflowInputImage,
    isLibraryImageRef,
    materializeLibraryImageInputs,
  } = await import('../src/services/workflowInputImages')
  const { GroupPathService } = await import('../src/services/groupPathService')
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue')
  // Metadata extraction runs in the background and would outlive the scratch runtime.
  t.mock.method(BackgroundQueueService, 'addMetadataExtractionTask', () => {})
  t.after(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    settings.closeUserSettingsDb()
    auth.getAuthDb().close()
    images.closeDatabase()
    const { logger } = await import('../src/utils/logger')
    await new Promise<void>((resolve) => logger.close(resolve))
    assert.equal(path.dirname(path.resolve(root)), temp)
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })

  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366cc' } }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`

  const ref = await ingestWorkflowInputImage(dataUrl)
  assert.ok(isLibraryImageRef(ref))
  assert.deepEqual(await ingestWorkflowInputImage(dataUrl), ref, 'the same image is reused, not copied again')

  const group = GroupPathService.resolveOrCreate(WORKFLOW_INPUT_IMAGE_GROUP_PATH)
  const member = images.db.prepare('SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?').get(group.groupId, ref.composite_hash)
  assert.ok(member, 'filed under the workflow input group')

  const ports = [
    { key: 'image', label: 'Image', direction: 'input' as const, data_type: 'image' as const },
    { key: 'refs', label: 'Refs', direction: 'input' as const, data_type: 'image' as const, multiple: true },
    { key: 'meta', label: 'Meta', direction: 'input' as const, data_type: 'json' as const },
  ]
  const inputs = { image: ref, refs: [ref, 'data:image/png;base64,AAAA'], meta: ref }

  const forNai = await materializeLibraryImageInputs('nai', ports, inputs)
  assert.ok(typeof forNai.image === 'string' && forNai.image.startsWith('data:image/png;base64,'))
  assert.equal(forNai.refs[0], forNai.image)
  assert.equal(forNai.refs[1], 'data:image/png;base64,AAAA')
  assert.deepEqual(forNai.meta, ref, 'only image ports are resolved')
  assert.deepEqual(inputs.image, ref, 'the caller inputs are left alone')

  assert.equal(await materializeLibraryImageInputs('comfyui', ports, inputs), inputs, 'ComfyUI uploads the library file itself')

  await assert.rejects(ingestWorkflowInputImage('data:image/png;base64,'), WorkflowInputImageError)
  await assert.rejects(ingestWorkflowInputImage(`data:image/png;base64,${Buffer.from('<html></html>').toString('base64')}`), WorkflowInputImageError)
})
