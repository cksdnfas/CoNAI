import { deepEqual } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDanbooruBrowserProgress } from '../features/prompts/danbooru-browser-progress'

const __dirname = dirname(fileURLToPath(import.meta.url))

const firstTagPage = resolveDanbooruBrowserProgress({ page: 1, pageSize: 50, visibleCount: 50, totalCount: 2400 })
deepEqual(firstTagPage, {
  start: 1,
  end: 50,
  visibleCount: 50,
  totalCount: 2400,
  hiddenCount: 2350,
})

const filteredArtistPage = resolveDanbooruBrowserProgress({ page: 3, pageSize: 50, visibleCount: 12, totalCount: 112 })
deepEqual(filteredArtistPage, {
  start: 101,
  end: 112,
  visibleCount: 12,
  totalCount: 112,
  hiddenCount: 0,
})

const characterPage = resolveDanbooruBrowserProgress({ page: 2, pageSize: 30, visibleCount: 30, totalCount: 75 })
deepEqual(characterPage, {
  start: 31,
  end: 60,
  visibleCount: 30,
  totalCount: 75,
  hiddenCount: 15,
})

const emptySearch = resolveDanbooruBrowserProgress({ page: 1, pageSize: 50, visibleCount: 0, totalCount: 0 })
deepEqual(emptySearch, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const panelSource = readFileSync(resolve(__dirname, '../features/prompts/components/prompt-danbooru-browser-panel.tsx'), 'utf8')
const requiredStableCallbacks = [
  'const getNodeLabel = useCallback',
  'const sortTreeItems = useCallback',
  'const renderTreeIcon = useCallback',
  'const handleSearchInputChange = useCallback',
  'const handleToggleRelatedTagOptionsOpen = useCallback',
]

for (const callback of requiredStableCallbacks) {
  if (!panelSource.includes(callback)) {
    throw new Error(`Danbooru browser panel should keep ${callback} stable`)
  }
}

if (panelSource.includes('tagsQuery.data?.items ?? []} language={language}')) {
  throw new Error('Danbooru browser tables should receive memoized empty item arrays')
}

console.log('Danbooru browser progress contracts verified')
