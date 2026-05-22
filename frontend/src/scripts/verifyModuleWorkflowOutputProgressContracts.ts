import { deepEqual, doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveModuleWorkflowOutputProgress } from '../features/module-graph/module-workflow-output-progress'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const firstPage = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(firstPage, {
  start: 1,
  end: 50,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 130,
})

const middlePage = resolveModuleWorkflowOutputProgress({ page: 2, pageSize: 50, visibleCount: 50, totalCount: 180 })
deepEqual(middlePage, {
  start: 51,
  end: 100,
  visibleCount: 50,
  totalCount: 180,
  hiddenCount: 80,
})

const lastPage = resolveModuleWorkflowOutputProgress({ page: 4, pageSize: 50, visibleCount: 30, totalCount: 180 })
deepEqual(lastPage, {
  start: 151,
  end: 180,
  visibleCount: 30,
  totalCount: 180,
  hiddenCount: 0,
})

const empty = resolveModuleWorkflowOutputProgress({ page: 1, pageSize: 50, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolveModuleWorkflowOutputProgress({ page: 99, pageSize: 50, visibleCount: 5, totalCount: 55 })
deepEqual(clamped, {
  start: 51,
  end: 55,
  visibleCount: 5,
  totalCount: 55,
  hiddenCount: 0,
})

const outputManagementSource = source('features/module-graph/components/module-workflow-output-management-panel.tsx')
const artifactRecordsSource = source('features/module-graph/components/module-workflow-artifact-records-tab.tsx')
const generatedOutputsSource = source('features/module-graph/components/module-workflow-generated-outputs-tab.tsx')

match(
  outputManagementSource,
  /const selectedOutputIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedOutputIds\)[\s\S]*?\[selectedOutputIds\][\s\S]*?\)/,
  'workflow output management should memoize selected output ids for bulk lookups',
)
match(
  outputManagementSource,
  /const selectedArtifactIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedArtifactIds\)[\s\S]*?\[selectedArtifactIds\][\s\S]*?\)/,
  'workflow output management should memoize selected artifact ids for bulk lookups',
)
match(
  outputManagementSource,
  /selectedOutputIdSet\.has\(item\.id\)/,
  'selected output derivation should use Set.has instead of scanning selectedOutputIds',
)
match(
  outputManagementSource,
  /selectedArtifactIdSet\.has\(artifact\.id\)/,
  'selected artifact derivation should use Set.has instead of scanning selectedArtifactIds',
)
match(
  outputManagementSource,
  /const pagedOutputIdSet = useMemo\([\s\S]*?new Set\(pagedOutputItems\.map\(\(item\) => item\.id\)\)[\s\S]*?\[pagedOutputItems\][\s\S]*?\)/,
  'paged output ids should be indexed once for visible image and clear-selection lookups',
)
match(
  outputManagementSource,
  /const outputItemIdSet = useMemo\([\s\S]*?new Set\(outputCollections\.outputItems\.map\(\(item\) => item\.id\)\)[\s\S]*?\[outputCollections\.outputItems\][\s\S]*?\)/,
  'all output ids should be indexed once for stale-selection pruning',
)
match(
  outputManagementSource,
  /const pagedArtifactIdSet = useMemo\([\s\S]*?new Set\(pagedTechnicalArtifacts\.map\(\(artifact\) => artifact\.id\)\)[\s\S]*?\[pagedTechnicalArtifacts\][\s\S]*?\)/,
  'paged artifact ids should be indexed once for clear-selection lookups',
)
match(
  outputManagementSource,
  /const filteredArtifactIdSet = useMemo\([\s\S]*?new Set\(filteredTechnicalArtifacts\.map\(\(artifact\) => artifact\.id\)\)[\s\S]*?\[filteredTechnicalArtifacts\][\s\S]*?\)/,
  'filtered artifact ids should be indexed once for stale-selection pruning',
)
doesNotMatch(
  outputManagementSource,
  /selectedOutputIds\.includes\(item\.id\)/,
  'workflow output management must not scan selectedOutputIds per output item',
)
doesNotMatch(
  outputManagementSource,
  /selectedArtifactIds\.includes\(artifact\.id\)/,
  'workflow output management must not scan selectedArtifactIds per artifact item',
)
match(
  outputManagementSource,
  /current\.filter\(\(id\) => outputItemIdSet\.has\(id\)\)/,
  'selected output pruning should use the memoized all-output id Set',
)
match(
  outputManagementSource,
  /current\.filter\(\(id\) => filteredArtifactIdSet\.has\(id\)\)/,
  'selected artifact pruning should use the memoized filtered-artifact id Set',
)
doesNotMatch(
  outputManagementSource,
  /outputCollections\.outputItems\.some\(\(item\) => item\.id === id\)/,
  'selected output pruning must not rescan all output items for every selected id',
)
doesNotMatch(
  outputManagementSource,
  /filteredTechnicalArtifacts\.some\(\(artifact\) => artifact\.id === id\)/,
  'selected artifact pruning must not rescan all filtered artifacts for every selected id',
)

