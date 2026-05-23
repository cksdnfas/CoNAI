import { readFileSync } from 'node:fs'
import type { ModuleAuthoringSource, ModuleDefinitionRecord, ModuleEngineType, ModulePortDefinition } from '../lib/api-module-graph'
import {
  CUSTOM_NODE_GROUP_ORDER,
  CUSTOM_NODE_GROUP_ORDER_INDEX,
  SAVED_MODULE_GROUP_ORDER,
  SAVED_MODULE_GROUP_ORDER_INDEX,
  SYSTEM_GROUP_ORDER,
  SYSTEM_GROUP_ORDER_INDEX,
  getCustomNodeGroup,
  getModuleGroupSortIndex,
  getSavedModuleGroup,
  getSystemModuleGroup,
  isCustomNodeModule,
  isGenerationModule,
  shouldHideFromModuleLibrary,
} from '../features/module-graph/components/module-library-groups'

const textInputPort: ModulePortDefinition = {
  key: 'prompt',
  label: 'Prompt',
  direction: 'input',
  data_type: 'text',
  required: true,
  multiple: false,
}

const imageOutputPort: ModulePortDefinition = {
  key: 'image',
  label: 'Image',
  direction: 'output',
  data_type: 'image',
  required: true,
  multiple: false,
}

function makeModule(overrides: Partial<ModuleDefinitionRecord> & Pick<ModuleDefinitionRecord, 'id' | 'name'>): ModuleDefinitionRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? null,
    engine_type: overrides.engine_type ?? 'system',
    authoring_source: overrides.authoring_source ?? 'manual',
    category: overrides.category ?? null,
    source_workflow_id: overrides.source_workflow_id ?? null,
    template_defaults: overrides.template_defaults ?? {},
    exposed_inputs: overrides.exposed_inputs ?? [textInputPort],
    output_ports: overrides.output_ports ?? [imageOutputPort],
    internal_fixed_values: overrides.internal_fixed_values ?? null,
    ui_schema: overrides.ui_schema ?? null,
    version: overrides.version ?? 1,
    is_active: overrides.is_active ?? true,
    color: overrides.color ?? null,
    external_key: overrides.external_key ?? null,
    source_path: overrides.source_path ?? null,
    source_hash: overrides.source_hash ?? null,
    created_date: overrides.created_date ?? '2026-05-14T00:00:00.000Z',
    updated_date: overrides.updated_date ?? '2026-05-14T00:00:00.000Z',
  }
}

function makeGenerationSystemModule(id: number, name: string, operationKey: string) {
  return makeModule({
    id,
    name,
    engine_type: 'system',
    authoring_source: 'manual',
    category: 'generation',
    internal_fixed_values: { operation_key: operationKey },
  })
}

