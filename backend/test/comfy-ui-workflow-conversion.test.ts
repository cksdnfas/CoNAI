import './support/testTemp'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ComfyUiWorkflowConversionError,
  convertComfyUiWorkflowToApi,
  isComfyUiWorkflowFormat,
  resolveApiWorkflowJson,
  type ComfyObjectInfoNode,
} from '../src/services/comfyui/uiWorkflowConversion'
import { substituteComfyPromptData } from '../src/services/comfyui/workflowSubstitution'

const OBJECT_INFO: Record<string, ComfyObjectInfoNode> = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } } },
  CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } } },
  EmptyLatentImage: { input: { required: { width: ['INT', { default: 512 }], height: ['INT', { default: 512 }], batch_size: ['INT', { default: 1 }] } } },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0, control_after_generate: true }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [['euler', 'dpmpp_2m']],
        scheduler: [['normal', 'karras']],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1 }],
      },
    },
  },
  LoraLoader: { input: { required: { model: ['MODEL'], clip: ['CLIP'], lora_name: [['x.safetensors']], strength_model: ['FLOAT'], strength_clip: ['FLOAT'] } } },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } } },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } }, output_node: true },
  PreviewImage: { input: { required: { images: ['IMAGE'] } }, output_node: true },
  ComfyMathExpression: { input: { required: { expression: ['STRING'], values: ['COMFY_AUTOGROW_V3', {}] } } },
  LoadImage: { input: { required: { image: [['in.png'], { image_upload: true }] } } },
}

const getNodeInfo = async (type: string) => OBJECT_INFO[type] ?? null

type UiFixtureNode = {
  id: number
  type: string
  mode: number
  title?: string
  inputs: { name: string; type: string; link: number | null; widget?: { name: string } }[]
  outputs: { name: string; type: string; links?: number[] }[]
  widgets_values?: unknown
}
type UiFixture = { nodes: UiFixtureNode[]; links: unknown[][]; [key: string]: unknown }

/** The stock text-to-image graph, as ComfyUI "Save" writes it (schema 0.4). */
function defaultWorkflow(): UiFixture {
  return {
    last_node_id: 9,
    last_link_id: 9,
    nodes: [
      { id: 3, type: 'KSampler', mode: 0, inputs: [{ name: 'model', type: 'MODEL', link: 1 }, { name: 'positive', type: 'CONDITIONING', link: 4 }, { name: 'negative', type: 'CONDITIONING', link: 6 }, { name: 'latent_image', type: 'LATENT', link: 2 }], outputs: [{ name: 'LATENT', type: 'LATENT', links: [7] }], widgets_values: [156680208700286, 'randomize', 20, 8, 'euler', 'normal', 1] },
      { id: 4, type: 'CheckpointLoaderSimple', mode: 0, inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }, { name: 'VAE', type: 'VAE' }], widgets_values: ['a.safetensors'] },
      { id: 5, type: 'EmptyLatentImage', mode: 0, inputs: [], outputs: [{ name: 'LATENT', type: 'LATENT' }], widgets_values: [512, 768, 1] },
      { id: 6, type: 'CLIPTextEncode', title: 'Positive', mode: 0, inputs: [{ name: 'clip', type: 'CLIP', link: 3 }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }], widgets_values: ['a cat'] },
      { id: 7, type: 'CLIPTextEncode', mode: 0, inputs: [{ name: 'clip', type: 'CLIP', link: 5 }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }], widgets_values: ['blurry'] },
      { id: 8, type: 'VAEDecode', mode: 0, inputs: [{ name: 'samples', type: 'LATENT', link: 7 }, { name: 'vae', type: 'VAE', link: 8 }], outputs: [{ name: 'IMAGE', type: 'IMAGE' }] },
      { id: 9, type: 'SaveImage', mode: 0, inputs: [{ name: 'images', type: 'IMAGE', link: 9 }], outputs: [], widgets_values: ['ComfyUI'] },
    ],
    links: [
      [1, 4, 0, 3, 0, 'MODEL'], [2, 5, 0, 3, 3, 'LATENT'], [3, 4, 1, 6, 0, 'CLIP'], [4, 6, 0, 3, 1, 'CONDITIONING'],
      [5, 4, 1, 7, 0, 'CLIP'], [6, 7, 0, 3, 2, 'CONDITIONING'], [7, 3, 0, 8, 0, 'LATENT'], [8, 4, 2, 8, 1, 'VAE'], [9, 8, 0, 9, 0, 'IMAGE'],
    ],
    groups: [],
    version: 0.4,
  }
}

