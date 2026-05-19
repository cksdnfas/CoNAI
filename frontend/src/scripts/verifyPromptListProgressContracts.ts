import { deepEqual, doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePromptListProgress } from '../features/prompts/prompt-list-progress'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const firstPage = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 40, totalCount: 125 })
deepEqual(firstPage, {
  start: 1,
  end: 40,
  visibleCount: 40,
  totalCount: 125,
  hiddenCount: 85,
})

const lastPage = resolvePromptListProgress({ page: 3, pageSize: 40, visibleCount: 30, totalCount: 110 })
deepEqual(lastPage, {
  start: 81,
  end: 110,
  visibleCount: 30,
  totalCount: 110,
  hiddenCount: 0,
})

const empty = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolvePromptListProgress({ page: 99, pageSize: 40, visibleCount: 5, totalCount: 45 })
deepEqual(clamped, {
  start: 41,
  end: 45,
  visibleCount: 5,
  totalCount: 45,
  hiddenCount: 0,
})

const promptPageSource = source('features/prompts/prompt-page.tsx')
const promptListPanelSource = source('features/prompts/components/prompt-list-panel.tsx')

match(
  promptPageSource,
  /const selectedPromptIdSet = useMemo\(\(\) => new Set\(selectedPromptIds\), \[selectedPromptIds\]\)/,
  'PromptPage should build one memoized selected-prompt Set per selectedIds snapshot',
)
match(
  promptPageSource,
  /items\.filter\(\(item\) => selectedPromptIdSet\.has\(item\.id\)\)/,
  'selected prompt item derivation should reuse Set.has instead of scanning selectedPromptIds per item',
)
match(
  promptPageSource,
  /<PromptListPanel[\s\S]*?selectedPromptIdSet=\{selectedPromptIdSet\}/,
  'PromptPage should pass the memoized selected-prompt Set into the list panel',
)
doesNotMatch(
  promptPageSource,
  /items\.filter\(\(item\) => selectedPromptIds\.includes\(item\.id\)\)/,
  'PromptPage selected item derivation must not scan selectedPromptIds for every visible prompt',
)

match(
  promptListPanelSource,
  /selectedPromptIdSet: ReadonlySet<number>/,
  'PromptListPanel contract should accept a readonly selected-prompt Set',
)
match(
  promptListPanelSource,
  /selected=\{selectedPromptIdSet\.has\(item\.id\)\}/,
  'PromptListPanel rows should use Set.has for rendered selected state',
)
doesNotMatch(
  promptListPanelSource,
  /selectedPromptIds\.includes\(item\.id\)/,
  'PromptListPanel rendering must not scan the selectedPromptIds array per row',
)

console.log('Prompt list progress and selection contracts verified')
