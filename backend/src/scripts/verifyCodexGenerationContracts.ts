import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GenerationQueueJobRecord } from '../types/generationQueue'

const ISO = '2026-05-14T00:00:00.000Z'

function queueJob(payload: Record<string, unknown>, overrides: Partial<GenerationQueueJobRecord> = {}): GenerationQueueJobRecord {
  return {
    id: overrides.id ?? 1,
    service_type: overrides.service_type ?? 'codex',
    status: overrides.status ?? 'queued',
    priority: overrides.priority ?? 100,
    requested_by_account_id: overrides.requested_by_account_id ?? null,
    requested_by_username: overrides.requested_by_username ?? null,
    requested_by_account_type: overrides.requested_by_account_type ?? null,
    workflow_id: overrides.workflow_id ?? null,
    workflow_name: overrides.workflow_name ?? null,
    requested_group_id: overrides.requested_group_id ?? null,
    requested_server_id: overrides.requested_server_id ?? null,
    requested_server_tag: overrides.requested_server_tag ?? null,
    assigned_server_id: overrides.assigned_server_id ?? null,
    provider_job_id: overrides.provider_job_id ?? null,
    request_payload: JSON.stringify(payload),
    request_summary: overrides.request_summary ?? null,
    failure_code: overrides.failure_code ?? null,
    failure_message: overrides.failure_message ?? null,
    cancel_requested: overrides.cancel_requested ?? 0,
    queued_at: overrides.queued_at ?? ISO,
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? null,
    created_date: overrides.created_date ?? ISO,
    updated_date: overrides.updated_date ?? ISO,
  }
}