test('ui workflow detection: a root nodes array is UI, a node map is API', () => {
  assert.equal(isComfyUiWorkflowFormat(defaultWorkflow()), true)
  assert.equal(isComfyUiWorkflowFormat({ 3: { class_type: 'KSampler', inputs: {} } }), false)
})

test('ui workflow conversion: the stock graph maps widgets by object_info order and skips control_after_generate', async () => {
  const { workflow } = await convertComfyUiWorkflowToApi(defaultWorkflow(), getNodeInfo)
  assert.deepEqual(Object.keys(workflow), ['3', '4', '5', '6', '7', '8', '9'])
  assert.deepEqual(workflow['3'], {
    class_type: 'KSampler',
    inputs: { seed: 156680208700286, steps: 20, cfg: 8, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
    _meta: { title: 'KSampler' },
  })
  assert.deepEqual(workflow['5'].inputs, { width: 512, height: 768, batch_size: 1 })
  assert.deepEqual(workflow['6'], { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] }, _meta: { title: 'Positive' } })
  assert.deepEqual(workflow['8'].inputs, { samples: ['3', 0], vae: ['4', 2] })
})

test('ui workflow conversion: reroutes, primitives, Set/Get, bypassed and muted nodes resolve like the frontend', async () => {
  const ui = defaultWorkflow()
  ui.nodes.push(
    { id: 10, type: 'Reroute', mode: 0, inputs: [{ name: '', type: '*', link: 10 }], outputs: [{ name: '', type: 'MODEL' }] },
    { id: 11, type: 'LoraLoader', mode: 4, inputs: [{ name: 'model', type: 'MODEL', link: 11 }, { name: 'clip', type: 'CLIP', link: null }], outputs: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }], widgets_values: ['x.safetensors', 1, 1] },
    { id: 12, type: 'PrimitiveNode', mode: 0, inputs: [], outputs: [{ name: 'INT', type: 'INT' }], widgets_values: [42, 'fixed'] },
    { id: 13, type: 'SetNode', mode: 0, inputs: [{ name: 'VAE', type: 'VAE', link: 13 }], outputs: [], widgets_values: ['vae'] },
    { id: 14, type: 'GetNode', mode: 0, inputs: [], outputs: [{ name: 'VAE', type: 'VAE' }], widgets_values: ['vae'] },
    { id: 15, type: 'PreviewImage', mode: 2, inputs: [{ name: 'images', type: 'IMAGE', link: 15 }], outputs: [] },
    { id: 16, type: 'Note', mode: 0, inputs: [], outputs: [], widgets_values: ['remember'] },
  )
  const k = ui.nodes.find((node) => node.id === 3)!
  k.inputs[0].link = 12
  k.inputs.push({ name: 'seed', type: 'INT', link: 14, widget: { name: 'seed' } })
  ui.nodes.find((node) => node.id === 8)!.inputs[1].link = 16
  // checkpoint → reroute → bypassed lora → sampler; primitive → seed; checkpoint VAE → Set … Get → decode.
  ui.links.push([10, 4, 0, 10, 0, 'MODEL'], [11, 10, 0, 11, 0, 'MODEL'], [12, 11, 0, 3, 0, 'MODEL'], [14, 12, 0, 3, 4, 'INT'], [13, 4, 2, 13, 0, 'VAE'], [16, 14, 0, 8, 1, 'VAE'], [15, 8, 0, 15, 0, 'IMAGE'])

  const { workflow, warnings } = await convertComfyUiWorkflowToApi(ui, getNodeInfo)
  assert.deepEqual(workflow['3'].inputs.model, ['4', 0])
  assert.equal(workflow['3'].inputs.seed, 42)
  assert.deepEqual(workflow['8'].inputs.vae, ['4', 2])
  for (const dropped of ['10', '11', '12', '13', '14', '15', '16']) assert.equal(workflow[dropped], undefined)
  assert.match(warnings.join('\n'), /Note/)
})

