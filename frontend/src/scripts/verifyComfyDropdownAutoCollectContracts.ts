import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const comfyHomeSectionsSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-home-sections.tsx'),
  'utf8',
)
const comfyGenerationPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-generation-panel.tsx'),
  'utf8',
)
const comfyWorkflowControllerPanelSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/comfy-workflow-controller-panel.tsx'),
  'utf8',
)
const workflowFieldDisclosureCardSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-disclosure-card.tsx'),
  'utf8',
)
const workflowFieldInputSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/workflow-field-input.tsx'),
  'utf8',
)
const pathOptionTreeSelectSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/path-option-tree-select.tsx'),
  'utf8',
)
const powerLoraLoaderInputSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/power-lora-loader-input.tsx'),
  'utf8',
)
const powerLoraLoaderUtilsSource = readFileSync(
  resolve(process.cwd(), 'src/features/image-generation/components/power-lora-loader-utils.ts'),
  'utf8',
)
const moduleGraphPowerLoraLoaderInputSource = readFileSync(
  resolve(process.cwd(), 'src/features/module-graph/components/power-lora-loader-input.tsx'),
  'utf8',
)
const imageGenerationResourcesSource = readFileSync(
  resolve(process.cwd(), 'src/i18n/resources/image-generation.ts'),
  'utf8',
)
const imageGenerationWorkflowsApiSource = readFileSync(
  resolve(process.cwd(), 'src/lib/api-image-generation-workflows.ts'),
  'utf8',
)

const autoCollectModalMatch = comfyHomeSectionsSource.match(
  /function ComfyDropdownAutoCollectModal[\s\S]*?\r?\n}\r?\n\r?\nexport function ComfyDropdownListsSection/,
)
assert.ok(autoCollectModalMatch, 'Comfy dropdown auto-collect modal source should be discoverable')
const autoCollectModalSource = autoCollectModalMatch[0]

