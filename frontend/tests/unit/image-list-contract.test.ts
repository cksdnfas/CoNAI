import { describe, expect, it } from 'vitest'
import type { ImageRecord } from '@/types/image'
import {
  createInfiniteImageListAdapter,
  createPaginationImageListAdapter,
  getImageStableIdentity,
} from '@/features/images/components/image-list-contract'

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id: 10,
    composite_hash: 'hash-10',
    first_seen_date: '2026-01-01T00:00:00.000Z',
    file_id: 10,
    original_file_path: '/images/10.png',
    file_size: 1024,
    mime_type: 'image/png',
    file_type: 'image',
    width: 512,
    height: 512,
    thumbnail_path: '/thumbs/10.png',
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

describe('image-list-contract', () => {
  it('returns numeric id identity when id exists', () => {
    const identity = getImageStableIdentity(makeImage({ id: 77, composite_hash: 'hash-77' }), 0)
    expect(identity).toEqual({
      numericId: 77,
      stableKey: 'id:77',
    })
  })

  it('uses hash based stable key when numeric id is missing', () => {
    const noIdImage = makeImage({ id: undefined, composite_hash: 'hash-without-id' })
    const identityAtZero = getImageStableIdentity(noIdImage, 0)
    const identityAtFive = getImageStableIdentity(noIdImage, 5)

    expect(identityAtZero.numericId).toBeNull()
    expect(identityAtZero.stableKey).toBe('hash:hash-without-id')
    expect(identityAtFive.stableKey).toBe(identityAtZero.stableKey)
  })

  it('falls back to path and then deterministic fallback key', () => {
    const pathIdentity = getImageStableIdentity(makeImage({ id: undefined, composite_hash: null, original_file_path: '/images/no-id.png' }), 2)
    expect(pathIdentity.stableKey).toBe('path:/images/no-id.png')

    const fallbackIdentity = getImageStableIdentity(makeImage({ id: undefined, composite_hash: null, original_file_path: null, file_id: null }), 3)
    expect(fallbackIdentity.stableKey).toBe('fallback:2026-01-01T00:00:00.000Z:3')
  })

  it('builds explicit mode-specific adapters', () => {
    const infiniteAdapter = createInfiniteImageListAdapter({
      contextId: 'home',
      infiniteScroll: {
        hasMore: true,
        loadMore: () => undefined,
      },
      total: 12,
    })
    expect(infiniteAdapter.mode).toBe('infinite')
    expect(infiniteAdapter.total).toBe(12)

    const paginationAdapter = createPaginationImageListAdapter({
      contextId: 'search',
      pagination: {
        currentPage: 2,
        totalPages: 10,
        onPageChange: () => undefined,
        pageSize: 50,
        onPageSizeChange: () => undefined,
      },
      total: 500,
    })
    expect(paginationAdapter.mode).toBe('pagination')
    expect(paginationAdapter.pagination?.pageSize).toBe(50)
  })
})
