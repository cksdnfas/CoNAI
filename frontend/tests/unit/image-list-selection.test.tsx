import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ImageRecord } from '@/types/image'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter } from '@/features/images/components/image-list-contract'

vi.mock('@/services/settings-api', () => ({
  settingsApi: {
    getSettings: vi.fn().mockResolvedValue({
      tagger: { enabled: false },
    }),
  },
}))

vi.mock('@/components/prompt-display', () => ({
  default: () => null,
}))

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
    prompt: 'sample prompt',
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

describe('image-list selection', () => {
  const adapter = createInfiniteImageListAdapter({
    contextId: 'generation_history',
    infiniteScroll: {
      hasMore: false,
      loadMore: () => undefined,
    },
    total: 1,
  })

  it('toggles stable selection when numeric id is missing', () => {
    const onStableSelectionChange = vi.fn()
    const image = makeImage({ id: undefined, composite_hash: 'hash-without-id' })

    render(
      <ImageList
        images={[image]}
        loading={false}
        selectable={true}
        selection={{
          selectedIds: [],
          onSelectionChange: vi.fn(),
          selectedStableKeys: [],
          onStableSelectionChange,
        }}
        adapter={adapter}
      />, 
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select image hash:hash-without-id' })
    fireEvent.click(checkbox)
    expect(onStableSelectionChange).toHaveBeenCalledWith(['hash:hash-without-id'])
  })

  it('keeps numeric-id selection behavior when stable callbacks are absent', () => {
    const onSelectionChange = vi.fn()
    const image = makeImage({ id: 77, composite_hash: 'hash-77' })

    render(
      <ImageList
        images={[image]}
        loading={false}
        selectable={true}
        selection={{
          selectedIds: [],
          onSelectionChange,
        }}
        adapter={adapter}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select image 77' })
    fireEvent.click(checkbox)
    expect(onSelectionChange).toHaveBeenCalledWith([77])
  })
})
