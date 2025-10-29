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
  // 외부 폴더 이미지인지 확인 (original_file_path가 절대 경로)
  const isExternalImage = image.original_file_path && require('path').isAbsolute(image.original_file_path);

  const enriched = {
    ...image,
    // 썸네일: temp 폴더에 있으므로 항상 정상 작동 (외부 이미지도 포함)
    thumbnail_url: toUploadsUrl(image.thumbnail_path as string) || `/api/images/${image.composite_hash}/thumbnail`,
    // 원본 이미지: 외부 폴더면 API 엔드포인트 사용
    image_url: isExternalImage
      ? `/api/images/${image.composite_hash}/download/original`
      : (image.original_file_path ? toUploadsUrl(image.original_file_path) : null),
    // optimized는 더 이상 생성하지 않음 - 하위 호환성을 위해 thumbnail_url과 동일하게 설정
    optimized_url: toUploadsUrl(image.thumbnail_path as string) || `/api/images/${image.composite_hash}/thumbnail`,

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
