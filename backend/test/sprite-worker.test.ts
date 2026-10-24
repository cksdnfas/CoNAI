import './support/testTemp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ffmpegBinary, runTool } from '../src/services/sprite/spriteFfmpeg'
import { resolveExtractOptions } from '../src/services/sprite/spriteOptions'
import { runSpriteTask, shutdownSpriteWorker, spriteWorkerMode } from '../src/services/sprite/spriteWorkerClient'

/**
 * Full-size builds share the slot/cancellation contract in worker and inline fallback modes.
 * Only the worker mode promises sub-100 ms stalls; the fallback yields between frames.
 */
for (const inline of [false, true]) {
  test(`sprite ${inline ? 'inline fallback' : 'worker'}: a 256-frame despill build preserves queued cancellation`, { timeout: 300000 }, async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-worker-'))
    t.after(async () => {
      await shutdownSpriteWorker()
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const video = path.join(dir, 'long.mp4')
    // 9 s of magenta at 30 fps with a moving box → 270 frames, of which 256 are sampled.
    await runTool(ffmpegBinary(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff00ff:s=512x512:r=30:d=9',
      '-vf', "drawbox=x='100+100*sin(t)':y=150:w=200:h=200:color=0x3080ff:t=fill,format=yuv420p",
      '-c:v', 'libx264', '-crf', '18', video,
    ], { timeoutMs: 120000 })

    if (!inline) assert.equal(spriteWorkerMode(), 'worker')
    let worstStall = 0
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      worstStall = Math.max(worstStall, now - last - 10)
      last = now
    }, 10)
    const started = performance.now()
    let progressEvents = 0
    const workDir = path.join(dir, 'ws')
    const extraction = runSpriteTask('extract', {
      buildId: 'nonblocking', workDir, sourcePath: video, sourceHash: null, sourceName: null, requestedByAccountId: null,
      options: resolveExtractOptions({ sampleCount: 256 }),
      render: { columns: 0, spacing: 0, crop: null, format: 'png', quality: 90 },
    }, { inline, onProgress: () => { progressEvents += 1 } }).finally(() => clearInterval(timer))
    const controller = new AbortController()
    const abandoned = runSpriteTask('preview', { workDir, index: 0, maxSide: 64 }, { inline, signal: controller.signal })
    const following = runSpriteTask('preview', { workDir, index: 0, maxSide: 64 }, { inline })
    controller.abort()
    await assert.rejects(abandoned, /취소/)
    const result = await extraction
    const elapsed = performance.now() - started
    assert.deepEqual([...(await following).png.subarray(0, 4)], [137, 80, 78, 71], 'preview waits for extraction despite a cancelled waiter')

    assert.equal(result.meta.frameCount, 256)
    assert.ok(progressEvents > 256, `progress relayed (${progressEvents} events)`)
    t.diagnostic(`256 frames 512x512 despill: ${Math.round(elapsed)} ms total, worst event-loop stall ${Math.round(worstStall)} ms`)
    if (!inline) assert.ok(worstStall < 100, `worst event-loop stall ${Math.round(worstStall)} ms`)
  })
}
