import { describe, expect, it } from 'vitest'
import type { ImageRecord } from '@/types/image'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id: 1,
    composite_hash: 'hash-1',
    first_seen_date: '2026-01-01T00:00:00.000Z',
    file_id: 1,
    original_file_path: '/images/1.png',
    file_size: 2048,
    mime_type: 'image/png',
    file_type: 'image',
    width: 512,
    height: 512,
    thumbnail_path: '/thumbs/1.png',
    ai_tool: null,
    model_name: null,
    lora_models: null,
    steps: null,
    cfg_scale: null,
    sampler: null,
    seed: null,
    scheduler: null,
    prompt: null,
    negative_prompt: null,
    denoise_strength: null,
    generation_time: null,
    batch_size: null,
    batch_index: null,
    auto_tags: null,
    rating_score: null,
    perceptual_hash: null,
    dhash: null,
    ahash: null,
    color_histogram: null,
    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,
    thumbnail_url: null,
    image_url: null,
    ...overrides,
  }
}

describe('image-preview-url', () => {
  it('returns by-path URL when processing or hash is missing', () => {
    const backendOrigin = 'http://localhost:1666'

    const processingUrl = buildPreviewMediaUrl(
      makeImage({
        composite_hash: 'hash-processing',
        original_file_path: '/images/needs process.png',
        is_processing: true,
      }),
      backendOrigin,
    )
    expect(processingUrl).toBe('http://localhost:1666/api/images/by-path/%2Fimages%2Fneeds%20process.png')

    const missingHashUrl = buildPreviewMediaUrl(
      makeImage({
        composite_hash: null,
        original_file_path: '/images/no-hash.png',
        is_processing: false,
      }),
      backendOrigin,
    )
    expect(missingHashUrl).toBe('http://localhost:1666/api/images/by-path/%2Fimages%2Fno-hash.png')
  })

  it('returns file URL for video and animated types', () => {
    const backendOrigin = 'http://localhost:1666'

    const videoUrl = buildPreviewMediaUrl(makeImage({ composite_hash: 'video-hash', file_type: 'video' }), backendOrigin)
    expect(videoUrl).toBe('http://localhost:1666/api/images/video-hash/file')

    const animatedUrl = buildPreviewMediaUrl(makeImage({ composite_hash: 'animated-hash', file_type: 'animated' }), backendOrigin)
    expect(animatedUrl).toBe('http://localhost:1666/api/images/animated-hash/file')
  })

  it('returns thumbnail URL for image with hash', () => {
    const backendOrigin = 'http://localhost:1666'
    const imageUrl = buildPreviewMediaUrl(makeImage({ composite_hash: 'image-hash', file_type: 'image' }), backendOrigin)

    expect(imageUrl).toBe('http://localhost:1666/api/images/image-hash/thumbnail')
  })
})
