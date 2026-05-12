import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { VideoOptimizationService } from '../services/videoOptimizationService'
import {
  getDefaultSettingsFromEnvironment,
  hasMissingSettingsFields,
  mergeLoadedSettingsWithDefaults,
} from '../services/settingsServiceStorage'
import { applyVideoOptimizationSettingsUpdate } from '../services/settingsServiceUpdates'

async function writeFileWithSize(filePath: string, size: number) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, Buffer.alloc(size, 'v'))
}

async function assertPathMissing(filePath: string, message: string) {
  try {
    await fs.stat(filePath)
    assert.fail(message)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

async function main() {
  assert.equal(VideoOptimizationService.OUTPUT_EXTENSION, '.mp4')
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('.MP4'), true)
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('.webm'), true)
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('webm'), false)
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('.mov'), true)
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('.avi'), true)
  assert.equal(VideoOptimizationService.isOptimizableVideoExtension('.gif'), false)

  const defaults = getDefaultSettingsFromEnvironment()
  assert.deepEqual(defaults.videoOptimization, {
    enabled: true,
    preset: 'balanced',
    crf: 26,
    audioBitrateKbps: 128,
    applyToUpload: true,
    applyToGeneratedOutputs: true,
    applyToBackupImports: true,
  })

  const partialLoaded = { videoOptimization: { enabled: false } }
  assert.equal(hasMissingSettingsFields(partialLoaded, defaults), true)
  assert.deepEqual(mergeLoadedSettingsWithDefaults(partialLoaded, defaults).videoOptimization, {
    ...defaults.videoOptimization,
    enabled: false,
  })

  assert.deepEqual(
    applyVideoOptimizationSettingsUpdate(defaults, { crf: 30, applyToBackupImports: false }).videoOptimization,
    {
      ...defaults.videoOptimization,
      crf: 30,
      applyToBackupImports: false,
    },
  )

  const originalTranscode = VideoOptimizationService.transcodeToMp4
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conai-video-optimization-'))

  try {
    const smallerSource = path.join(tempDir, 'source.webm')
    await writeFileWithSize(smallerSource, 32)
    VideoOptimizationService.transcodeToMp4 = async (_inputPath, outputPath) => {
      await writeFileWithSize(outputPath, 8)
      return { outputPath, fileSize: 8, mimeType: 'video/mp4' }
    }
    const smallerResult = await VideoOptimizationService.persistWithFallback(smallerSource, path.join(tempDir, 'smaller-output'), '.webm', {
      crf: 26,
      audioBitrateKbps: 128,
    })
    assert.equal(smallerResult.optimized, true)
    assert.equal(smallerResult.fallbackReason, undefined)
    assert.equal(smallerResult.outputPath, path.join(tempDir, 'smaller-output.mp4'))
    assert.equal(smallerResult.mimeType, 'video/mp4')
    assert.equal((await fs.stat(smallerResult.outputPath)).size, 8)
    await assertPathMissing(path.join(tempDir, 'smaller-output.webm'), 'optimized WebM should not keep a fallback original copy')

    const largerSource = path.join(tempDir, 'larger.mov')
    await writeFileWithSize(largerSource, 8)
    VideoOptimizationService.transcodeToMp4 = async (_inputPath, outputPath) => {
      await writeFileWithSize(outputPath, 32)
      return { outputPath, fileSize: 32, mimeType: 'video/mp4' }
    }
    const largerResult = await VideoOptimizationService.persistWithFallback(largerSource, path.join(tempDir, 'larger-output'), '.mov', {
      crf: 26,
      audioBitrateKbps: 128,
    })
    assert.equal(largerResult.optimized, false)
    assert.equal(largerResult.fallbackReason, 'larger-than-original')
    assert.equal(largerResult.outputPath, path.join(tempDir, 'larger-output.mov'))
    assert.equal(largerResult.mimeType, 'video/quicktime')
    assert.equal((await fs.stat(largerResult.outputPath)).size, 8)
    await assertPathMissing(path.join(tempDir, 'larger-output.mp4'), 'larger optimized MP4 should be removed after fallback')

    const failedSource = path.join(tempDir, 'failed.avi')
    await writeFileWithSize(failedSource, 12)
    VideoOptimizationService.transcodeToMp4 = async () => {
      throw new Error('forced transcode failure')
    }
    const failedResult = await VideoOptimizationService.persistWithFallback(failedSource, path.join(tempDir, 'failed-output'), '.avi', {
      crf: 26,
      audioBitrateKbps: 128,
    })
    assert.equal(failedResult.optimized, false)
    assert.equal(failedResult.fallbackReason, 'transcode-failed')
    assert.equal(failedResult.outputPath, path.join(tempDir, 'failed-output.avi'))
    assert.equal(failedResult.mimeType, 'video/x-msvideo')
    assert.equal((await fs.stat(failedResult.outputPath)).size, 12)
  } finally {
    VideoOptimizationService.transcodeToMp4 = originalTranscode
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  console.log('✅ Video optimization contract smoke passed (settings, extension gates, MP4/fallback persistence)')
}

main()