async function removeDirectoryWithRetries(directoryPath: string, attempts = 10) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(directoryPath, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  console.warn(`⚠️ Failed to remove Codex contract smoke temp directory ${directoryPath}: ${message}`)
}

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-codex-contracts-'))
  process.env.RUNTIME_BASE_PATH = tempBasePath

  let closeUserSettingsDb: (() => void) | null = null

  try {
    const { ensureRuntimeDirectories, runtimePaths } = await import('../config/runtimePaths')
    const userSettings = await import('../database/userSettingsDb')
    const { buildCodexMetadataPatch, parseCodexQueuePayload } = await import('../services/generation-queue/queuePayloads')
    const { codexGenerationExecutorTestHooks } = await import('../services/codexGenerationExecutor')

    closeUserSettingsDb = userSettings.closeUserSettingsDb
    ensureRuntimeDirectories()
    userSettings.initializeUserSettingsDb()

    const referenceImage = 'data:image/png;base64,aGVsbG8='
    const maskImage = 'data:image/webp;base64,d29ybGQ='
    const parsed = parseCodexQueuePayload(queueJob({
      prompt: 'portrait subject\n// internal preset note //\ncinematic lighting',
      negative_prompt: 'low quality',
      model: ' gpt-image-1 ',
      size: '1536x1024',
      quality: 'high',
      background: 'transparent',
      output_format: 'jpeg',
      count: 99,
      operation: 'infill',
      image: referenceImage,
      mask: maskImage,
      imageSaveOptions: {
        format: 'png',
        quality: 92,
      },
    }))

    assert.equal(parsed.prompt, 'portrait subject\ncinematic lighting')
    assert.equal(parsed.negative_prompt, 'low quality')
    assert.equal(parsed.model, 'gpt-image-1')
    assert.equal(parsed.size, '1536x1024')
    assert.equal(parsed.quality, 'high')
    assert.equal(parsed.background, 'transparent')
    assert.equal(parsed.output_format, 'jpeg')
    assert.equal(parsed.count, 4, 'Codex queue payload count should clamp to the executor maximum')
    assert.equal(parsed.operation, 'infill')
    assert.equal(parsed.image, referenceImage)
    assert.equal(parsed.mask, maskImage)
    assert.deepEqual(parsed.imageSaveOptions, { format: 'png', quality: 92 })

    const parsedFromN = parseCodexQueuePayload(queueJob({
      prompt: 'single image',
      n: '3',
      background: 'invalid',
      output_format: 'webp',
      operation: 'unknown',
    }))
    assert.equal(parsedFromN.count, 3)
    assert.equal(parsedFromN.background, 'auto')
    assert.equal(parsedFromN.output_format, 'webp')
    assert.equal(parsedFromN.operation, 'generate')

    assert.throws(
      () => parseCodexQueuePayload(queueJob({ prompt: '   ' }, { id: 2 })),
      /missing string request_payload\.prompt/,
      'blank Codex prompts should fail before executor work starts',
    )

    const metadataPatch = buildCodexMetadataPatch(parsed, 2, 4, 'DONE')
    assert.equal(metadataPatch.ai_tool, 'codex')
    assert.equal(metadataPatch.software, 'Codex CLI')
    assert.equal(metadataPatch.model, 'gpt-image-1')
    assert.equal(metadataPatch.prompt, parsed.prompt)
    assert.equal(metadataPatch.positive_prompt, parsed.prompt)
    assert.equal(metadataPatch.negative_prompt, 'low quality')
    assert.equal(metadataPatch.width, 1536)
    assert.equal(metadataPatch.height, 1024)
    assert.equal(metadataPatch.batch_size, 4)
    assert.equal(metadataPatch.batch_index, 2)
    assert.equal(metadataPatch.codex_operation, 'infill')
    assert.equal(metadataPatch.codex_quality, 'high')
    assert.equal(metadataPatch.codex_background, 'transparent')
    assert.equal(metadataPatch.codex_output_format, 'jpeg')
    assert.equal(metadataPatch.codex_last_message, 'DONE')

    assert.equal(codexGenerationExecutorTestHooks.resolveOutputFormat(undefined), 'png')
    assert.equal(codexGenerationExecutorTestHooks.resolveOutputFormat('webp'), 'webp')
    assert.equal(codexGenerationExecutorTestHooks.resolveOutputFormat('gif'), 'png')
    assert.equal(codexGenerationExecutorTestHooks.resolveOutputExtension('jpeg'), 'jpg')
    assert.deepEqual(
      codexGenerationExecutorTestHooks.buildRequestedOutputFileNames(9, 'jpeg'),
      ['codex-output-01.jpg', 'codex-output-02.jpg', 'codex-output-03.jpg', 'codex-output-04.jpg'],
    )

    const prompt = codexGenerationExecutorTestHooks.buildCodexPrompt({
      prompt: 'A tiny blue robot on a workbench',
      model: 'gpt-image-1',
      negative_prompt: 'blur',
      size: '1024x768',
      quality: 'high',
      background: 'opaque',
      output_format: 'jpeg',
      count: 9,
      operation: 'edit',
      image: referenceImage,
    }, codexGenerationExecutorTestHooks.buildRequestedOutputFileNames(9, 'jpeg'))

    assert.match(prompt, /Create exactly 4 final image file\(s\): codex-output-01\.jpg, codex-output-02\.jpg, codex-output-03\.jpg, codex-output-04\.jpg/)
    assert.match(prompt, /Operation: edit/)
    assert.match(prompt, /Prompt: A tiny blue robot on a workbench/)
    assert.match(prompt, /Preferred size: 1024x768/)
    assert.match(prompt, /Attached inputs: the first attached image is the reference image/)
    assert.match(prompt, /After the requested files exist, reply with ONLY: DONE/)

    const authenticatedStatus = codexGenerationExecutorTestHooks.parseCodexAvailabilityOutput('Logged in using ChatGPT', 0, 'codex')
    assert.equal(authenticatedStatus.installed, true)
    assert.equal(authenticatedStatus.authenticated, true)
    assert.equal(authenticatedStatus.available, true)
    assert.equal(authenticatedStatus.authMode, 'ChatGPT')

    const unauthenticatedStatus = codexGenerationExecutorTestHooks.parseCodexAvailabilityOutput('Not logged in', 1, 'codex')
    assert.equal(unauthenticatedStatus.installed, true)
    assert.equal(unauthenticatedStatus.authenticated, false)
    assert.equal(unauthenticatedStatus.available, false)
    assert.match(unauthenticatedStatus.message, /로그인 필요/)

    const codexJobRoot = codexGenerationExecutorTestHooks.resolveCodexJobRoot()
    assert.equal(path.basename(codexJobRoot), 'codex-jobs')
    assert.equal(path.dirname(codexJobRoot), runtimePaths.tempDir)

    const discoveryDir = fs.mkdtempSync(path.join(tempBasePath, 'codex-discovery-'))
    const ignoredReferencePath = path.join(discoveryDir, 'reference-image.png')
    const requestedOutputPath = path.join(discoveryDir, 'codex-output-01.jpg')
    const fallbackOutputPath = path.join(discoveryDir, 'z-fallback.webp')
    fs.writeFileSync(ignoredReferencePath, 'reference')
    fs.writeFileSync(requestedOutputPath, 'requested')
    fs.writeFileSync(fallbackOutputPath, 'fallback')

    const preferredOutputs = await codexGenerationExecutorTestHooks.discoverOutputFiles(
      discoveryDir,
      ['codex-output-01.jpg'],
      new Set(['reference-image.png']),
    )
    assert.deepEqual(preferredOutputs, [{ absolutePath: requestedOutputPath, mimeType: 'image/jpeg' }])

    fs.rmSync(requestedOutputPath, { force: true })
    const fallbackOutputs = await codexGenerationExecutorTestHooks.discoverOutputFiles(
      discoveryDir,
      ['codex-output-01.jpg'],
      new Set(['reference-image.png']),
    )
    assert.deepEqual(fallbackOutputs, [{ absolutePath: fallbackOutputPath, mimeType: 'image/webp' }])

    console.log('✅ Codex generation contracts verified (queue payloads, metadata patches, CLI status parsing, prompt/output discovery, runtime temp root)')
  } finally {
    try {
      closeUserSettingsDb?.()
    } catch {
      // Ignore cleanup issues from partially initialized runs.
    }

    await removeDirectoryWithRetries(tempBasePath)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
