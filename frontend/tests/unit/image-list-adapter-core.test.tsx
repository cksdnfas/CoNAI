import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ImageRecord } from '@/types/image'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter, createPaginationImageListAdapter } from '@/features/images/components/image-list-contract'

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

describe('image-list adapter-driven core behavior', () => {
  it('keeps home empty-state action behavior through adapter capabilities', () => {
    const openSearch = vi.fn()
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: {
        hasMore: false,
        loadMore: () => undefined,
      },
      capabilities: {
        emptyStateAction: {
          label: 'Open Search',
          onClick: openSearch,
        },
      },
    })

    render(<ImageList images={[]} loading={false} adapter={adapter} />)

    const button = screen.getByRole('button', { name: 'Open Search' })
    fireEvent.click(button)
    expect(openSearch).toHaveBeenCalledTimes(1)
  })

  it('keeps generation-history behavior without empty-state action capability', () => {
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: {
        hasMore: false,
        loadMore: () => undefined,
      },
      total: 0,
    })

    render(<ImageList images={[]} loading={false} adapter={adapter} />)

    expect(screen.queryByRole('button', { name: 'Open Search' })).toBeNull()
  })

  it('keeps group-modal behavior with pagination adapter and no empty-state action', () => {
    const adapter = createPaginationImageListAdapter({
      pagination: {
        currentPage: 1,
        totalPages: 1,
        onPageChange: () => undefined,
        pageSize: 25,
        onPageSizeChange: () => undefined,
      },
      total: 0,
    })

    render(<ImageList images={[]} loading={false} adapter={adapter} />)

    expect(screen.queryByRole('button', { name: 'Open Search' })).toBeNull()
  })

  it('does not branch on context identifiers in shared core', () => {
    const sourcePath = path.resolve(process.cwd(), 'src/features/images/components/image-list.tsx')
    const source = fs.readFileSync(sourcePath, 'utf8')

    expect(source).not.toMatch(/if\s*\(\s*contextId\s*===/)
    expect(source).not.toMatch(/switch\s*\(\s*contextId\s*\)/)
    expect(source).not.toContain('contextId')
  })

  it('still renders image items with adapter contract only', () => {
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: {
        hasMore: false,
        loadMore: () => undefined,
      },
      total: 1,
    })

    render(<ImageList images={[makeImage()]} loading={false} adapter={adapter} />)

    expect(screen.getAllByTestId('image-list-item')).toHaveLength(1)
  })
})