test('ui workflow conversion: subgraphs flatten to instance:inner ids with promoted widgets matched by definition order', async () => {
  const ui = {
    nodes: [
      { id: 4, type: 'CheckpointLoaderSimple', mode: 0, inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }, { name: 'VAE', type: 'VAE' }], widgets_values: ['a.safetensors'] },
      // The instance lists only the clip socket and the steps widget, in its own order; text and steps are promoted widgets.
      { id: 20, type: 'sub-1', mode: 0, inputs: [{ name: 'clip', type: 'CLIP', link: 1 }, { name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }, { name: 'steps_out', type: 'INT' }], widgets_values: ['a dog', 30] },
      { id: 30, type: 'ComfyMathExpression', mode: 0, inputs: [{ name: 'values.a', type: 'INT', link: 3 }, { name: 'expression', type: 'STRING', link: null, widget: { name: 'expression' } }], outputs: [{ name: 'INT', type: 'INT' }], widgets_values: ['a * 2'] },
      { id: 9, type: 'SaveImage', mode: 0, inputs: [{ name: 'images', type: 'IMAGE', link: 4 }], outputs: [], widgets_values: ['out'] },
      { id: 31, type: 'LoadImage', mode: 0, inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE' }], widgets_values: ['in.png', 'image'] },
    ],
    links: [[1, 4, 1, 20, 0, 'CLIP'], [3, 20, 1, 30, 0, 'INT'], [4, 31, 0, 9, 0, 'IMAGE']],
    definitions: {
      subgraphs: [{
        id: 'sub-1',
        inputs: [{ name: 'text', type: 'STRING' }, { name: 'clip', type: 'CLIP' }, { name: 'steps', type: 'INT' }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }, { name: 'steps_out', type: 'INT' }],
        nodes: [
          { id: 1, type: 'CLIPTextEncode', mode: 0, inputs: [{ name: 'text', type: 'STRING', link: 10, widget: { name: 'text' } }, { name: 'clip', type: 'CLIP', link: 11 }], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING' }], widgets_values: ['inner default'] },
          { id: 2, type: 'Reroute', mode: 0, inputs: [{ name: '', type: '*', link: 12 }], outputs: [{ name: '', type: 'INT' }] },
          { id: 3, type: 'EmptyLatentImage', mode: 0, inputs: [{ name: 'batch_size', type: 'INT', link: 15, widget: { name: 'batch_size' } }], outputs: [{ name: 'LATENT', type: 'LATENT' }], widgets_values: [512, 512, 1] },
        ],
        links: [
          { id: 10, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'STRING' },
          { id: 11, origin_id: -10, origin_slot: 1, target_id: 1, target_slot: 1, type: 'CLIP' },
          { id: 12, origin_id: -10, origin_slot: 2, target_id: 2, target_slot: 0, type: 'INT' },
          { id: 15, origin_id: -10, origin_slot: 2, target_id: 3, target_slot: 0, type: 'INT' },
          { id: 13, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'CONDITIONING' },
          { id: 14, origin_id: 2, origin_slot: 0, target_id: -20, target_slot: 1, type: 'INT' },
        ],
      }],
    },
  }

  const { workflow } = await convertComfyUiWorkflowToApi(ui, getNodeInfo)
  assert.deepEqual(workflow['20:1'].inputs, { text: 'a dog', clip: ['4', 1] })
  assert.deepEqual(workflow['20:3'].inputs, { width: 512, height: 512, batch_size: 30 })
  // A subgraph output that ends in a reroute of a promoted widget becomes a literal.
  assert.deepEqual(workflow['30'].inputs, { expression: 'a * 2', 'values.a': 30 })
  assert.deepEqual(workflow['31'].inputs, { image: 'in.png' })
  assert.equal(workflow['20'], undefined)
})

