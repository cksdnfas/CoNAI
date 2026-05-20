import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const markedFieldsEditorSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx'),
  'utf8',
)
const authoringGraphSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-authoring-graph.tsx'),
  'utf8',
)

match(
  markedFieldsEditorSource,
  /const expandedFieldIdSet = useMemo\(\(\) => new Set\(expandedFieldIds\), \[expandedFieldIds\]\)/,
  'Comfy workflow marked-fields editor should memoize expanded field ids for list rendering',
)
match(
  markedFieldsEditorSource,
  /const isExpanded = expandedFieldIdSet\.has\(field\.id\)/,
  'Comfy workflow marked-fields rows should use Set.has for expansion membership',
)
doesNotMatch(
  markedFieldsEditorSource,
  /expandedFieldIds\.includes\(field\.id\)/,
  'Comfy workflow marked-fields rows must not scan expanded ids for every rendered field',
)
match(
  authoringGraphSource,
  /const markedJsonPathSet = useMemo\(\(\) => new Set\(data\.markedJsonPaths\), \[data\.markedJsonPaths\]\)/,
  'Comfy workflow authoring node cards should memoize marked JSON paths for input rendering',
)
match(
  authoringGraphSource,
  /const selected = markedJsonPathSet\.has\(path\)/,
  'Comfy workflow authoring inputs should use Set.has for marked-path membership',
)
doesNotMatch(
  authoringGraphSource,
  /markedJsonPaths\.includes\(path\)/,
  'Comfy workflow authoring inputs must not scan marked JSON paths for every rendered input',
)

console.log('Comfy workflow authoring contracts verified.')