function makeSavedModule(id: number, engineType: ModuleEngineType, authoringSource: ModuleAuthoringSource, category = 'generation') {
  return makeModule({
    id,
    name: `${engineType} saved module`,
    engine_type: engineType,
    authoring_source: authoringSource,
    category,
  })
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertGroup(group: { key: string; label: string }, expectedKey: string, expectedLabel: string, label: string) {
  assert(group.key === expectedKey, `${label}: expected group key ${expectedKey}, got ${group.key}`)
  assert(group.label === expectedLabel, `${label}: expected group label ${expectedLabel}, got ${group.label}`)
}

function assertOrderIndex(groupOrder: readonly string[], groupOrderIndex: ReadonlyMap<string, number>, label: string) {
  for (const [expectedIndex, groupKey] of groupOrder.entries()) {
    assert(
      getModuleGroupSortIndex(groupOrderIndex, groupKey) === expectedIndex,
      `${label}: expected ${groupKey} to sort at index ${expectedIndex}`,
    )
  }
}

function assertModuleLibrarySortUsesOrderIndexes() {
  const panelSource = readFileSync(new URL('../features/module-graph/components/module-library-panel.tsx', import.meta.url), 'utf8')
  const quickCreateSource = readFileSync(new URL('../features/module-graph/components/module-graph-quick-create-menu.tsx', import.meta.url), 'utf8')

  assert(
    panelSource.includes('getModuleGroupSortIndex(groupOrderIndex'),
    'module library panel group sorting should use the precomputed group-order index',
  )
  assert(!panelSource.includes('orderedKeys.indexOf'), 'module library panel group sorting must not scan orderedKeys in the comparator')
  assert(
    panelSource.includes('const collapsedGroupKeySet = useMemo(() => new Set(collapsedGroupKeys), [collapsedGroupKeys])'),
    'module library panel should memoize collapsed group keys before rendering groups',
  )
  assert(
    panelSource.includes('collapsedGroupKeySet.has(scopedKey)'),
    'module library panel group rendering should use Set.has for collapsed-state lookups',
  )
  assert(!panelSource.includes('const isCollapsed = collapsedGroupKeys.includes(scopedKey)'), 'module library panel group rendering must not scan collapsedGroupKeys per group')
  assert(
    quickCreateSource.includes('getModuleGroupSortIndex(groupOrderIndex'),
    'quick create menu group sorting should use the precomputed group-order index',
  )
  assert(!quickCreateSource.includes('groupOrder.indexOf'), 'quick create menu group sorting must not scan groupOrder in the comparator')
}

const fixedNai = makeGenerationSystemModule(1, 'NovelAI image generation', 'system.generate_image_nai')
const fixedCodex = makeGenerationSystemModule(2, 'Codex image generation', 'system.generate_image_codex')
const savedComfy = makeSavedModule(3, 'comfyui', 'comfyui_workflow_wrap')
const customNode = makeSavedModule(4, 'custom_js', 'custom_node_fs', 'custom-js')
const legacyNaiSnapshot = makeSavedModule(5, 'nai', 'nai_form_snapshot')
const legacyCodexSnapshot = makeSavedModule(6, 'codex', 'codex_form_snapshot')
const constantText = makeModule({
  id: 7,
  name: 'Constant text',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'input',
  internal_fixed_values: { operation_key: 'system.constant_text' },
  output_ports: [{ ...textInputPort, direction: 'output' }],
})
const constantPrompt = makeModule({
  id: 8,
  name: 'Constant prompt',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'input',
  internal_fixed_values: { operation_key: 'system.constant_prompt' },
  output_ports: [{ ...textInputPort, direction: 'output' }],
})
const llmPresetLoader = makeModule({
  id: 9,
  name: 'LLM 프리셋 불러오기',
  engine_type: 'system',
  authoring_source: 'manual',
  category: 'llm',
  internal_fixed_values: { operation_key: 'system.load_llm_preset' },
})

for (const module of [fixedNai, fixedCodex]) {
  assert(!shouldHideFromModuleLibrary(module), `${module.name}: fixed generation system module must stay visible`)
  assert(isGenerationModule(module), `${module.name}: fixed generation system module must classify as generation`)
  assert(!isCustomNodeModule(module), `${module.name}: fixed generation system module must not classify as custom node`)
  assertGroup(getSystemModuleGroup(module), 'generation', 'Generation', module.name)
}

assert(!shouldHideFromModuleLibrary(savedComfy), 'saved ComfyUI module must stay visible')
assert(isGenerationModule(savedComfy), 'saved ComfyUI module must classify as generation')
assert(!isCustomNodeModule(savedComfy), 'saved ComfyUI module must not classify as custom node')
assertGroup(getSavedModuleGroup(savedComfy), 'generation', 'Generation', 'saved ComfyUI module')

assert(!shouldHideFromModuleLibrary(customNode), 'custom node module must stay visible')
assert(isCustomNodeModule(customNode), 'custom node module must classify as custom node')
assert(!isGenerationModule(customNode), 'custom node module must not classify as generation')
assertGroup(getCustomNodeGroup(customNode), 'custom-js', 'Custom JS', 'custom node module')

assert(shouldHideFromModuleLibrary(legacyNaiSnapshot), 'legacy saved NAI snapshot module must stay hidden')
assert(shouldHideFromModuleLibrary(legacyCodexSnapshot), 'legacy saved Codex snapshot module must stay hidden')
assert(!shouldHideFromModuleLibrary(constantText), 'constant text module must stay visible')
assert(shouldHideFromModuleLibrary(constantPrompt), 'legacy constant prompt duplicate must stay hidden')
assertGroup(getSystemModuleGroup(llmPresetLoader), 'llm', 'LLM', 'LLM preset loader')
assertOrderIndex(SYSTEM_GROUP_ORDER, SYSTEM_GROUP_ORDER_INDEX, 'system group order')
assertOrderIndex(SAVED_MODULE_GROUP_ORDER, SAVED_MODULE_GROUP_ORDER_INDEX, 'saved module group order')
assertOrderIndex(CUSTOM_NODE_GROUP_ORDER, CUSTOM_NODE_GROUP_ORDER_INDEX, 'custom-node group order')
assert(
  getModuleGroupSortIndex(SYSTEM_GROUP_ORDER_INDEX, 'unlisted') === Number.MAX_SAFE_INTEGER,
  'unknown module groups should still sort after known group keys',
)
assertModuleLibrarySortUsesOrderIndexes()

console.log('Module library grouping contracts verified.')
