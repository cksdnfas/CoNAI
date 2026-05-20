import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const markedFieldsEditorSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-marked-fields-editor.tsx'),
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

console.log('Comfy workflow authoring contracts verified.')