import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WildcardRecord } from '../src/lib/api-wildcards'
import {
  countWildcardItemsForTool,
  flattenWildcardRecords,
  resolvePreferredWildcardItemTool,
} from '../src/features/image-generation/components/wildcard-inline-picker-helpers'
import { detectPromptSyntaxTokens } from '../src/features/image-generation/components/prompt-syntax-highlight-helpers'

test('summary-only wildcards retain inline counts, fallback tools and lazy preview targets', () => {
  const base: WildcardRecord = {
    id: 1, name: 'pose', parent_id: null, include_children: 0, only_children: 0,
    type: 'chain', chain_option: 'replace', created_date: '', updated_date: '',
    item_counts: { general: 12, nai: 4, comfyui: 0 },
    children: [{
      id: 2, name: 'child', parent_id: 1, include_children: 0, only_children: 0,
      type: 'wildcard', chain_option: 'replace', created_date: '', updated_date: '',
      item_counts: { general: 0, nai: 0, comfyui: 0 },
    }],
  }
  const records = flattenWildcardRecords([base])
  assert.equal(records.length, 2)
  assert.deepEqual(records[1].path, ['pose', 'child'])
  assert.deepEqual(records[0].itemCounts, { general: 12, nai: 4, comfyui: 0 })
  assert.equal(countWildcardItemsForTool(records[0].itemCounts, 'nai'), 4)
  assert.equal(countWildcardItemsForTool(records[0].itemCounts, 'comfyui'), 12)
  assert.equal(countWildcardItemsForTool(records[0].itemCounts, 'codex'), 12)
  assert.equal(resolvePreferredWildcardItemTool(records[0].itemCounts, 'nai'), 'nai')
  assert.equal(resolvePreferredWildcardItemTool(records[0].itemCounts, 'comfyui'), 'general')
  const tokens = detectPromptSyntaxTokens('pose, //note//', records, 'comfyui')
  assert.equal(tokens[0].wildcardId, 1, 'only the opened token needs its item pool')
  assert.equal(tokens[0].toolItemCount, 12)
  assert.equal(tokens[0].naiItemCount, 4)
  assert.equal(tokens[1].wildcardId, null, 'comments do not load wildcard items')

  const legacy = flattenWildcardRecords([{
    ...base, item_counts: undefined,
    items: [{ id: 10, wildcard_id: 1, tool: 'nai', content: 'seated', weight: 1, order_index: 0, created_date: '' }],
  }])
  assert.deepEqual(legacy[0].itemCounts, { general: 0, nai: 1, comfyui: 0 }, 'full-record consumers remain compatible')
})
