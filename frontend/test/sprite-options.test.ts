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
