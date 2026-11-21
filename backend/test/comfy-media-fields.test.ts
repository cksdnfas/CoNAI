import './support/testTemp'
import './support/scratchRuntime'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { runtimePaths } from '../src/config/runtimePaths'
import { closeUserSettingsDb, initializeUserSettingsDb } from '../src/database/userSettingsDb'
import { ComfyInputValidationError, prepareComfyPromptData } from '../src/services/prepareComfyPromptData'
import { externalizeQueueInputDataUrls, isQueueInputRef } from '../src/services/generation-queue/queueInputStore'
import { storeWorkflowInputAssetFile } from '../src/services/workflowInputAssetStore'
import { resolveWorkflowPromptValues } from '../src/services/workflowPromptValueResolver'

test('audio and video marked fields upload their file and pass ComfyUI file names through', async (t) => {
  initializeUserSettingsDb()
  t.after(() => closeUserSettingsDb())
  const fields = [
    { id: 'audio', label: 'Audio', type: 'audio', jsonPath: '1.inputs.audio' },
    { id: 'video', label: 'Video', type: 'video', jsonPath: '2.inputs.video' },
    { id: 'image', label: 'Image', type: 'image', jsonPath: '3.inputs.image' },
  ] as any[]
  const uploads: Array<{ name: string; bytes: string; contentType?: string }> = []
  const comfy = {
    async uploadInputImage(name: string, input: Buffer | fs.ReadStream, options?: { contentType?: string }) {
      const chunks: Buffer[] = []
      if (Buffer.isBuffer(input)) chunks.push(input)
      else for await (const chunk of input) chunks.push(Buffer.from(chunk))
      uploads.push({ name, bytes: Buffer.concat(chunks).toString(), contentType: options?.contentType })
      return `uploaded/${name}`
    },
  } as any

  fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
  const temporary = path.join(runtimePaths.tempDir, 'media-field-upload.tmp')
  fs.writeFileSync(temporary, 'video-bytes')
  const videoRef = storeWorkflowInputAssetFile(temporary, { fileName: 'clip.webm', mimeType: 'video/webm', bytes: 11 })

  const prepared = await prepareComfyPromptData(comfy, fields, {
    audio: `data:audio/mpeg;base64,${Buffer.from('audio-bytes').toString('base64')}`,
    video: videoRef,
  })
  assert.equal(uploads.length, 2)
  assert.match(uploads[0].name, /^audio_\d+\.mp3$/, 'a nameless data URL takes its extension from the MIME type')
  assert.deepEqual([uploads[0].bytes, uploads[0].contentType], ['audio-bytes', 'audio/mpeg'])
  assert.match(uploads[1].name, /^clip_\d+\.webm$/)
  assert.deepEqual([uploads[1].bytes, uploads[1].contentType], ['video-bytes', 'video/webm'])
  assert.equal(prepared.audio, `uploaded/${uploads[0].name}`)
  assert.equal(prepared.video, `uploaded/${uploads[1].name}`)

  // A queued job stores a data URL as a nameless blob first: the upload still gets the media extension.
  uploads.length = 0
  const audioBytes = Buffer.alloc(16 * 1024, 7)
  const queued = externalizeQueueInputDataUrls({ audio: `data:audio/flac;base64,${audioBytes.toString('base64')}` }).value
  assert.ok(isQueueInputRef(queued.audio))
  const fromQueue = await prepareComfyPromptData(comfy, fields, queued)
  assert.match(uploads[0].name, /^audio_\d+\.flac$/)
  assert.equal(fromQueue.audio, `uploaded/${uploads[0].name}`)

  // A plain string is a file already in the ComfyUI input folder, never base64 to upload.
  uploads.length = 0
  const named = await prepareComfyPromptData(comfy, fields, { audio: 'voice.wav', video: 'subfolder/clip.mp4' })
  assert.deepEqual(named, { audio: 'voice.wav', video: 'subfolder/clip.mp4' })
  assert.equal(uploads.length, 0)

  await assert.rejects(prepareComfyPromptData(comfy, fields, { audio: { file_path: 'C:/secret.wav' } }), ComfyInputValidationError)
  await assert.rejects(prepareComfyPromptData(comfy, fields, { video: { fileName: 'clip.mp4' } }), /not a usable video input/)
  assert.equal(uploads.length, 0)

  // Media values are not prompt text: no wildcard or comment handling, and the object stays an object.
  const resolved = resolveWorkflowPromptValues(fields, { audio: '__voice__ # not a comment.wav', video: videoRef })
  assert.equal(resolved.audio, '__voice__ # not a comment.wav')
  assert.deepEqual(resolved.video, videoRef)
})
