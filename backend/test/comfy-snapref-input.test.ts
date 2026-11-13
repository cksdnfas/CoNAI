import './support/scratchRuntime'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MarkedField } from '../src/types/workflow'
import type { ComfyUIService } from '../src/services/comfyuiService'
import { describeMcpMarkedField, normalizeMcpWorkflowInputs } from '../src/services/comfyui/comfyWorkflowInputs'
import { substituteComfyPromptData } from '../src/services/comfyui/workflowSubstitution'
import { ComfyInputValidationError, prepareComfyPromptData, validateComfyPromptData } from '../src/services/prepareComfyPromptData'

/**
 * A SnapRef (SnapRefSimple) node field: a partial value keeps the workflow's saved inputs, invalid values are refused
 * with the reason on every path, image pictures are uploaded to the ComfyUI input folder, and the queued prompt gets
 * every widget input while the model/clip/vae links stay the workflow's.
 */
test('SnapRef node field: normalize, validate, upload and substitute', async () => {
  const snapRefInputs = {
    model: ['4', 0], clip: ['4', 1], vae: ['4', 2],
    adapter: 'snapref_v2a.safetensors', reference: '007.png', mode: 'Character & Style', strength: 1, fidelity: 1,
    reference_2: 'none', strength_2: 1, reference_3: 'none', strength_3: 1,
  }
  const template = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    '9': { class_type: 'SnapRefSimple', inputs: snapRefInputs },
  }
  const field = { id: 'snapref', label: 'SnapRef', type: 'node', node_editor: 'snapref_simple', jsonPath: '9.inputs', default_value: snapRefInputs } as MarkedField
  const fields = [field]

  const normalized = normalizeMcpWorkflowInputs(fields, {
    snapref: { mode: 'Character', fidelity: 0.5, reference_2: { fileName: 'side.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, strength_2: 1.5 },
  })
  assert.equal(normalized.snapref.reference, '007.png')
  assert.deepEqual(normalized.snapref.model, ['4', 0])

  const refused: Array<[Record<string, unknown>, RegExp]> = [
    [{ mode: 'Style' }, /mode must be one of/],
    [{ strength_2: 2.5 }, /strength_2 must be a number from 0 to 2/],
    [{ fidelity: -0.1 }, /fidelity must be a number from 0 to 1/],
    [{ reference: 'none' }, /reference \(picture 1\) is required/],
    [{ reference_2: '' }, /reference_2 must be a picture or "none"/],
    [{ reference_9: 'a.png' }, /reference_9/],
    // A picture object the upload path cannot turn into image bytes is refused before queueing, not mid-run.
    [{ reference: {} }, /reference is not a usable picture/],
    [{ reference_2: { fileName: 'x.png' } }, /reference_2 is not a usable picture/],
  ]
  for (const [value, reason] of refused) {
    assert.throws(() => normalizeMcpWorkflowInputs(fields, { snapref: value }), reason)
  }
  // The generation screen and queue paths validate the same way without MCP normalization.
  assert.throws(() => validateComfyPromptData(fields, { snapref: { ...snapRefInputs, mode: 'Style' } }), ComfyInputValidationError)
  assert.throws(() => validateComfyPromptData(fields, { snapref: { reference_2: { path: 'C:/secret.png' } } }), /경로/)
  assert.equal(validateComfyPromptData(fields, { snapref: { reference: { composite_hash: 'a'.repeat(32) } } }), true)

  const schema = (describeMcpMarkedField(field) as { value_schema?: { max_pictures?: number; properties?: Record<string, unknown> } }).value_schema
  assert.equal(schema?.max_pictures, 8)
  assert.ok(schema?.properties?.reference_8 && schema.properties.strength_8)

  const uploads: string[] = []
  const comfyService = {
    uploadInputImage: async (name: string) => {
      uploads.push(name)
      return `uploaded_${uploads.length}.png`
    },
  } as unknown as ComfyUIService
  const prepared = await prepareComfyPromptData(comfyService, fields, normalized)
  assert.equal(uploads.length, 1)
  assert.equal(prepared.snapref.reference_2, 'uploaded_1.png')

  const workflow = substituteComfyPromptData(JSON.stringify(template), fields, { snapref: { ...prepared.snapref, model: ['99', 0] } })
  assert.deepEqual(workflow['9'].inputs, {
    ...snapRefInputs,
    mode: 'Character',
    fidelity: 0.5,
    reference_2: 'uploaded_1.png',
    strength_2: 1.5,
  })
})
