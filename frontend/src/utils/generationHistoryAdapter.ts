import type { GenerationHistoryRecord } from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../types/image';

/**
 * GenerationHistoryRecord를 ImageRecord 형식으로 변환
 * ImageMasonry 컴포넌트에서 사용할 수 있도록 어댑터 패턴 적용
 * ComfyUI와 NovelAI 모두 지원
 */
export const convertHistoryToImageRecord = (
  history: GenerationHistoryRecord
): ImageRecord => {
  // ComfyUI와 NovelAI 구분
  const isComfyUI = history.service_type === 'comfyui';

  // ComfyUI 메타데이터 파싱 (metadata 필드에 저장된 추가 정보)
  let parsedMetadata: any = {};
  try {
    if (history.metadata && typeof history.metadata === 'string') {
      parsedMetadata = JSON.parse(history.metadata);
    }
  } catch (e) {
    console.warn('Failed to parse history metadata:', e);
  }

  // 서비스별 파라미터 매핑
  const steps = isComfyUI ? parsedMetadata.steps : history.nai_steps;
  const cfg_scale = isComfyUI ? parsedMetadata.cfg_scale : history.nai_scale;
  const sampler = isComfyUI ? parsedMetadata.sampler : history.nai_sampler;
  const seed = isComfyUI ? parsedMetadata.seed : (history.nai_seed ? Number(history.nai_seed) : null);
  const scheduler = isComfyUI ? parsedMetadata.scheduler : null;
  const model_name = isComfyUI ? parsedMetadata.model : history.nai_model;

  // Both ComfyUI and NovelAI use linked_image_id when available (after upload to main images API)
  // Fallback to direct API/images/ paths only if linked_image_id is not set
  const useImageId = history.linked_image_id;

  // 디버깅: 이미지 경로가 없는 경우 경고
  if (!useImageId && !history.thumbnail_path && !history.original_path) {
    console.warn(`[History Adapter] History ${history.id} has no valid image paths:`, {
      id: history.id,
      service_type: history.service_type,
      generation_status: history.generation_status,
      linked_image_id: history.linked_image_id,
      thumbnail_path: history.thumbnail_path,
      original_path: history.original_path
    });
  }

  return {
    // 기본 이미지 정보
    id: history.id!,
    filename: history.original_path || `history_${history.id}`,
    original_name: history.original_path || 'Generated Image',
    file_path: history.original_path || '',
    thumbnail_path: history.thumbnail_path || '',
    optimized_path: null,
    file_size: history.file_size || 0,
    mime_type: 'image/png',
    width: history.width || null,
    height: history.height || null,
    upload_date: history.created_at,
    metadata: history.metadata || null,

    // AI 메타데이터 - 서비스별 매핑
    ai_tool: isComfyUI ? 'ComfyUI' : 'NovelAI',
    model_name: model_name || null,
    lora_models: null,
    steps: steps || null,
    cfg_scale: cfg_scale || null,
    sampler: sampler || null,
    seed: seed,
    scheduler: scheduler || null,
    prompt: history.positive_prompt || null,
    negative_prompt: history.negative_prompt || null,
    denoise_strength: null,
    generation_time: null,
    batch_size: null,
    batch_index: null,
    auto_tags: null,

    // 이미지 유사도 검색 필드
    perceptual_hash: null,
    color_histogram: null,

    // 동영상 전용 메타데이터
    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,

    // URL 필드
    // ComfyUI: linked_image_id를 통해 메인 images API 사용 (/api/images/{id}/thumbnail)
    // NovelAI: API/images/에 직접 저장된 경로 사용 (/uploads/API/images/...)
    thumbnail_url: useImageId
      ? `/api/images/${history.linked_image_id}/thumbnail`
      : (history.thumbnail_path ? `/uploads/${history.thumbnail_path}` : undefined),
    image_url: useImageId
      ? `/api/images/${history.linked_image_id}/image`
      : (history.original_path ? `/uploads/${history.original_path}` : undefined),
    optimized_url: useImageId
      ? `/api/images/${history.linked_image_id}/optimized`
      : (history.optimized_path ? `/uploads/${history.optimized_path}` : undefined),

    // 그룹 정보 없음
    groups: [],

    // AI 메타데이터 구조화
    ai_metadata: {
      ai_tool: isComfyUI ? 'ComfyUI' : 'NovelAI',
      model_name: model_name || null,
      lora_models: null,
      generation_params: {
        steps: steps || null,
        cfg_scale: cfg_scale || null,
        sampler: sampler || null,
        seed: seed,
        scheduler: scheduler || null,
        denoise_strength: null,
        generation_time: null,
        batch_size: null,
        batch_index: null,
      },
      prompts: {
        prompt: history.positive_prompt || null,
        negative_prompt: history.negative_prompt || null,
      },
    },
  };
};

/**
 * 여러 GenerationHistoryRecord를 ImageRecord 배열로 변환
 */
export const convertHistoriesToImageRecords = (
  histories: GenerationHistoryRecord[]
): ImageRecord[] => {
  return histories.map(convertHistoryToImageRecord);
};
