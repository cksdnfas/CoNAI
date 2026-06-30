import { doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const imageGenerationPageSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/image-generation-page.tsx'),
  'utf8',
)
const imageGenerationSharedSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/image-generation-shared.tsx'),
  'utf8',
)
const comfyGenerationPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-generation-panel.tsx'),
  'utf8',
)

match(
  imageGenerationPageSource,
  /useState<number \| null>\(null\)/,
  'ComfyUI tab entry should start on the workflow list, not a persisted workflow detail',
)
doesNotMatch(
  imageGenerationPageSource,
  /loadPersistedSelectedComfyWorkflowId/,
  'ComfyUI tab entry must not restore the last selected workflow from localStorage',
)
doesNotMatch(
  imageGenerationPageSource,
  /persistSelectedComfyWorkflowId/,
  'ComfyUI workflow selection should stay session-local and not persist across navigation',
)
match(
  imageGenerationPageSource,
  /if \(activeTab !== 'comfyui' && selectedComfyWorkflowId !== null\) \{\s*setSelectedComfyWorkflowId\(null\)\s*\}/,
  'Leaving the ComfyUI tab should clear the selected workflow before returning',
)
match(
  imageGenerationPageSource,
  /const imageGenerationTabs = useMemo\(\(\) => getImageGenerationTabs\(t\), \[t\]\)/,
  'Image-generation tab descriptors should stay memoized instead of forcing URL normalization work every render',
)
match(
  imageGenerationPageSource,
  /const visibleTabValues = useMemo\(\(\) => new Set\(visibleTabs\.map\(\(tab\) => tab\.value\)\), \[visibleTabs\]\)/,
  'Image-generation active-tab validation should use a memoized Set lookup',
)
doesNotMatch(
  imageGenerationPageSource,
  /visibleTabs\.some\(\(tab\) => tab\.value === parseImageGenerationTab\(searchParams\.get\('tab'\)\)\)/,
  'Image-generation active-tab validation should not rescan visible tabs while reparsing the URL tab',
)
doesNotMatch(
  imageGenerationSharedSource,
  /COMFY_SELECTED_WORKFLOW_STORAGE_KEY|loadPersistedSelectedComfyWorkflowId|persistSelectedComfyWorkflowId/,
  'Shared image-generation state should not keep a persisted ComfyUI selected-workflow contract',
)
match(
  imageGenerationSharedSource,
  /COMFY_WORKFLOW_DRAFT_STORAGE_KEY_PREFIX/,
  'ComfyUI workflow field drafts should remain persisted separately from selected workflow navigation state',
)
match(
  comfyGenerationPanelSource,
  /const navigate = useNavigate\(\)/,
  'ComfyUI module wrapping should have a direct route into graph workflow authoring after save',
)
match(
  comfyGenerationPanelSource,
  /navigate\('\/generation\?tab=workflows'\)/,
  'Saved ComfyUI modules should continue into the workflow graph entry tab',
)

console.log('Comfy workflow entry contracts verified.')