match(
  artifactRecordsSource,
  /const selectedArtifactIdSet = useMemo\([\s\S]*?\(\) => new Set\(selectedArtifactIds\)[\s\S]*?\[selectedArtifactIds\][\s\S]*?\)/,
  'artifact records tab should build one selected-artifact Set per selected ids snapshot',
)
match(
  artifactRecordsSource,
  /const isSelected = selectedArtifactIdSet\.has\(artifact\.id\)/,
  'artifact record row selected state should use Set.has for paged row rendering',
)
doesNotMatch(
  artifactRecordsSource,
  /selectedArtifactIds\.includes\(artifact\.id\)/,
  'artifact record row rendering must not scan selectedArtifactIds per artifact row',
)

match(
  outputManagementSource,
  /const handleDownloadItems = useCallback\(\(items: ModuleWorkflowGeneratedOutputItem\[\]\) => \{[\s\S]*?setIsDownloading\(false\)[\s\S]*?\}, \[\]\)/,
  'generated-output download handler should keep a stable identity for image-grid overlay renderers',
)
match(
  generatedOutputsSource,
  /const selectedCopyTargetFolder = useMemo\([\s\S]*?watchedFolders\.find\(\(folder\) => String\(folder\.id\) === copyTargetFolderId\)[\s\S]*?\[copyTargetFolderId, watchedFolders\][\s\S]*?\)/,
  'generated outputs tab should resolve the selected copy target once per folder snapshot',
)
match(
  generatedOutputsSource,
  /const getGeneratedOutputImageId = useCallback\(\(image: ImageRecord\) => String\(image\.id\), \[\]\)/,
  'generated outputs tab should pass a stable image id resolver into ImageList',
)
match(
  generatedOutputsSource,
  /const renderGeneratedOutputOverlay = useCallback\(\(image: ImageRecord\) => \{[\s\S]*?outputItemById\.get\(String\(image\.id\)\)[\s\S]*?\[isDownloading, onDownloadItems, outputItemById, t\][\s\S]*?\)/,
  'generated outputs tab should memoize image-grid overlay rendering around the output lookup map',
)
match(
  generatedOutputsSource,
  /getItemId=\{getGeneratedOutputImageId\}/,
  'generated outputs ImageList should consume the stable image id resolver',
)
match(
  generatedOutputsSource,
  /renderItemOverlay=\{renderGeneratedOutputOverlay\}/,
  'generated outputs ImageList should consume the stable overlay renderer',
)
doesNotMatch(
  generatedOutputsSource,
  /renderItemOverlay=\{\(image\) =>/,
  'generated outputs ImageList must not recreate its overlay renderer inline',
)
doesNotMatch(
  generatedOutputsSource,
  /\{watchedFolders\.find\(\(folder\) => String\(folder\.id\) === copyTargetFolderId\)\?\.folder_path\}/,
  'generated outputs copy panel must not scan watched folders inside render output',
)

console.log('Module workflow output progress contracts verified')
