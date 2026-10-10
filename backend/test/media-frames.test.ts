import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-media-frames-'))
// Video frames go through the runtime temp dir: keep them in this test's own folder.
process.env.RUNTIME_TEMP_DIR = path.join(root, 'temp')
let frames: typeof import('../src/services/mediaFrames')
let videos: typeof import('../src/services/videoProcessor')
test.before(async () => {
  frames = await import('../src/services/mediaFrames')
  videos = await import('../src/services/videoProcessor')
})
// libvips keeps opened files cached, which on Windows blocks rewriting and removing them.
sharp.cache(false)
test.after(() => fs.rmSync(root, { recursive: true, force: true }))
let gifs = 0

/** A 4-frame GIF (red, green, blue, white), 200ms per frame. */
async function writeGif() {
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]
  const frame = 32 * 32 * 3
  const raw = Buffer.alloc(frame * colors.length)
  colors.forEach(([r, g, b], index) => { for (let offset = 0; offset < frame; offset += 3) raw.set([r, g, b], index * frame + offset) })
  const file = path.join(root, `loop-${++gifs}.gif`)
  await sharp(raw, { raw: { width: 32, height: 32 * colors.length, channels: 3, pageHeight: 32 } }).gif({ delay: [200, 200, 200, 200], loop: 0 }).toFile(file)
  return file
}

async function dominant(image: Buffer) {
  const { data } = await sharp(image).resize(1, 1).raw().toBuffer({ resolveWithObject: true })
  return [...data.subarray(0, 3)]
}

test('sample times are slice midpoints, never the very end', () => {
  assert.deepEqual(frames.sampleTimes(0, 8, 4), [1, 3, 5, 7])
  assert.deepEqual(frames.sampleTimes(2, 4, 1), [3])
})

test('an animated GIF splits into its frames with their times', async () => {
  const file = await writeGif()
  const all = await frames.extractMediaFrames(file, 'image/gif', { count: 12 })
  assert.equal(all.kind, 'animation')
  assert.equal(all.totalFrames, 4)
  assert.equal(all.duration, 0.8)
  assert.deepEqual(all.frames.map((frame) => [frame.index, frame.time]), [[0, 0], [1, 0.2], [2, 0.4], [3, 0.6]])
  const [red, green, blue] = await Promise.all(all.frames.slice(0, 3).map((frame) => dominant(frame.image)))
  assert.ok(red[0] > 200 && red[1] < 50 && green[1] > 200 && green[0] < 50 && blue[2] > 200 && blue[0] < 50)

  const two = await frames.extractMediaFrames(file, 'image/gif', { count: 2 })
  assert.deepEqual(two.frames.map((frame) => frame.index), [1, 3])
  const ranged = await frames.extractMediaFrames(file, 'image/gif', { count: 6, start: 0.4, end: 0.8 })
  assert.deepEqual(ranged.frames.map((frame) => frame.index), [2, 3])
})

test('a still image or other files are refused', async () => {
  const still = path.join(root, 'still.png')
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toFile(still)
  await assert.rejects(frames.extractMediaFrames(still, 'image/png'), frames.MediaFramesError)
  const gif = path.join(root, 'still.gif')
  await sharp(still).gif().toFile(gif)
  await assert.rejects(frames.extractMediaFrames(gif, 'image/gif'), /single frame/)
  await assert.rejects(frames.extractMediaFrames(await writeGif(), 'image/gif', { start: 5 }), /range is empty/)
})

test('a video splits into frames spread over its running time', async (t) => {
  const file = path.join(root, 'clip.mp4')
  const made = videos.VideoProcessor.listFFmpegPaths().some((ffmpeg) => spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=160x120:rate=10', '-pix_fmt', 'yuv420p', '-y', file]).status === 0)
  if (!made) return t.skip('ffmpeg cannot write a test clip here')
  const result = await frames.extractMediaFrames(file, 'video/mp4', { count: 4 })
  assert.equal(result.kind, 'video')
  assert.ok(Math.abs(result.duration - 4) < 0.2)
  assert.deepEqual(result.frames.map((frame) => frame.time), [0.5, 1.5, 2.5, 3.5])
  for (const frame of result.frames) assert.equal((await sharp(frame.image).metadata()).format, 'png')
  const ranged = await frames.extractMediaFrames(file, 'video/mp4', { count: 2, start: 1, end: 2 })
  assert.deepEqual(ranged.frames.map((frame) => frame.time), [1.25, 1.75])
})

test('sheet layout keeps the picture close to square', () => {
  assert.equal(frames.sheetColumns(4, 16 / 9), 2)
  assert.equal(frames.sheetColumns(3, 16 / 9), 1)
  assert.equal(frames.sheetColumns(3, 9 / 16), 3)
  assert.equal(frames.sheetColumns(1, 2), 1)
})

test('frames tile into numbered pictures, spread evenly across them', async () => {
  const white = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#fff' } }).png().toBuffer()
  const six = Array.from({ length: 6 }, (_, index) => ({ index: null, time: index, image: white }))
  const sheets = await frames.frameSheets(six, 4)
  assert.deepEqual(sheets.map((sheet) => [sheet.first, sheet.count, sheet.columns, sheet.rows]), [[1, 3, 1, 3], [4, 3, 1, 3]])
  const picture = Buffer.from(sheets[0].data, 'base64')
  const { width, height, format } = await sharp(picture).metadata()
  assert.equal(format, 'jpeg')
  assert.ok(Math.max(width!, height!) <= 768)
  // The number badge darkens the top-left corner of each white frame; the frame's middle stays white.
  const { data, info } = await sharp(picture).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]
  assert.ok(at(20, 20) < 80)
  assert.ok(at(Math.floor(info.width / 2), 8 + 60) > 200)

  const singles = await frames.frameSheets(six.slice(0, 2), 1)
  assert.deepEqual(singles.map((sheet) => [sheet.first, sheet.count]), [[1, 1], [2, 1]])
  assert.equal((await sharp(Buffer.from(singles[0].data, 'base64')).metadata()).width, 512)
  assert.deepEqual(await frames.frameSheets([], 4), [])
})
