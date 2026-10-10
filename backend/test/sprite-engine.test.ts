import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { buildSpriteFrames, loadBuildFrame, renderSheet, type SpriteBuildMeta } from '../src/services/sprite/spriteBuild'
import { decodeImage, encodeStill } from '../src/services/sprite/spriteEncode'
import { ffmpegBinary, probeVideo } from '../src/services/sprite/spriteFfmpeg'
import { ANIMATION_DEFAULTS, buildSpriteAnimation } from '../src/services/sprite/spriteAnimation'
import { NORMALIZATION_DEFAULTS, normalizeSpriteSheets, normalizeSpriteSheetsBulk, type NormalizationSource } from '../src/services/sprite/spriteNormalize'
import { intervalModeIndices, resolveExtractOptions, type SpriteExtractOptions, type SpriteExtractOptionsInput, type SpriteVideoInfo } from '../src/services/sprite/spriteOptions'
import { despillFrame, despillKeyKind, type RgbaFrame } from '../src/services/sprite/spritePixels'
import { PORT_CASES, resolveCaseInput, rgbaSha256 } from './fixtures/sprite-port/generate'

/**
 * The sprite port against the golden outputs of the original video-sprite-extractor (fixtures/av-golden) and the
 * port-produced D4 fixtures (fixtures/sprite-port). Deviations D1–D5 are tested as such.
 */

const GOLDEN = path.resolve(__dirname, 'fixtures/av-golden')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8')).sprite
// eslint-disable-next-line @typescript-eslint/no-var-requires
const portManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/sprite-port/manifest.json'), 'utf8'))

type GoldenOptions = Record<string, any>

