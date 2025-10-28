import { toUploadsUrl } from '../../config/runtimePaths';

/**
 * 이미지 레코드에 URL과 구조화된 메타데이터 추가 (레거시)
 * @deprecated 새 코드에서는 enrichImageWithFileView 사용
 */
export function enrichImageRecord(image: any) {
  const enriched = {
    ...image,
    thumbnail_url: toUploadsUrl(image.thumbnail_path as string)!,
    image_url: toUploadsUrl(image.file_path as string)!,
    optimized_url: image.optimized_path ? toUploadsUrl(image.optimized_path) : null,

    // 그룹 정보 (이미 있는 경우 그대로 유지)
    groups: image.groups || [],

    // 구조화된 AI 메타데이터
    ai_metadata: {
      ai_tool: image.ai_tool,
      model_name: image.model_name,
      lora_models: image.lora_models ? JSON.parse(image.lora_models) : null,
      generation_params: {
        steps: image.steps,
        cfg_scale: image.cfg_scale,
        sampler: image.sampler,
        seed: image.seed,
        scheduler: image.scheduler,
        denoise_strength: image.denoise_strength,
        generation_time: image.generation_time,
        batch_size: image.batch_size,
        batch_index: image.batch_index
      },
      prompts: {
        prompt: image.prompt,
        negative_prompt: image.negative_prompt
      }
    },

    // 원본 메타데이터는 그대로 유지
    metadata: image.metadata ? JSON.parse(image.metadata) : null,

    // 자동 태그 정보 추가
    auto_tags: image.auto_tags ? JSON.parse(image.auto_tags) : null
  };

  // null 값 정리
  if (!enriched.ai_metadata.lora_models) {
    delete enriched.ai_metadata.lora_models;
  }

  // generation_params에서 null 값 제거
  Object.keys(enriched.ai_metadata.generation_params).forEach(key => {
    if (enriched.ai_metadata.generation_params[key] === null || enriched.ai_metadata.generation_params[key] === undefined) {
      delete enriched.ai_metadata.generation_params[key];
    }
  });

  // prompts에서 null 값 제거
  Object.keys(enriched.ai_metadata.prompts).forEach(key => {
    if (enriched.ai_metadata.prompts[key] === null || enriched.ai_metadata.prompts[key] === undefined) {
      delete enriched.ai_metadata.prompts[key];
    }
  });

  return enriched;
}

/**
 * ImageWithFileView에 URL과 구조화된 메타데이터 추가 (새 구조)
 * composite_hash 기반 이미지 데이터 처리
 */
export function enrichImageWithFileView(image: any) {
  const enriched = {
    ...image,
    thumbnail_url: toUploadsUrl(image.thumbnail_path as string)!,
    // original_file_path가 있으면 사용, 없으면 null
    image_url: image.original_file_path ? toUploadsUrl(image.original_file_path) : null,
    optimized_url: image.optimized_path ? toUploadsUrl(image.optimized_path) : null,

    // 그룹 정보 (이미 있는 경우 그대로 유지)
    groups: image.groups || [],

    // 구조화된 AI 메타데이터
    ai_metadata: {
      ai_tool: image.ai_tool,
      model_name: image.model_name,
      lora_models: image.lora_models ? (typeof image.lora_models === 'string' ? JSON.parse(image.lora_models) : image.lora_models) : null,
      generation_params: {
        steps: image.steps,
        cfg_scale: image.cfg_scale,
        sampler: image.sampler,
        seed: image.seed,
        scheduler: image.scheduler,
        denoise_strength: image.denoise_strength,
        generation_time: image.generation_time,
        batch_size: image.batch_size,
        batch_index: image.batch_index
      },
      prompts: {
        prompt: image.prompt,
        negative_prompt: image.negative_prompt
      }
    },

    // 자동 태그 정보 추가
    auto_tags: image.auto_tags ? (typeof image.auto_tags === 'string' ? JSON.parse(image.auto_tags) : image.auto_tags) : null
  };

  // null 값 정리
  if (!enriched.ai_metadata.lora_models) {
    delete enriched.ai_metadata.lora_models;
  }

  // generation_params에서 null 값 제거
  Object.keys(enriched.ai_metadata.generation_params).forEach(key => {
    if (enriched.ai_metadata.generation_params[key] === null || enriched.ai_metadata.generation_params[key] === undefined) {
      delete enriched.ai_metadata.generation_params[key];
    }
  });

  // prompts에서 null 값 제거
  Object.keys(enriched.ai_metadata.prompts).forEach(key => {
    if (enriched.ai_metadata.prompts[key] === null || enriched.ai_metadata.prompts[key] === undefined) {
      delete enriched.ai_metadata.prompts[key];
    }
  });

  return enriched;
}
