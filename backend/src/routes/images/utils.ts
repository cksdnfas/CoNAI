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
 * Phase 1 지원: composite_hash가 NULL인 경우 원본 파일 사용
 */
export function enrichImageWithFileView(image: any) {
  // 외부 폴더 이미지인지 확인 (original_file_path가 절대 경로)
  const isExternalImage = image.original_file_path && require('path').isAbsolute(image.original_file_path);

  // Phase 1: composite_hash가 없는 경우 (빠른 등록만 완료)
  const isProcessing = !image.composite_hash;

  const enriched = {
    ...image,
    // Phase 1 상태 플래그
    is_processing: isProcessing,

    // 썸네일: composite_hash가 있으면 썸네일 사용, 없으면 원본 사용
    thumbnail_url: isProcessing
      ? `/api/images/by-path/${encodeURIComponent(image.original_file_path)}`
      : (toUploadsUrl(image.thumbnail_path as string) || `/api/images/${image.composite_hash}/thumbnail`),

    // 원본 이미지
    image_url: isProcessing
      ? `/api/images/by-path/${encodeURIComponent(image.original_file_path)}`
      : (isExternalImage
        ? `/api/images/${image.composite_hash}/download/original`
        : (image.original_file_path ? toUploadsUrl(image.original_file_path) : null)),

    // optimized: Phase 1이면 null, 아니면 thumbnail과 동일
    optimized_url: isProcessing
      ? null
      : (toUploadsUrl(image.thumbnail_path as string) || `/api/images/${image.composite_hash}/thumbnail`),

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
