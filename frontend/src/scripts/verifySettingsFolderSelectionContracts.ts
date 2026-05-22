import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { equal } from 'node:assert/strict'

const __dirname = dirname(fileURLToPath(import.meta.url))
const foldersTabSource = readFileSync(resolve(__dirname, '../features/settings/components/folders-tab.tsx'), 'utf8')

equal(
  foldersTabSource.includes('const foldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder] as const)), [folders])'),
  true,
  'Folders tab should memoize watched folder id lookups for detail selection',
)
equal(
  foldersTabSource.includes('const backupSourcesById = useMemo(() => new Map(backupSources.map((source) => [source.id, source] as const)), [backupSources])'),
  true,
  'Folders tab should memoize backup source id lookups for detail selection',
)
equal(
  foldersTabSource.includes('foldersById.get(selectedFolderId)'),
  true,
  'Selected watched folder lookup should use the memoized id map',
)
equal(
  foldersTabSource.includes('backupSourcesById.get(selectedBackupSourceId)'),
  true,
  'Selected backup source lookup should use the memoized id map',
)
equal(
  foldersTabSource.includes('foldersById.has(selectedFolderId)'),
  true,
  'Watched folder selection cleanup should use the memoized id map',
)
equal(
  foldersTabSource.includes('backupSourcesById.has(selectedBackupSourceId)'),
  true,
  'Backup source selection cleanup should use the memoized id map',
)
equal(
  foldersTabSource.includes('folders.find((folder) => folder.id === selectedFolderId)'),
  false,
  'Folders tab should not rescan watched folders to resolve the selected detail row',
)
equal(
  foldersTabSource.includes('backupSources.find((source) => source.id === selectedBackupSourceId)'),
  false,
  'Folders tab should not rescan backup sources to resolve the selected detail row',
)
equal(
  foldersTabSource.includes('folders.some((folder) => folder.id === selectedFolderId)'),
  false,
  'Folders tab should not rescan watched folders to clean stale selection ids',
)
equal(
  foldersTabSource.includes('backupSources.some((source) => source.id === selectedBackupSourceId)'),
  false,
  'Folders tab should not rescan backup sources to clean stale selection ids',
)

console.log('Settings folder selection lookup contracts verified')
