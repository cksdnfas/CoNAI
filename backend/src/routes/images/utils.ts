import { toUploadsUrl } from '../../config/runtimePaths';

function toRuntimeRelativeUrl(relativePath: string | null | undefined): string | null {
  const absoluteOrPublicUrl = toUploadsUrl(relativePath);
  if (!absoluteOrPublicUrl) {
    return null;
  }

  try {
    const parsed = new URL(absoluteOrPublicUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return absoluteOrPublicUrl;
  }
}

/**
 * 이미지 레코드에 URL과 구조화된 메타데이터 추가 (레거시)
 * @deprecated 새 코드에서는 enrichImageWithFileView 사용
 */
export function enrichImageRecord(image: any) {
  const enriched = {
    ...image,
    thumbnail_url: toRuntimeRelativeUrl(image.thumbnail_path as string)!,
    image_url: toRuntimeRelativeUrl(image.file_path as string)!,

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
        negative_prompt: image.negative_prompt,
        character_prompt_text: image.character_prompt_text || null
      },
      raw_nai_parameters: image.raw_nai_parameters ? JSON.parse(image.raw_nai_parameters) : null
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
function buildBaseImageWithFileView(image: any) {
  const isExternalImage = image.original_file_path && require('path').isAbsolute(image.original_file_path);
  const isProcessing = !image.composite_hash;
  const staticThumbnailUrl = image.thumbnail_path ? toRuntimeRelativeUrl(image.thumbnail_path) : null;

  return {
    ...image,
    id: image.file_id || image.id,
    is_processing: isProcessing,
    thumbnail_url: isProcessing
      ? `/api/images/by-path/${encodeURIComponent(image.original_file_path)}`
      : (staticThumbnailUrl || `/api/images/${image.composite_hash}/thumbnail`),
    image_url: isProcessing
      ? `/api/images/by-path/${encodeURIComponent(image.original_file_path)}`
      : (isExternalImage
        ? `/api/images/${image.composite_hash}/download/original`
        : (image.original_file_path ? toRuntimeRelativeUrl(image.original_file_path) : null)),
    groups: image.groups || [],
  };
}

export function enrichImageWithFileView(image: any) {
  const enriched = {
    ...buildBaseImageWithFileView(image),

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
        negative_prompt: image.negative_prompt,
        character_prompt_text: image.character_prompt_text || null
      },
      raw_nai_parameters: image.raw_nai_parameters
        ? (typeof image.raw_nai_parameters === 'string' ? JSON.parse(image.raw_nai_parameters) : image.raw_nai_parameters)
        : null
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


export function enrichCompactImageWithFileView(image: any) {
  return buildBaseImageWithFileView({
    composite_hash: image.composite_hash,
    width: image.width,
    height: image.height,
    thumbnail_path: image.thumbnail_path,
    rating_score: image.rating_score,
    first_seen_date: image.first_seen_date,
    metadata_updated_date: image.metadata_updated_date,
    file_id: image.file_id,
    id: image.id,
    original_file_path: image.original_file_path,
    file_size: image.file_size,
    mime_type: image.mime_type,
    file_status: image.file_status,
    scan_date: image.scan_date,
    file_type: image.file_type,
    groups: image.groups || [],
  });
}