async function loadPng(file: string): Promise<RgbaFrame> {
  const { data, info } = await sharp(path.join(GOLDEN, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** Pixels that differ; RGB under alpha 0 is ignored (it carries no colour). */
function differingPixels(a: Uint8Array, b: Uint8Array): number {
  let count = 0
  for (let offset = 0; offset < a.length; offset += 4) {
    if (a[offset + 3] !== b[offset + 3]) { count += 1; continue }
    if (a[offset + 3] === 0) continue
    if (a[offset] !== b[offset] || a[offset + 1] !== b[offset + 1] || a[offset + 2] !== b[offset + 2]) count += 1
  }
  return count
}

function mapGoldenOptions(o: GoldenOptions): SpriteExtractOptionsInput {
  return {
    startTime: o.start_time, endTime: o.end_time, intervalSeconds: o.interval_seconds, sampleCount: o.sample_count,
    backgroundMode: o.background_mode === 'none' ? 'none' : 'key', keyColors: o.key_colors,
    tolerance: o.tolerance, softness: o.softness,
    despill: o.background_mode === 'chroma' && o.chroma_method === 'magenta_color_difference_despill',
    edgeCleanup: o.chroma_edge_cleanup, autoCrop: o.auto_crop, alphaThreshold: o.alpha_threshold,
    cropX: o.crop_x, cropY: o.crop_y, cropWidth: o.crop_width, cropHeight: o.crop_height,
    resizeMode: o.resize_mode, outputWidth: o.output_width, outputHeight: o.output_height,
    removeDuplicateFrames: o.remove_duplicate_frames, frameSimilarityThreshold: o.frame_similarity_threshold,
    columns: o.columns, spacing: o.spacing,
    outputFormat: o.output_format ?? 'png', outputQuality: o.output_quality ?? 90,
  }
}

/**
 * The frames the original actually decoded. D3 changed interval sampling, so golden comparisons replay the original
 * choice: the generator-derived indices, or (cases without them, interval 0.25 s at 12 fps from 0) every third frame
 * starting one late, which is what the original's fps=…:round=near produced on these clips.
 */
function originalIndices(c: GoldenOptions): number[] | undefined {
  if (c.derived_source_frame_indices) return c.derived_source_frame_indices.indices
  if (c.sample_frame_indices) return c.sample_frame_indices
  const o = c.options
  if (o.sample_count === 0 && o.interval_seconds === 0.25 && o.start_time === 0) return [1, 4, 7, 10, 13, 16, 19, 22]
  return undefined
}

async function build(source: string, options: SpriteExtractOptions, frameIndicesOverride?: number[]) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-engine-'))
  const meta = await buildSpriteFrames({
    buildId: 'test', workDir: work, sourcePath: source, sourceHash: null, sourceName: null, requestedByAccountId: null,
    video: await probeVideo(source), options, frameIndicesOverride,
  })
  return { work, meta }
}

function frames(work: string, meta: SpriteBuildMeta): RgbaFrame[] {
  return Array.from({ length: meta.frameCount }, (_, index) => loadBuildFrame(work, meta, index))
}

test('sprite engine: golden sheets from the original app', { timeout: 300000 }, async (t) => {
  for (const c of manifest.sheets) {
    if (c.id === 'colorkey_green_two_colors') continue // D1, tested below
    await t.test(c.id, async () => {
      const { work, meta } = await build(path.join(GOLDEN, c.input), resolveExtractOptions(mapGoldenOptions(c.options)), originalIndices(c))
      try {
        assert.deepEqual([meta.frameWidth, meta.frameHeight, meta.frameCount], [c.result.frame_width, c.result.frame_height, c.result.frame_count])
        const mine = frames(work, meta)
        for (const [index, frame] of c.frames.entries()) {
          const golden = await loadPng(frame.file)
          assert.deepEqual([mine[index].width, mine[index].height], [golden.width, golden.height])
          assert.equal(differingPixels(mine[index].data, golden.data), 0, `frame ${index}`)
        }
        const { sheet } = renderSheet(work, meta, { columns: c.options.columns, spacing: c.options.spacing, crop: null })
        const goldenSheet = await loadPng(c.outputs[0].file)
        assert.deepEqual([sheet.width, sheet.height], [goldenSheet.width, goldenSheet.height])
        if (c.outputs[0].file.endsWith('.png')) assert.equal(differingPixels(sheet.data, goldenSheet.data), 0, 'sheet')
        else {
          // Lossy WebP: same encoder settings, so the decoded result matches as well.
          const encoded = await sharp(await encodeStill(sheet, 'webp', c.options.output_quality)).ensureAlpha().raw().toBuffer()
          assert.equal(differingPixels(new Uint8Array(encoded), goldenSheet.data), 0, 'webp sheet')
        }
      } finally {
        fs.rmSync(work, { recursive: true, force: true })
      }
    })
  }

  await t.test('original error messages', async () => {
    for (const c of manifest.sheet_errors) {
      if (c.id === 'error_resize_contain_pad_then_despill') continue // D2, tested below
      const options = resolveExtractOptions(mapGoldenOptions(c.options))
      const expected = c.id === 'error_despill_two_colors'
        // D4 generalised despill to one colour of any kind; the message names that rule instead of magenta.
        ? '디스필은 색상 하나만 지정할 수 있습니다.'
        : c.message
      await assert.rejects(async () => {
        const { work } = await build(path.join(GOLDEN, c.input), options, c.id === 'error_count_exceeds_range' ? undefined : originalIndices(c))
        fs.rmSync(work, { recursive: true, force: true })
      }, { message: expected }, c.id)
    }
  })
})

test('sprite engine: despill unit vectors match the original bit for bit', async () => {
  for (const c of manifest.despill_unit) {
    const input = await loadPng(c.input)
    const run = () => despillFrame(input, { key: [255, 0, 255], tolerance: c.options.tolerance, softness: c.options.softness, edgeCleanup: c.options.edge_cleanup, frameNumber: 1 })
    if (c.raises) {
      assert.throws(run, { message: c.message }, c.id)
      continue
    }
    const golden = await loadPng(c.outputs[0].file)
    assert.equal(differingPixels(run(), golden.data), 0, c.id)
  }
})

test('sprite engine: normalisation matches pixels, metadata and manifests', async () => {
  const camel = (o: GoldenOptions) => ({ columns: o.columns, rows: o.rows, frameCount: o.frame_count, inputSpacing: o.input_spacing, outputColumns: o.output_columns, readOrder: o.read_order, customAnchorX: o.custom_anchor_x, customAnchorY: o.custom_anchor_y })
  const options = (o: GoldenOptions) => ({ mode: o.mode, alphaThreshold: o.alpha_threshold, padding: o.padding, outputSpacing: o.output_spacing, anchorPolicy: o.anchor_policy, outputFormat: o.output_format, outputQuality: o.output_quality })
  const sourcesOf = async (c: GoldenOptions) => {
    const sources: NormalizationSource[] = []
    for (const s of c.sources) sources.push({ image: await decodeImage(path.join(GOLDEN, s.input)), sourceName: s.source_name, outputStem: s.output_stem, relativePath: s.relative_path, options: camel(s.options) })
    return sources
  }
  for (const c of manifest.normalization) {
    const result = c.function?.includes('bulk') ? await normalizeSpriteSheetsBulk(await sourcesOf(c), options(c.options)) : await normalizeSpriteSheets(await sourcesOf(c), options(c.options))
    const dir = path.join(GOLDEN, 'sprite/normalize', c.id)
    for (const sheet of result.sheets) {
      const golden = await decodeImage(path.join(dir, path.basename(sheet.outputFilename)))
      assert.deepEqual([sheet.sheet.width, sheet.sheet.height], [golden.width, golden.height], `${c.id} size`)
      assert.ok(Buffer.from(sheet.sheet.data).equals(Buffer.from(golden.data)), `${c.id} pixels`)
      assert.deepEqual(sheet.metadata, JSON.parse(fs.readFileSync(path.join(dir, path.basename(sheet.metadataFilename)), 'utf8')), `${c.id} metadata`)
    }
    assert.deepEqual(result.manifest, JSON.parse(fs.readFileSync(path.join(dir, 'normalization-manifest.json'), 'utf8')), `${c.id} manifest`)
  }
  for (const c of manifest.normalization_errors) {
    const sources = await sourcesOf(c)
    await assert.rejects(async () => {
      if (c.function?.includes('bulk')) await normalizeSpriteSheetsBulk(sources, options(c.options))
      else await normalizeSpriteSheets(sources, options(c.options))
    }, { message: c.message }, c.id)
  }
})

test('sprite engine: animation frame count, size and timing', async () => {
  for (const c of manifest.animation) {
    const sheet = await decodeImage(path.join(GOLDEN, c.input))
    const result = await buildSpriteAnimation(sheet, { columns: c.options.columns, rows: c.options.rows, frameCount: c.options.frame_count, spacing: c.options.spacing, fps: c.options.fps, outputFormat: c.options.output_format, backgroundColor: c.options.background_color })
    assert.equal(result.mimeType, c.result.media_type, c.id)
    assert.deepEqual([result.frameCount, result.frameWidth, result.frameHeight], [c.result.frame_count, c.result.frame_width, c.result.frame_height], c.id)
    if (c.options.output_format === 'mp4') continue
    const metadata = await sharp(result.bytes, { animated: true }).metadata()
    assert.equal(metadata.pages, c.result.frame_count, c.id)
    assert.deepEqual(metadata.delay, c.decoded_frames.map((frame: { duration_ms: number }) => frame.duration_ms), `${c.id} delays`)
    if (c.options.output_format === 'webp') {
      // Lossless: every decoded frame matches the original's where it is visible.
      const mine = new Uint8Array(await sharp(result.bytes, { animated: true }).ensureAlpha().raw().toBuffer())
      const golden = new Uint8Array(await sharp(path.join(GOLDEN, c.outputs[0].file), { animated: true }).ensureAlpha().raw().toBuffer())
      assert.equal(differingPixels(mine, golden), 0, `${c.id} frames`)
    }
  }
})

test('D1: several key colours take the minimum alpha (the original let the last colorkey overwrite)', { timeout: 120000 }, async () => {
  const c = manifest.sheets.find((s: GoldenOptions) => s.id === 'colorkey_green_two_colors')
  const source = path.join(GOLDEN, c.input)
  const base = { ...mapGoldenOptions(c.options), autoCrop: false }
  const both = await build(source, resolveExtractOptions(base), originalIndices(c))
  const singles = await Promise.all(c.options.key_colors.map((color: string) => build(source, resolveExtractOptions({ ...base, keyColors: [color] }), originalIndices(c))))
  try {
    const mine = frames(both.work, both.meta)
    const perKey = singles.map((single: { work: string; meta: SpriteBuildMeta }) => frames(single.work, single.meta))
    let keyedByBoth = 0
    for (const [index, frame] of mine.entries()) {
      for (let offset = 0; offset < frame.data.length; offset += 4) {
        const expected = Math.min(...perKey.map((keyed: RgbaFrame[]) => keyed[index].data[offset + 3]))
        assert.equal(frame.data[offset + 3], expected)
        if (perKey.every((keyed: RgbaFrame[]) => keyed[index].data[offset + 3] === 0)) keyedByBoth += 1
      }
    }
    assert.equal(keyedByBoth, 0, 'the two colours are disjoint here, so each pixel is removed by exactly one key')
    const golden = await loadPng(c.frames[0].file)
    assert.notDeepEqual([both.meta.frameWidth, both.meta.frameHeight], [golden.width, golden.height], 'the original kept the green background')
  } finally {
    for (const run of [both, ...singles]) fs.rmSync(run.work, { recursive: true, force: true })
  }
})

test('D2: contain padding is added after keying, as transparent pixels, so contain + despill works', { timeout: 120000 }, async () => {
  const c = manifest.sheet_errors.find((s: GoldenOptions) => s.id === 'error_resize_contain_pad_then_despill')
  const run = await build(path.join(GOLDEN, c.input), resolveExtractOptions({ ...mapGoldenOptions(c.options), autoCrop: false }), originalIndices(c))
  try {
    assert.deepEqual([run.meta.frameWidth, run.meta.frameHeight, run.meta.frameCount], [64, 48, 8])
    for (const frame of frames(run.work, run.meta)) {
      for (let y = 0; y < frame.height; y += 1) {
        for (const x of [0, 7, 56, 63]) assert.equal(frame.data[(y * frame.width + x) * 4 + 3], 0, `pad pixel ${x},${y}`)
      }
    }
  } finally {
    fs.rmSync(run.work, { recursive: true, force: true })
  }
})

test('D3: interval sampling takes the frame nearest each sample time', () => {
  const info = { fps: 12, frameCount: 24, lastFrameTime: 23 / 12 } as SpriteVideoInfo
  assert.deepEqual(intervalModeIndices(info, 0, 1.916667, 0.25), [0, 3, 6, 9, 12, 15, 18, 21])
  // The original's fps filter picked [4, 8, 11, 15, 19, 22] here (one source frame late).
  assert.deepEqual(intervalModeIndices(info, 0, 1.75, 0.3), [0, 4, 7, 11, 14, 18])
  assert.deepEqual(intervalModeIndices(info, 0, 0.5, 0.05), [0, 1, 2, 3, 4, 5, 6], 'sub-frame intervals dedupe')
  assert.deepEqual(intervalModeIndices(info, 1.9, 1.95, 0.04), [23], 'clamped to the last frame')
})

test('D4: one key colour with despill for any colour; frozen port fixtures', { timeout: 120000 }, async () => {
  assert.equal(despillKeyKind([255, 0, 255]), 'hue')
  assert.equal(despillKeyKind([0, 255, 0]), 'hue')
  assert.equal(despillKeyKind([255, 128, 0]), 'difference')
  assert.equal(despillKeyKind([128, 128, 128]), 'distance')
  assert.equal(despillKeyKind([140, 128, 120]), 'distance', 'channel spread under 64/255 is too noisy for the difference key')
  assert.throws(() => despillFrame({ width: 4, height: 4, data: new Uint8Array(64).fill(255) }, { key: [0, 255, 0], tolerance: 0.08, softness: 0.92, edgeCleanup: true, frameNumber: 3 }),
    { message: '3번 프레임 외곽의 지정색 배경 비율이 0.0%로 너무 낮습니다. #00FF00 배경 영상을 확인하세요.' })
  for (const c of portManifest.cases) {
    const testCase = PORT_CASES.find((entry) => entry.id === c.id)
    assert.ok(testCase, c.id)
    const options = resolveExtractOptions(testCase.options)
    assert.equal(options.despill, true, `${c.id}: one colour defaults to despill`)
    const run = await build(resolveCaseInput(c.input), options)
    try {
      assert.deepEqual(run.meta.keptFrameIndices, c.frame_indices)
      const { sheet } = renderSheet(run.work, run.meta, { columns: options.columns, spacing: options.spacing, crop: null })
      assert.deepEqual([sheet.width, sheet.height], [c.result.sheet_width, c.result.sheet_height])
      assert.equal(rgbaSha256(sheet.data), c.output.rgba_sha256, c.id)
    } finally {
      fs.rmSync(run.work, { recursive: true, force: true })
    }
  }
})

test('D5: web defaults', () => {
  const single = resolveExtractOptions({})
  assert.deepEqual([single.keyColors, single.despill, single.tolerance, single.softness], [['#FF00FF'], true, 0.08, 0.92])
  const two = resolveExtractOptions({ keyColors: ['#00FF00', '#0000FF'] })
  assert.deepEqual([two.despill, two.tolerance, two.softness], [false, 0.1, 0.05])
  const keyOnly = resolveExtractOptions({ despill: false })
  assert.deepEqual([keyOnly.tolerance, keyOnly.softness], [0.1, 0.05])
  assert.equal(NORMALIZATION_DEFAULTS.padding, 2)
  assert.equal(ANIMATION_DEFAULTS.outputFormat, 'webp')
})

test('a decoded key that drifted past the tolerance still passes the border check and keys out', () => {
  // #FF00FF as an H.264 decode commonly returns it: (251,13,242) is raw 0.10, past the 0.08 default tolerance.
  const size = 32
  const data = new Uint8Array(size * size * 4)
  for (let index = 0; index < size * size; index += 1) {
    const x = index % size
    const y = Math.floor(index / size)
    const subject = x >= 10 && x < 22 && y >= 10 && y < 22
    const noise = (index * 7) % 3 - 1
    data.set(subject ? [40, 160, 60, 255] : [251 + noise, 13 + noise, 242 - noise, 255], index * 4)
  }
  const out = despillFrame({ width: size, height: size, data }, { key: [255, 0, 255], tolerance: 0.08, softness: 0.92, edgeCleanup: true, frameNumber: 1 })
  const alphaAt = (x: number, y: number) => out[(y * size + x) * 4 + 3]
  for (const [x, y] of [[0, 0], [31, 0], [3, 28], [16, 4]]) assert.equal(alphaAt(x, y), 0, `background (${x},${y}) is transparent`)
  assert.equal(alphaAt(16, 16), 255, 'the subject stays opaque')
  assert.deepEqual([...out.subarray((16 * size + 16) * 4, (16 * size + 16) * 4 + 3)], [40, 160, 60])
})

test('an H.264 magenta background decoded with the other colour matrix keys at tolerance 0.08', { timeout: 120000 }, async () => {
  // Encoded as BT.709 but untagged, so it decodes as BT.601: the background comes back near (233,0,243), raw 0.086.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sprite-drift-'))
  try {
    const source = path.join(work, 'drift.mp4')
    const { spawnSync } = await import('node:child_process')
    const made = spawnSync(ffmpegBinary(), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xFF00FF:s=96x96:r=4:d=2', '-vf', 'drawbox=x=32:y=32:w=32:h=32:color=0x30A040:t=fill,scale=out_color_matrix=bt709', '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', '-y', source])
    assert.equal(made.status, 0, made.stderr?.toString())
    const run = await build(source, resolveExtractOptions({ autoCrop: false }))
    try {
      const [frame] = frames(run.work, run.meta)
      const alphaAt = (x: number, y: number) => frame.data[(y * frame.width + x) * 4 + 3]
      assert.equal(alphaAt(0, 0), 0, 'the drifted background is keyed out')
      assert.equal(alphaAt(Math.floor(frame.width / 2), Math.floor(frame.height / 2)), 255, 'the subject stays')
    } finally {
      fs.rmSync(run.work, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
