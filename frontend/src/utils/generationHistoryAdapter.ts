import type { GenerationHistoryRecord } from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../types/image';

/**
 * Extended GenerationHistoryRecord with metadata JOIN fields
 */
export interface GenerationHistoryRecordWithMetadata extends GenerationHistoryRecord {
  actual_composite_hash?: string | null;
  actual_thumbnail_path?: string | null;
  actual_optimized_path?: string | null;
}

/**
 * GenerationHistoryRecord를 ImageRecord 형식으로 변환
 * ImageMasonry 컴포넌트에서 사용할 수 있도록 어댑터 패턴 적용
 * ComfyUI와 NovelAI 모두 지원
 *
 * actual_* 필드 우선 사용 (image_files/image_metadata JOIN 결과)
 * 없으면 history 자체 필드로 fallback (아직 처리 안된 이미지)
 */
export const convertHistoryToImageRecord = (
  history: GenerationHistoryRecordWithMetadata
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

  // 히스토리 이미지는 항상 히스토리 폴더(uploads/API/images/)의 이미지를 사용
  // linked_image_id는 메타데이터로만 보관 (향후 참조용)

  // ✅ actual_* 필드 우선 사용 (image_files/image_metadata JOIN 결과)
  // 없으면 history 자체 필드로 fallback (아직 처리 안된 이미지)
  const composite_hash = history.actual_composite_hash || `history_${history.id}`;
  const thumbnail_path = history.actual_thumbnail_path || history.thumbnail_path || '';
  const optimized_path = history.actual_optimized_path || history.optimized_path || null;

  // 디버깅: 이미지 경로가 없는 경우 경고
  if (!thumbnail_path && !history.original_path) {
    console.warn(`[History Adapter] History ${history.id} has no valid image paths:`, {
      id: history.id,
      service_type: history.service_type,
      generation_status: history.generation_status,
      actual_thumbnail_path: history.actual_thumbnail_path,
      thumbnail_path: history.thumbnail_path,
      original_path: history.original_path
    });
  }

  return {
    // ✅ New structure - Primary identification
    composite_hash,  // Use actual composite_hash if available
    first_seen_date: history.created_at,      // Replaces upload_date

    // File information (from image_files table JOIN)
    file_id: null,                             // History records don't have file_id yet
    original_file_path: history.original_path || null,  // Replaces file_path
    file_size: history.file_size || null,
    mime_type: 'image/png',
    file_status: 'active' as const,

    // Image metadata - use actual values with fallback
    width: history.width || 0,
    height: history.height || 0,
    thumbnail_path,
    optimized_path,

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
    dhash: null,
    ahash: null,
    color_histogram: null,

    // 동영상 전용 메타데이터
    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,

    // URL 필드
    // ✅ actual_* 필드 우선 사용, 없으면 유효한 composite_hash로 API 라우트 사용, 최후엔 original_path
    thumbnail_url: thumbnail_path
      ? `/uploads/${thumbnail_path}`
      : (composite_hash && !composite_hash.startsWith('history_'))
        ? `/api/images/${composite_hash}/thumbnail`  // 유효한 해시면 API 라우트 사용
        : (history.original_path ? `/uploads/${history.original_path}` : ''),
    image_url: history.original_path ? `/uploads/${history.original_path}` : null,
    optimized_url: optimized_path
      ? `/uploads/${optimized_path}`
      : (composite_hash && !composite_hash.startsWith('history_'))
        ? `/api/images/${composite_hash}/optimized`  // 유효한 해시면 API 라우트 사용
        : null,

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
  histories: (GenerationHistoryRecord | GenerationHistoryRecordWithMetadata)[]
): ImageRecord[] => {
  return histories.map(convertHistoryToImageRecord);
};