test('ui workflow conversion: unmappable workflows fail with reasons instead of guessing', async () => {
  const shifted = defaultWorkflow()
  shifted.nodes.find((node) => node.id === 3)!.widgets_values = ['euler', 20, 8, 'normal', 1]
  await assert.rejects(convertComfyUiWorkflowToApi(shifted, getNodeInfo), (error: unknown) => (
    error instanceof ComfyUiWorkflowConversionError && error.issues.some((issue) => issue.includes('"seed"'))
  ))

  const unknownFeeder = defaultWorkflow()
  unknownFeeder.nodes.find((node) => node.id === 4)!.type = 'MissingCustomLoader'
  await assert.rejects(convertComfyUiWorkflowToApi(unknownFeeder, getNodeInfo), (error: unknown) => (
    error instanceof ComfyUiWorkflowConversionError && error.issues.some((issue) => issue.includes('MissingCustomLoader'))
  ))

  const groupNode = defaultWorkflow()
  groupNode.nodes.push({ id: 20, type: 'workflow>Upscale', mode: 0, inputs: [], outputs: [] })
  await assert.rejects(convertComfyUiWorkflowToApi(groupNode, getNodeInfo), /그룹 노드/)

  const unplugged = defaultWorkflow()
  unplugged.nodes.find((node) => node.id === 8)!.inputs[1].link = null
  await assert.rejects(convertComfyUiWorkflowToApi(unplugged, getNodeInfo), /"vae"/)
})

test('ui workflow conversion: V3 dynamic combos, widgetType and socketless widgets map like the frontend', async () => {
  const info: Record<string, ComfyObjectInfoNode> = {
    SaveVideo: {
      input: {
        required: {
          video: ['VIDEO'],
          filename_prefix: ['STRING'],
          format: ['COMFY_DYNAMICCOMBO_V3', { options: [
            { key: 'auto', inputs: { required: { codec: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'auto', inputs: { required: {} } }, { key: 'h264', inputs: { required: { crf: ['FLOAT'] } } }] }] } } },
          ] }],
        },
      },
      input_order: { required: ['video', 'filename_prefix', 'format'] },
      output_node: true,
    },
    LoadVideo: { input: { required: { file: [['a.mp4']] } } },
    LatentAudio: { input: { required: { frames: ['INT'], frame_rate: ['FLOAT,INT', { widgetType: 'FLOAT' }], batch_size: ['INT'], color: ['COLOR', { socketless: true }], images: ['COMFY_AUTOGROW_V3', { template: {}, min: 0 }] } } },
  }
  const ui = {
    nodes: [
      { id: 1, type: 'LoadVideo', mode: 0, pos: [10.4, 20], inputs: [], outputs: [{ name: 'VIDEO', type: 'VIDEO' }], widgets_values: ['a.mp4'] },
      { id: 2, type: 'SaveVideo', mode: 0, pos: [400, 20], inputs: [{ name: 'video', type: 'VIDEO', link: 1 }], outputs: [], widgets_values: ['video/out', 'auto', 'h264', 18] },
      { id: 3, type: 'LatentAudio', mode: 0, inputs: [], outputs: [], widgets_values: [97, 25, 1, '#ffffff'] },
    ],
    links: [[1, 1, 0, 2, 0, 'VIDEO']],
  }
  const { workflow } = await convertComfyUiWorkflowToApi(ui, async (type) => info[type] ?? null)
  assert.deepEqual(workflow['2'].inputs, { filename_prefix: 'video/out', format: 'auto', 'format.codec': 'h264', 'format.codec.crf': 18, video: ['1', 0] })
  assert.deepEqual(workflow['3'].inputs, { frames: 97, frame_rate: 25, batch_size: 1, color: '#ffffff' })
  // Root nodes keep their ComfyUI position for the editor's "ComfyUI arrangement" view.
  assert.deepEqual(workflow['1']._meta, { title: 'LoadVideo', pos: [10, 20] })
  assert.deepEqual(workflow['3']._meta, { title: 'LatentAudio' })
})

