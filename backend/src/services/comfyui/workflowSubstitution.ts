import type { MarkedField } from '../../types/workflow';
import { normalizeWorkflowNumericPromptValues } from '../workflowNumericFieldPolicy';

const MINIMAX_DIRECTOR_MODES = new Set([
  'T2VA',
  'I2VA',
  'FL2VA',
  'L2VA',
  'REF2VA',
  'Image Inpaint',
]);

const DEFAULT_MINIMAX_UPSCALE_MODEL = '2x-AnimeSharpV4_RCAN.safetensors';

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, any> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(candidate) ? candidate : fallback));
}

function normalizeMiniMaxPostprocess(value: unknown) {
  const source = isRecord(value) ? value : {};
  const simple = isRecord(source.simple) ? source.simple : {};
  const model = isRecord(source.model) ? source.model : {};
  const rtx = isRecord(source.rtx) ? source.rtx : {};
  const quality = (candidate: unknown) => (
    candidate === 'Low' || candidate === 'Medium' || candidate === 'High' || candidate === 'Ultra'
      ? candidate
      : 'Ultra'
  );
  return {
    simple: { enabled: simple.enabled === true },
    model: {
      enabled: model.enabled === true,
      model_name: typeof model.model_name === 'string' && model.model_name.trim()
        ? model.model_name
        : DEFAULT_MINIMAX_UPSCALE_MODEL,
    },
    rtx: {
      enabled: rtx.enabled === true,
      denoise: rtx.denoise !== false,
      denoise_quality: quality(rtx.denoise_quality),
      deblur: rtx.deblur !== false,
      deblur_quality: quality(rtx.deblur_quality),
      upscale: rtx.upscale === 'Off' || rtx.upscale === 'High Bitrate' ? rtx.upscale : 'VSR',
      upscale_quality: quality(rtx.upscale_quality),
      resize_type: rtx.resize_type === 'Keep Ratio'
        || rtx.resize_type === 'Manual'
        || rtx.resize_type === 'Preset Ratio'
        || rtx.resize_type === 'Same Size'
        ? rtx.resize_type
        : 'Scale',
      scale: boundedNumber(rtx.scale, 2, 1, 4),
      megapixels: boundedNumber(rtx.megapixels, 2, 0.01, 64),
      width: boundedNumber(rtx.width, 1920, 64, 8192),
      height: boundedNumber(rtx.height, 1080, 64, 8192),
      divisible_by: rtx.divisible_by === '8'
        || rtx.divisible_by === '16'
        || rtx.divisible_by === '64'
        || rtx.divisible_by === '128'
        ? Number(rtx.divisible_by)
        : 32,
      ratio_preset: rtx.ratio_preset === '1:1'
        || rtx.ratio_preset === '4:3'
        || rtx.ratio_preset === '3:2'
        || rtx.ratio_preset === '21:9'
        ? rtx.ratio_preset
        : '16:9',
      resize_method: rtx.resize_method === 'Letterbox (Fit)' ? 'Letterbox (Fit)' : 'Center Crop (Fill)',
      device_id: Math.trunc(boundedNumber(rtx.device_id, 0, 0, 8)),
      empty_cache: rtx.empty_cache === true,
      use_mmap: rtx.use_mmap === true,
      auto_unload_models: rtx.auto_unload_models !== false,
    },
  };
}

function setValueByPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

function pruneMiniMaxDirectorModeOutputs(workflow: Record<string, any>): void {
  for (const [nodeId, node] of Object.entries(workflow)) {
    const binding = node?._meta?.conai_minimax_output;
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      continue;
    }

    const directorNodeId = String(binding.director_node_id ?? '');
    const outputKind = binding.kind;
    const directorMode = workflow[directorNodeId]?.inputs?.mode;
    if (
      typeof directorMode !== 'string' ||
      !MINIMAX_DIRECTOR_MODES.has(directorMode)
    ) {
      continue;
    }

    const isInpaintMode = directorMode === 'Image Inpaint';
    if ((outputKind === 'video' && isInpaintMode) || (outputKind === 'image' && !isInpaintMode)) {
      delete workflow[nodeId];
    }
  }
}