for (const defaultPath of ['/models/checkpoints', '/models/diffusion_models', '/models/unet_gguf', '/models/loras']) {
  assert.match(
    imageGenerationWorkflowsApiSource,
    new RegExp(defaultPath.replace(/\//g, '\\/')),
    `Comfy dropdown auto-collect should expose default API path ${defaultPath}`,
  )
}

assert.match(
  comfyHomeSectionsSource,
  /<Textarea[\s\S]*value=\{apiPathText\}[\s\S]*onChange=\{\(event\) => setApiPathText\(event\.target\.value\)\}/,
  'auto-collect should use a textarea-driven API path list',
)

assert.match(
  comfyHomeSectionsSource,
  /기본값 초기화/,
  'auto-collect should provide a default reset action',
)

assert.match(
  comfyHomeSectionsSource,
  /await onSubmit\(\{ apiPaths \}\)/,
  'auto-collect should submit API paths, not client-selected folder files',
)

assert.match(
  comfyHomeSectionsSource,
  /통합 \+ 개별 생성[\s\S]*하위 폴더 통합|하위 폴더 통합[\s\S]*통합 \+ 개별 생성/,
  'auto-collect should tell users the fixed merge options are always applied',
)

assert.doesNotMatch(
  autoCollectModalSource,
  /SettingsInsetBlock|<Alert|AlertTitle|AlertDescription/,
  'auto-collect modal should not nest extra card/alert surfaces inside the modal shell',
)

assert.doesNotMatch(
  comfyHomeSectionsSource,
  /webkitdirectory|directory'|directory"|FolderOpen|modelFolders:|mergeSubfolders\?:|createBoth\?:|collectModelFoldersFromSelection/,
  'auto-collect UI should not expose legacy folder-upload or merge option controls',
)

assert.match(
  imageGenerationWorkflowsApiSource,
  /export const DEFAULT_COMFY_MODEL_API_PATHS = \[/,
  'default ComfyUI model API paths should be shared by modal and inline refresh controls',
)
for (const pattern of [/onRefresh\?: \(\) => Promise<void> \| void/, /stopPropagation\(\)/, /RotateCcw/, /aria-label=\{refreshLabel\}/]) {
  assert.match(
    pathOptionTreeSelectSource,
    pattern,
    'path tree selects should support an inline refresh button without toggling the dropdown',
  )
}
assert.match(
  pathOptionTreeSelectSource,
  /const selectedLabel = selectedNode\?\.label \?\? \(value \? getOptionDisplayLabel\(value\) : placeholder\)/,
  'path tree selects should show only the selected node label, including the placeholder label',
)
assert.doesNotMatch(
  pathOptionTreeSelectSource,
  /fullPath|selectedPath|text-\[11px\] text-muted-foreground/,
  'path tree selects should not render full paths under checkpoint or LoRA file names',
)
assert.match(
  workflowFieldInputSource,
  /<PathOptionTreeSelect[\s\S]*refreshLabel="ComfyUI 자동수집 새로고침"[\s\S]*onRefresh=\{onRefreshOptions\}/,
  'path-like ComfyUI dropdown fields should expose the shared auto-collect refresh action',
)
assert.match(
  powerLoraLoaderUtilsSource,
  /POWER_LORA_AUTO_COLLECTED_LIST_NAME = 'loras \(통합\)'[\s\S]*buildAddedPowerLoraNodeValue[\s\S]*\[buildNextPowerLoraKey\(nodeValue\)\][\s\S]*strength: 1/,
  'Power Lora Loader add action should append lora_N rows from the auto-collected merged LoRA list',
)
assert.match(
  powerLoraLoaderUtilsSource,
  /buildRemovedPowerLoraNodeValue[\s\S]*delete nextNodeValue\[itemKey\][\s\S]*return nextNodeValue/,
  'Power Lora Loader remove action should delete one selected LoRA row without clearing the full node value',
)
for (const pattern of [/LoRA 추가/, /<PathOptionTreeSelect/, /findAutoCollectedPowerLoraOptions/, /scanGenerationComfyUIModelDropdownLists\(\{ apiPaths: DEFAULT_COMFY_MODEL_API_PATHS \}\)/, /onRefresh=\{handleRefreshLoraOptions\}/]) {
  assert.match(
    powerLoraLoaderInputSource,
    pattern,
    'Power Lora Loader should provide Add LoRA plus inline auto-collect refresh from the merged LoRA list',
  )
}
assert.match(
  powerLoraLoaderInputSource,
  /\{addLoraControl\}[\s\S]*\{nodeItems\.map\(\(item\) =>/,
  'Power Lora Loader should keep Add LoRA above existing rows so it stays visible near the field header',
)
assert.match(
  powerLoraLoaderInputSource,
  /const addLoraControl = \([\s\S]*<PathOptionTreeSelect[\s\S]*placeholder=\{fallbackDropdownListsQuery\.isLoading \?[^}]*LoRA 목록 불러오는 중[\s\S]*LoRA 추가/,
  'Power Lora Loader should render Add LoRA as the always-visible dropdown trigger, not a two-step button',
)
for (const pattern of [/Trash2/, /handleRemoveLora/, /buildRemovedPowerLoraNodeValue/, /power\.lora\.loader\.input\.delete\.lora/]) {
  assert.match(
    powerLoraLoaderInputSource,
    pattern,
    'Power Lora Loader rows should expose an icon-only delete action for one LoRA entry',
  )
}
assert.match(
  moduleGraphPowerLoraLoaderInputSource,
  /PowerLoraLoaderInput[\s\S]*buildRemovedPowerLoraNodeValue/,
  'module graph Power Lora Loader fields should re-export the shared remove helper for compact runtime rows',
)
for (const pattern of [
  /"image-generation\.components\.power\.lora\.loader\.input\.delete\.lora": "로라 삭제: \{label\}"/,
  /"image-generation\.components\.power\.lora\.loader\.input\.delete\.lora": "Remove LoRA: \{label\}"/,
]) {
  assert.match(
    imageGenerationResourcesSource,
    pattern,
    'Power Lora Loader delete action should keep localized accessible labels',
  )
}
assert.doesNotMatch(
  powerLoraLoaderInputSource,
  /isAddingLora|setIsAddingLora|LoRA 선택|<Button/,
  'Power Lora Loader should not require a button click before showing the LoRA dropdown',
)
assert.match(
  comfyGenerationPanelSource,
  /findAutoCollectedPowerLoraOptions\(dropdownListsQuery\.data \?\? \[\]\)[\s\S]*isRefreshingDropdownLists[\s\S]*onRefreshDropdownLists=\{handleRefreshDropdownLists\}/,
  'Comfy workflow runtime fields should receive shared LoRA options and one refresh action from the panel',
)
assert.match(
  comfyWorkflowControllerPanelSource,
  /loraOptions\?: string\[\][\s\S]*onRefreshDropdownLists\?: \(\) => Promise<void> \| void[\s\S]*<WorkflowFieldDisclosureCard[\s\S]*loraOptions=\{loraOptions\}[\s\S]*onRefreshOptions=\{onRefreshDropdownLists\}/,
  'Comfy workflow controller should pass dropdown refresh wiring to each field card',
)
assert.match(
  workflowFieldDisclosureCardSource,
  /loraOptions\?: string\[\][\s\S]*onRefreshOptions\?: \(\) => Promise<void> \| void[\s\S]*<WorkflowFieldInput[\s\S]*loraOptions=\{loraOptions\}[\s\S]*onRefreshOptions=\{onRefreshOptions\}/,
  'field disclosure cards should preserve dropdown refresh wiring for expanded field inputs',
)

console.log('Comfy dropdown API auto-collect UI contracts verified.')
