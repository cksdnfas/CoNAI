import fs from 'fs';
import { comfyAssetFields, resolvePresetWorkflow, type ChatGenerationPreset } from './chatGenerationPresets';
import type { ChatProfile } from './chatProfiles';
import { resolveProfileAsset } from './chatProfileAssets';
import { parseMcpMarkedFields } from '../../mcp/tools/mcpComfyWorkflowService';

export const CHAT_NAI_REFERENCE_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_NAI_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

function joinPrompt(parts: string[]) {
  return parts.map((part) => part.trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');
}

/** Assemble the queue input without contacting a generation service; shared by both preset handlers. */
export async function buildChatGenerationPresetJob(preset: ChatGenerationPreset, args: Record<string, unknown>, profile: ChatProfile | null = null, options: { forceReference?: boolean; omitReference?: boolean } = {}) {
  const summary = `채팅 프리셋 · ${preset.name}`;
  const reference = () => {
    if (!profile?.referenceHash) throw new Error('프로필에 기준 이미지를 골라줘.');
    const asset = resolveProfileAsset(profile, 'reference');
    if (asset.state === 'hidden') throw new Error('안전 등급 때문에 기준 이미지를 쓸 수 없어.');
    if (asset.state !== 'file') throw new Error('기준 이미지 파일을 찾을 수 없어.');
    return asset.file;
  };
  if (preset.kind === 'nai') {
    const config = preset.nai;
    if (!config) throw new Error('NAI 프리셋 설정을 찾을 수 없어.');
    const size = config.sizes.find((entry) => entry.label === args.size) ?? config.sizes[0];
    const referenceMode = options.omitReference ? 'none' : options.forceReference && config.characterReference === 'none' ? 'replace' : config.characterReference;
    let characterRefs = options.omitReference ? [] : config.characterRefs;
    if (referenceMode !== 'none') {
      const file = reference();
      if (fs.statSync(file.path).size > CHAT_NAI_REFERENCE_MAX_BYTES) throw new Error('NAI 기준 이미지는 4MB까지 쓸 수 있어.');
      const buffer = await fs.promises.readFile(file.path);
      if (buffer.length > CHAT_NAI_REFERENCE_MAX_BYTES) throw new Error('NAI 기준 이미지는 4MB까지 쓸 수 있어.');
      const item = { image: `data:${file.mimeType};base64,${buffer.toString('base64')}`, type: 'character', strength: 0.6, fidelity: 1 };
      characterRefs = referenceMode === 'append' ? [...characterRefs, item] : [item];
    }
    const payload: Record<string, unknown> = {
      prompt: joinPrompt([config.promptPrefix, String(args.prompt ?? ''), config.promptSuffix]),
      negative_prompt: config.negativePrompt || undefined,
      model: config.model,
      action: 'generate',
      sampler: config.sampler,
      noise_schedule: config.noiseSchedule,
      width: size.width,
      height: size.height,
      steps: config.steps,
      scale: config.scale,
      n_samples: 1,
      use_coords: config.useCoords,
      characters: config.characters.length > 0 ? config.characters : undefined,
      vibes: config.vibes.length > 0 ? config.vibes : undefined,
      character_refs: characterRefs.length > 0 ? characterRefs : undefined,
      variety_plus: config.varietyPlus,
      transparent_background: config.transparentBackground,
    };
    if (referenceMode !== 'none' && Buffer.byteLength(JSON.stringify(payload)) > CHAT_NAI_PAYLOAD_MAX_BYTES) throw new Error('NAI 기준 이미지가 포함된 작업 입력은 8MB까지 쓸 수 있어.');
    return { service_type: 'novelai' as const, request_payload: payload, request_summary: summary };
  }
  const config = preset.comfyui;
  if (!config) throw new Error('ComfyUI 프리셋 설정을 찾을 수 없어.');
  // Character assets also find the image field on their own when the workflow has only one; chat tools use the chosen one.
  let referenceField = config.referenceField;
  if (options.forceReference) {
    const { workflow, problem } = resolvePresetWorkflow(config);
    if (!workflow) throw new Error(problem ?? '워크플로를 찾을 수 없어.');
    referenceField = comfyAssetFields(config, parseMcpMarkedFields(workflow)).referenceField;
  }
  const supplied: Record<string, unknown> = {};
  for (const id of config.exposedFieldIds) if (id !== referenceField && args[id] !== undefined) supplied[id] = args[id];
  const inputs = { ...config.fixedInputs, ...supplied };
  if (options.forceReference && !options.omitReference && !referenceField) throw new Error('이 워크플로에는 기준 이미지를 받을 이미지 필드가 없어.');
  if (options.omitReference && referenceField) delete inputs[referenceField];
  if (referenceField && !options.omitReference) {
    const { workflow, problem } = resolvePresetWorkflow(config);
    if (!workflow) throw new Error(problem ?? '워크플로를 찾을 수 없어.');
    if (!parseMcpMarkedFields(workflow).some((field) => field.id === referenceField && field.type === 'image')) throw new Error('기준 이미지 필드가 변경됐어. 프리셋을 다시 저장해줘.');
    reference();
    inputs[referenceField] = { composite_hash: profile!.referenceHash };
  }
  return { service_type: 'comfyui' as const, workflow_id: config.workflowId, server_id: config.serverId ?? undefined, server_tag: config.serverTag ?? undefined, inputs, request_summary: summary };
}