test('workflow server check: missing nodes, unlisted models, out-of-range numbers and nodes that never run', async () => {
  const { createServer } = await import('node:http')
  const { checkComfyWorkflowAgainst } = await import('../src/services/comfyui/workflowServerCheck')
  const info: Record<string, unknown> = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['models\\a.safetensors']] } } },
    KSampler: { input: { required: { steps: ['INT', { min: 1, max: 100 }] } } },
    SaveImage: { input: { required: { images: ['IMAGE'] } }, output_node: true },
  }
  const server = createServer((req, res) => {
    const type = decodeURIComponent((req.url ?? '').replace('/object_info/', ''))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(type in info ? { [type]: info[type] } : {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const workflow = {
      1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'models/a.safetensors' } },
      2: { class_type: 'KSampler', inputs: { steps: 500, model: ['1', 0] } },
      3: { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
      4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'gone.safetensors' } },
      5: { class_type: 'MissingNode', inputs: {} },
    }
    const result = await checkComfyWorkflowAgainst(JSON.stringify(workflow), [
      { id: 1, name: 'local', endpoint: `http://127.0.0.1:${port}` },
      { id: 2, name: 'down', endpoint: 'http://127.0.0.1:9' },
    ])
    assert.deepEqual(result.servers.map((entry) => [entry.server_name, entry.status]), [['local', 'incompatible'], ['down', 'unreachable']])
    // The separator-only difference on node 1 is not an issue.
    assert.deepEqual(result.servers[0].issues.map((issue) => issue.node_id), ['2', '4', '5'])
    assert.deepEqual(result.output_node_ids, ['3'])
    assert.deepEqual(result.unused_node_ids, ['4', '5'])
  } finally {
    server.close()
  }
})

test('ui workflow conversion: API workflow_json is stored exactly as given', async () => {
  const apiJson = '{"3":{"class_type":"KSampler","inputs":{"seed":1}}}'
  assert.deepEqual(await resolveApiWorkflowJson(apiJson), { workflowJson: apiJson, converted: false, warnings: [] })
})

test('ui workflow conversion: a seed ComfyUI had on "fixed" is recorded so runs keep it', async () => {
  const fixture = defaultWorkflow()
  fixture.nodes[0].widgets_values = [42, 'fixed', 20, 8, 'euler', 'normal', 1]
  const { workflow } = await convertComfyUiWorkflowToApi(fixture, getNodeInfo)
  assert.equal(workflow['3'].inputs.seed, 42)
  assert.deepEqual(workflow['3']._meta, { title: 'KSampler', conai_fixed_seeds: ['seed'] })
})

test('comfy prompt substitution: literal seeds roll per run unless a field sets them or ComfyUI had them fixed', () => {
  const workflowJson = JSON.stringify({
    1: { class_type: 'KSampler', inputs: { seed: 7, steps: 20 } },
    2: { class_type: 'KSampler', inputs: { seed: 7 } },
    3: { class_type: 'RandomNoise', inputs: { noise_seed: 7 } },
    4: { class_type: 'Seed (rgthree)', inputs: { seed: -1 } },
    5: { class_type: 'KSampler', inputs: { seed: 7 }, _meta: { title: 'K', conai_fixed_seeds: ['seed'] } },
    6: { class_type: 'KSampler', inputs: { seed: ['4', 0] } },
    7: { class_type: 'ReferenceTrainOptions', inputs: { seed_override: -1 } },
    8: { class_type: 'KSampler', inputs: { seed: 7 } },
  })
  const fields = [
    { id: 'seed_1', label: 'Seed', jsonPath: '1.inputs.seed', type: 'number' as const },
    { id: 'seed_2', label: 'Seed 2', jsonPath: '2.inputs.seed', type: 'number' as const },
    { id: 'seed_8', label: 'Seed 8', jsonPath: '8.inputs.seed', type: 'number' as const, default_value: 5 },
  ]
  const isRolled = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** 31
  const runs = [0, 1, 2].map(() => substituteComfyPromptData(workflowJson, fields, { seed_1: 123, seed_2: -1 }))
  for (const run of runs) {
    assert.equal(run['1'].inputs.seed, 123)
    assert.equal(run['5'].inputs.seed, 7)
    assert.equal(run['8'].inputs.seed, 5)
    assert.deepEqual(run['6'].inputs.seed, ['4', 0])
    assert.equal(run['7'].inputs.seed_override, -1)
    for (const value of [run['2'].inputs.seed, run['3'].inputs.noise_seed, run['4'].inputs.seed]) assert.ok(isRolled(value), String(value))
  }
  assert.ok(new Set(runs.map((run) => run['3'].inputs.noise_seed)).size > 1)
  // An unfilled seed field with no default rolls too.
  assert.ok(isRolled(substituteComfyPromptData(workflowJson, fields, {})['2'].inputs.seed))
})
