import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ffmpegBinary, runTool } from '../src/services/sprite/spriteFfmpeg'
import { resolveExtractOptions } from '../src/services/sprite/spriteOptions'
import { runSpriteTask, shutdownSpriteWorker, spriteWorkerMode } from '../src/services/sprite/spriteWorkerClient'

/**
 * A full-size sprite build (256 frames of 512x512 with despill) must not stall the server's event loop: it runs in the
 * worker thread, and the main thread only relays progress. Measured as the worst lateness of a 10 ms interval timer.
 */
test('sprite worker: a 256-frame despill build keeps the event loop responsive', { timeout: 300000 }, async (t) => {
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

  assert.equal(spriteWorkerMode(), 'worker')
  let worstStall = 0
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    worstStall = Math.max(worstStall, now - last - 10)
    last = now
  }, 10)
  const started = performance.now()
  let progressEvents = 0
  const result = await runSpriteTask('extract', {
    buildId: 'nonblocking', workDir: path.join(dir, 'ws'), sourcePath: video, sourceHash: null, sourceName: null, requestedByAccountId: null,
    options: resolveExtractOptions({ sampleCount: 256 }),
    render: { columns: 0, spacing: 0, crop: null, format: 'png', quality: 90 },
  }, { onProgress: () => { progressEvents += 1 } }).finally(() => clearInterval(timer))
  const elapsed = performance.now() - started

  assert.equal(result.meta.frameCount, 256)
  assert.ok(progressEvents > 256, `progress relayed (${progressEvents} events)`)
  t.diagnostic(`256 frames 512x512 despill: ${Math.round(elapsed)} ms total, worst event-loop stall ${Math.round(worstStall)} ms`)
  assert.ok(worstStall < 100, `worst event-loop stall ${Math.round(worstStall)} ms`)
})
