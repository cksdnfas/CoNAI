import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import { getToken } from '../../utils/nai/auth'
import { preprocessMetadata, type NAIMetadataParams } from '../../utils/nai/metadata'
import { saveArtifactBuffer, saveMetadataArtifact } from './artifacts'
import {
  bufferToDataUrl,
  normalizeBase64ImageData,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'
import { type GraphWorkflowNode } from '../../types/moduleGraph'

/** Execute a NovelAI-backed module node and persist its outputs. */
export async function executeNaiModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `NAI module start: ${moduleDefinition.name}`,
    details: {
      engine: 'nai',
      model: resolvedInputs.model,
      action: resolvedInputs.action,
    },
  })

  const token = getToken()
  if (!token) {
    throw new Error('NovelAI token is required before executing NAI modules')
  }

  const metadata = preprocessMetadata(resolvedInputs as NAIMetadataParams)
  const isV45 = metadata.model?.includes('nai-diffusion-4-5')

  const baseParams: any = {
    params_version: 3,
    width: metadata.width,
    height: metadata.height,
    scale: metadata.scale,
    sampler: metadata.sampler,
    steps: metadata.steps,
    n_samples: metadata.n_samples,
    seed: metadata.seed,
    noise_schedule: metadata.noise_schedule,
    legacy: false,
  }

  if (isV45 || metadata.model?.includes('nai-diffusion-4')) {
    baseParams.autoSmea = false
    baseParams.variety_plus = metadata.variety_plus ?? false
    baseParams.uncond_scale = metadata.uncond_scale ?? 1.0
    baseParams.cfg_rescale = metadata.cfg_rescale ?? 0.7
    baseParams.dynamic_thresholding = false
    baseParams.controlnet_strength = 1.0
    baseParams.ucPreset = metadata.ucPreset || 0
    baseParams.add_original_image = true
    baseParams.legacy_v3_extend = false
    baseParams.skip_cfg_above_sigma = null
    baseParams.use_coords = false
    baseParams.normalize_reference_strength_multiple = true
    baseParams.inpaintImg2ImgStrength = 1
    baseParams.legacy_uc = false
    baseParams.deliberate_euler_ancestral_bug = false
    baseParams.prefer_brownian = true
    baseParams.stream = 'msgpack'
    baseParams.negative_prompt = metadata.negative_prompt || ''

    const characterPrompts: Array<{ prompt: string; uc: string; center: { x: number; y: number } }> = (metadata.characters || [])
      .filter((entry) => typeof entry.prompt === 'string' && entry.prompt.trim().length > 0)
      .map((entry) => {
        const center = {
          x: typeof entry.center_x === 'number' ? entry.center_x : 0.5,
          y: typeof entry.center_y === 'number' ? entry.center_y : 0.5,
        }

        return {
          prompt: entry.prompt.trim(),
          uc: (entry.uc || '').trim(),
          center,
        }
      })

    baseParams.characterPrompts = characterPrompts
    baseParams.use_coords = characterPrompts.length > 0

    baseParams.v4_prompt = {
      caption: {
        base_caption: metadata.prompt,
        char_captions: characterPrompts.map((entry) => ({
          char_caption: entry.prompt,
          centers: [entry.center],
        })),
      },
      use_coords: characterPrompts.length > 0,
      use_order: true,
    }

    baseParams.v4_negative_prompt = {
      caption: {
        base_caption: metadata.negative_prompt || '',
        char_captions: characterPrompts.map((entry) => ({
          char_caption: entry.uc,
          centers: [entry.center],
        })),
      },
      legacy_uc: false,
    }
  } else {
    baseParams.params_version = 1
    baseParams.ucPreset = metadata.ucPreset || 0
    baseParams.negative_prompt = metadata.negative_prompt || ''
  }

  const requestBody: any = {
    input: metadata.prompt,
    model: metadata.model,
    action: metadata.action,
    parameters: baseParams,
    use_new_shared_trial: true,
  }

  if (metadata.image) {
    requestBody.parameters.image = normalizeBase64ImageData(metadata.image)
    requestBody.parameters.strength = metadata.strength
    requestBody.parameters.noise = metadata.noise
    requestBody.parameters.extra_noise_seed = metadata.extra_noise_seed
  }

  if (metadata.mask) {
    requestBody.parameters.add_original_image = metadata.add_original_image ?? true
    requestBody.parameters.mask = normalizeBase64ImageData(metadata.mask)
  }

  const response = await axios.post('https://image.novelai.net/ai/generate-image', requestBody, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://novelai.net',
      Referer: 'https://novelai.net',
    },
    responseType: 'arraybuffer',
    timeout: 120000,
  })

  const zip = new AdmZip(Buffer.from(response.data))
  const firstEntry = zip.getEntries()[0]
  if (!firstEntry) {
    throw new Error('NAI module execution returned no images')
  }

  const imageBuffer = firstEntry.getData()
  const imageDataUrl = bufferToDataUrl(imageBuffer)
  const storagePath = await saveArtifactBuffer(context.executionId, node.id, 'image', 'image', imageBuffer)

  const metadataValue = {
    prompt: metadata.prompt,
    negative_prompt: metadata.negative_prompt,
    characters: metadata.characters,
    model: metadata.model,
    action: metadata.action,
    width: metadata.width,
    height: metadata.height,
  }

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageDataUrl,
      storagePath,
      metadata: {
        model: metadata.model,
        action: metadata.action,
      },
    },
    metadata: {
      type: 'json' as const,
      value: metadataValue,
      metadata: {
        kind: 'nai-metadata',
      },
    },
  }

  saveMetadataArtifact(context.executionId, node.id, metadataValue)
  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `NAI module completed: ${moduleDefinition.name}`,
    details: {
      artifact_ports: Object.keys(nodeArtifacts),
      storagePath,
    },
  })
}
