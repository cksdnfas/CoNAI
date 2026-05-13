import type { ModuleAuthoringSource, ModuleDefinitionRecord, ModuleEngineType, ModulePortDefinition } from '../lib/api-module-graph'
import {
  getCustomNodeGroup,
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

console.log('Module library grouping contracts verified.')
