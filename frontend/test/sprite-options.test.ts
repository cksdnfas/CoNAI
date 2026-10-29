import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_OUTPUT,
  MAX_KEY_COLORS,
  MAX_SHEET_DIMENSION,
  defaultExtractForm,
  toExtractOptions,
  withDespill,
} from '../src/features/sprite/sprite-options'
import {
  DEFAULT_ALPHA_THRESHOLD,
  MAX_KEY_COLORS as SERVER_MAX_KEY_COLORS,
  MAX_SHEET_DIMENSION as SERVER_MAX_SHEET_DIMENSION,
  resolveExtractOptions,
} from '../../backend/src/services/sprite/spriteOptions'
import { detectSheetGrid } from '../src/features/sprite/sprite-grid-detect'

test('sprite forms and server retain the same resource limits and alpha threshold', () => {
  const expected = { sheet: 16384, keyColors: 8, alpha: 20 }
  assert.deepEqual({
    sheet: MAX_SHEET_DIMENSION, keyColors: MAX_KEY_COLORS, alpha: defaultExtractForm().alphaThreshold,
  }, expected)
  assert.deepEqual({
    sheet: SERVER_MAX_SHEET_DIMENSION, keyColors: SERVER_MAX_KEY_COLORS, alpha: DEFAULT_ALPHA_THRESHOLD,
  }, expected)
})

test('sprite forms and API retain keying and despill defaults in extraction requests', () => {
  for (const expected of [
    { despill: false, tolerance: 0.1, softness: 0.05 },
    { despill: true, tolerance: 0.08, softness: 0.92 },
  ]) {
    const form = withDespill(defaultExtractForm(), expected.despill)
    const ui = toExtractOptions(form, null, DEFAULT_OUTPUT)
    const server = resolveExtractOptions({ despill: expected.despill })
    for (const options of [ui, server]) {
      assert.deepEqual({
        backgroundMode: options.backgroundMode, despill: options.despill, tolerance: options.tolerance,
        softness: options.softness, alphaThreshold: options.alphaThreshold,
      }, { backgroundMode: 'key', ...expected, alphaThreshold: 20 })
    }
  }
})

test('grid detection shares bounded decode slots and releases resources on success and failure', async t => {
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  let active = 0
  let peak = 0
  class MockImage {
    src = ''
    constructor() { active++; peak = Math.max(peak, active) }
    decode() { return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })) }
    removeAttribute() { active-- }
  }
  const pixels = new Uint8ClampedArray(8 * 8 * 4)
  for (const [x, y] of [[1, 1], [5, 1], [1, 5]]) pixels[(y * 8 + x) * 4 + 3] = 255
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: MockImage })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name: string) {
      assert.equal(name, 'canvas')
      return { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }
    },
  } })
  t.after(() => {
    if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage)
    else Reflect.deleteProperty(globalThis, 'Image')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  })

  const controller = new AbortController()
  const results = Array.from({ length: 5 }, (_, index) => detectSheetGrid(String(index), 8, 8, index === 2 ? controller.signal : undefined))
  await Promise.resolve()
  assert.equal(pending.length, 2)
  controller.abort()
  assert.deepEqual(await results[2], { columns: 1, rows: 1, frameCount: 1 })
  assert.equal(pending.length, 2)
  pending[1].reject(new Error('unreadable'))
  assert.deepEqual(await results[1], { columns: 1, rows: 1, frameCount: 1 })
  await Promise.resolve()
  assert.equal(pending.length, 3)
  pending[0].resolve()
  assert.deepEqual(await results[0], { columns: 2, rows: 2, frameCount: 3 })
  await Promise.resolve()
  assert.equal(pending.length, 4)
  pending[2].resolve()
  pending[3].resolve()
  assert.deepEqual(await Promise.all(results.slice(3)), [
    { columns: 2, rows: 2, frameCount: 3 },
    { columns: 2, rows: 2, frameCount: 3 },
  ])
  assert.equal(peak, 2)
})
