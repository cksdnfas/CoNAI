import type { GenerationHistoryRecord } from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../types/image';
import { buildUploadsUrl } from './backend';

/**
 * Extended GenerationHistoryRecord with media metadata JOIN fields
 */
export interface GenerationHistoryRecordWithMetadata extends GenerationHistoryRecord {
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  actual_auto_tags?: string | null;
}

/**
 * GenerationHistoryRecord를 ImageRecord 형식으로 변환
 * ImageMasonry 컴포넌트에서 사용할 수 있도록 어댑터 패턴 적용
 * ComfyUI와 NovelAI 모두 지원
 *
 * actual_* 필드 우선 사용 (image_files/media_metadata JOIN 결과)
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
  // linked_composite_hash는 메타데이터로만 보관 (향후 참조용)

  // ✅ actual_composite_hash로 메타데이터 등록 여부 판단
  // actual_composite_hash가 null이면 null 유지 (fallback ID 사용 안 함)
  const composite_hash = history.actual_composite_hash ?? null;
  const hasMetadata = !!composite_hash; // 메타데이터 DB에 등록되었는지 여부

  // 디버깅: composite_hash가 null인 경우 로그 출력
  if (!composite_hash) {
    console.log('[History Adapter] composite_hash is null for history:', {
      id: history.id,
      service_type: history.service_type,
      original_path: history.original_path,
      actual_composite_hash: history.actual_composite_hash
    });
  }

  // 디버깅: 이미지 경로가 없는 경우 경고
  if (!hasMetadata && !history.original_path) {
    console.warn(`[History Adapter] History ${history.id} has no valid image paths:`, {
      id: history.id,
      service_type: history.service_type,
      generation_status: history.generation_status,
      hasMetadata,
      actual_composite_hash: history.actual_composite_hash,
      original_path: history.original_path
    });
  }

  // 파일 타입 및 MIME 타입 감지 (파일 확장자 기반)
  const detectFileTypeAndMimeType = (filePath: string | null | undefined): { file_type: 'image' | 'video' | 'animated'; mime_type: string } => {
    if (!filePath) return { file_type: 'image', mime_type: 'image/png' };

    const ext = filePath.toLowerCase().split('.').pop() || '';

    // GIF는 animated로 분류
    if (ext === 'gif') {
      return { file_type: 'animated', mime_type: 'image/gif' };
    }

    // APNG는 animated로 분류
    if (ext === 'apng') {
      return { file_type: 'animated', mime_type: 'image/apng' };
    }

    // 비디오 파일
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo'
      };
      return { file_type: 'video', mime_type: mimeTypes[ext] || 'video/mp4' };
    }

    // 이미지 파일
    const imageMimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      tif: 'image/tiff'
    };

    return {
      file_type: 'image',
      mime_type: imageMimeTypes[ext] || 'image/png'
    };
  };

  const { file_type, mime_type } = detectFileTypeAndMimeType(history.original_path);

  // Parse auto_tags if available
  let parsedAutoTags: any = null;
  if (history.actual_auto_tags) {
    try {
      parsedAutoTags = typeof history.actual_auto_tags === 'string'
        ? JSON.parse(history.actual_auto_tags)
        : history.actual_auto_tags;
    } catch (e) {
      console.warn('Failed to parse auto_tags:', e);
    }
  }

  return {
    // ✅ New structure - Primary identification
    composite_hash,  // Use actual composite_hash if available
    first_seen_date: history.created_at ?? null,      // Replaces upload_date

    // File information (from image_files table JOIN)
    file_id: null,                             // History records don't have file_id yet
    file_type,                                 // Detect from file extension
    original_file_path: history.original_path ?? null,  // Replaces file_path
    file_size: history.file_size ?? null,
    mime_type,                                 // Detect from file extension
    file_status: 'active' as const,

    // Media metadata - 메타데이터 있으면 실제 이미지 크기 사용, 없으면 히스토리 DB 크기 사용
    width: hasMetadata ? (history.actual_width ?? history.width ?? 0) : (history.width ?? 0),
    height: hasMetadata ? (history.actual_height ?? history.height ?? 0) : (history.height ?? 0),
    thumbnail_path: '', // Thumbnails are served via API route using composite_hash

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
    auto_tags: parsedAutoTags,
    rating_score: null,  // Generation history doesn't have rating scores

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
    // ✅ 간단한 로직: 메타데이터 있으면 API 라우트, 없으면 히스토리 원본 경로
    // composite_hash가 null이면 항상 original_path 사용 (잘못된 API 요청 방지)
    // buildUploadsUrl은 null을 반환할 수 있으므로 || null로 명시적 처리
    thumbnail_url: (hasMetadata && composite_hash)
      ? `/api/images/${composite_hash}/thumbnail`
      : (buildUploadsUrl(history.original_path) || null),
    image_url: (hasMetadata && composite_hash)
      ? `/api/images/${composite_hash}/file`
      : (buildUploadsUrl(history.original_path) || null),

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