function configureMiniMaxDirectorPostprocess(workflow: Record<string, any>): void {
  for (const [directorNodeId, directorNode] of Object.entries(workflow)) {
    const baseImage = directorNode?._meta?.conai_minimax_postprocess_base;
    if (directorNode?.class_type !== 'MiniMaxH3Director' || !Array.isArray(baseImage) || baseImage.length !== 2) {
      continue;
    }

    const timeline = parseJsonRecord(directorNode.inputs?.timeline_data);
    const postprocess = normalizeMiniMaxPostprocess(timeline.postprocess);
    const stages = new Map<string, [string, any]>();
    const consumers: Array<[any, string]> = [];
    for (const [nodeId, node] of Object.entries(workflow)) {
      const stageBinding = node?._meta?.conai_minimax_postprocess;
      if (isRecord(stageBinding) && String(stageBinding.director_node_id ?? '') === directorNodeId) {
        stages.set(String(stageBinding.kind ?? ''), [nodeId, node]);
      }
      const consumerBinding = node?._meta?.conai_minimax_postprocess_consumer;
      if (isRecord(consumerBinding) && String(consumerBinding.director_node_id ?? '') === directorNodeId) {
        consumers.push([node, String(consumerBinding.input ?? 'images')]);
      }
    }

    let currentImage: [string, number] = [String(baseImage[0]), Number(baseImage[1])];
    const requireStage = (kind: string) => {
      const stage = stages.get(kind);
      if (!stage) throw new Error(`MiniMax Director postprocess stage is missing: ${kind}`);
      return stage;
    };

    if (postprocess.simple.enabled) {
      const [nodeId, node] = requireStage('simple');
      node.inputs = {
        ...node.inputs,
        image: currentImage,
        size_mode: 'Multiplier',
        aspect_mode: 'Fit',
        target_width: 1920,
        target_height: 1080,
        scale_multiplier: 2,
        interpolation: 'Lanczos',
        gamma_correct: true,
        divisible_by: 1,
        pad_color: '0, 0, 0',
        crop_position: 'center',
        batch_size: 0,
        max_batch_megapixels: 16,
        cache_size: 64,
      };
      currentImage = [nodeId, 0];
    } else if (stages.has('simple')) {
      delete workflow[stages.get('simple')![0]];
    }

    if (postprocess.model.enabled) {
      const [loaderId, loader] = requireStage('model_loader');
      const [nodeId, node] = requireStage('model');
      loader.inputs = { ...loader.inputs, model_name: postprocess.model.model_name };
      node.inputs = { ...node.inputs, upscale_model: [loaderId, 0], image: currentImage };
      currentImage = [nodeId, 0];
    } else {
      if (stages.has('model_loader')) delete workflow[stages.get('model_loader')![0]];
      if (stages.has('model')) delete workflow[stages.get('model')![0]];
    }

    if (postprocess.rtx.enabled) {
      const [nodeId, node] = requireStage('rtx');
      node.inputs = { ...node.inputs, images: currentImage, ...postprocess.rtx };
      delete node.inputs.enabled;
      currentImage = [nodeId, 0];
    } else if (stages.has('rtx')) {
      delete workflow[stages.get('rtx')![0]];
    }

    for (const [consumer, inputName] of consumers) {
      consumer.inputs = { ...consumer.inputs, [inputName]: currentImage };
    }
  }
}

export function substituteComfyPromptData(
  workflowJson: string,
  markedFields: MarkedField[],
  promptData: Record<string, any>
): any {
  const workflow = JSON.parse(workflowJson);
  const normalizedPromptData = normalizeWorkflowNumericPromptValues(markedFields, promptData);

  for (const field of markedFields) {
    const value = normalizedPromptData[field.id];
    if (value !== undefined && value !== null) {
      setValueByPath(workflow, field.jsonPath, value);
    } else if (field.default_value !== undefined) {
      setValueByPath(workflow, field.jsonPath, field.default_value);
    }
  }

  configureMiniMaxDirectorPostprocess(workflow);
  pruneMiniMaxDirectorModeOutputs(workflow);

  return workflow;
}
