import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Saved library searches keep every chip kind the search drawer makes, with the condition model/LoRA/tool chips stand for. */
test('search history keeps model, LoRA, AI tool and description chips', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-search-history-'))
  process.env.RUNTIME_BASE_PATH = root
  process.env.RUNTIME_DATABASE_DIR = path.join(root, 'database')
  const { SearchHistoryService } = await import('../src/services/searchHistoryService')
  const owner = { accountId: 7, isAdmin: false }

  const chips = [
    { id: 'm', scope: 'model', operator: 'AND', label: 'nai-diffusion-4-5', value: 'nai-diffusion-4-5', conditionCategory: 'basic', conditionType: 'model_name' },
    { id: 'l', scope: 'lora', operator: 'NOT', label: 'detail', value: 'detail', conditionCategory: 'basic', conditionType: 'lora_model' },
    { id: 't', scope: 'tool', operator: 'OR', label: 'ComfyUI', value: 'comfyui', conditionCategory: 'basic', conditionType: 'ai_tool_group' },
    { id: 'd', scope: 'meaning', operator: 'AND', label: '교복 입은 소녀', value: '교복 입은 소녀' },
    { id: 'r', scope: 'rating', operator: 'AND', label: 'G', value: 'G', minScore: 0, maxScore: 10, color: '#00ff00', extra: 'dropped' },
  ] as any[]
  const saved = SearchHistoryService.saveEntry(owner, { label: 'mixed', chips })
  assert.deepEqual(saved.chips.map((chip) => chip.scope), ['model', 'lora', 'tool', 'meaning', 'rating'])
  assert.equal(saved.chips[0].conditionType, 'model_name')
  assert.equal(saved.chips[2].conditionCategory, 'basic')
  assert.equal((saved.chips[4] as any).extra, undefined, 'fields history does not know are not stored')

  const listed = SearchHistoryService.listEntries(owner)
  assert.equal(listed.length, 1)
  assert.deepEqual(listed[0].chips, saved.chips, 'entries read back whole (an unknown scope would drop the entry)')

  // The same search saved again updates the entry instead of adding one.
  SearchHistoryService.saveEntry(owner, { label: 'mixed again', chips })
  assert.equal(SearchHistoryService.listEntries(owner).length, 1)

  // A chip with a condition type is a different search from the same text without one.
  SearchHistoryService.saveEntry(owner, { label: 'plain', chips: [{ id: 'p', scope: 'model', operator: 'AND', label: 'x', value: 'x' }] as any })
  SearchHistoryService.saveEntry(owner, { label: 'typed', chips: [{ id: 'q', scope: 'model', operator: 'AND', label: 'x', value: 'x', conditionCategory: 'basic', conditionType: 'model_name' }] as any })
  assert.equal(SearchHistoryService.listEntries(owner).length, 3)

  assert.throws(() => SearchHistoryService.saveEntry(owner, { label: 'bad', chips: [{ id: 'z', scope: 'nope', operator: 'AND', label: 'x', value: 'x' }] as any }), /At least one search chip/)
})
