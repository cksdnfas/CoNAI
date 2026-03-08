import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupWithStats } from '@conai/shared'
import type { ImageRecord } from '@/types/image'
import GroupImageGridModal from '@/features/image-groups/components/group-image-grid-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { success: false },
    isFetching: false,
  }),
}))

vi.mock('@/hooks/use-image-list-settings', () => ({
  useImageListSettings: () => ({
    settings: {
      activeScrollMode: 'pagination',
    },
  }),
}))

vi.mock('@/services/settings-api', () => ({
  settingsApi: {
    getSettings: vi.fn().mockResolvedValue({
      tagger: { enabled: false },
    }),
  },
}))

vi.mock('@/components/prompt-display', () => ({
  default: () => <div data-testid="prompt-display">Prompt content</div>,
}))

vi.mock('@/features/image-groups/components/group-assign-modal', () => ({
  default: () => null,
}))

vi.mock('@/features/image-groups/components/lora-dataset-dialog', () => ({
  default: () => null,
}))

function makeImage(id: number, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id,
    composite_hash: `hash-${id}`,
    first_seen_date: '2026-01-01T00:00:00.000Z',
    file_id: id,
    original_file_path: `/images/${id}.png`,
    file_size: 1024,
    mime_type: 'image/png',
    file_type: 'image',
    width: 512,
    height: 512,
    thumbnail_path: `/thumbs/${id}.png`,
    ai_tool: null,
    model_name: null,
    lora_models: null,
    steps: null,
    cfg_scale: null,
    sampler: null,
    seed: null,
    scheduler: null,
    prompt: `prompt-${id}`,
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
    groups: [{ id: 1, name: 'Group 1', collection_type: 'manual' }],
    ...overrides,
  }
}

function makeGroup(id: number): GroupWithStats {
  return {
    id,
    name: `Group ${id}`,
    created_date: '2026-01-01T00:00:00.000Z',
    updated_date: '2026-01-01T00:00:00.000Z',
    auto_collect_enabled: false,
    image_count: 1,
    auto_collected_count: 0,
    manual_added_count: 1,
  }
}

describe('group image grid modal nested viewer dialog parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes nested viewer on first Escape and group modal on second Escape', async () => {
    const onClose = vi.fn()
    const group = makeGroup(1)

    render(
      <GroupImageGridModal
        open={true}
        onClose={onClose}
        images={[makeImage(1)]}
        loading={false}
        currentGroup={group}
        allGroups={[]}
        total={1}
      />,
    )

    fireEvent.click(screen.getByTestId('image-list-item'))
    expect(screen.getByTestId('image-viewer-dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('image-viewer-dialog')).not.toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()

    const secondEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    secondEscape.preventDefault()
    window.dispatchEvent(secondEscape)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exposes a stable scroll target for viewer metadata sidebar', () => {
    const group = makeGroup(1)

    render(
      <GroupImageGridModal
        open={true}
        onClose={vi.fn()}
        images={[makeImage(1)]}
        loading={false}
        currentGroup={group}
        allGroups={[]}
        total={1}
      />,
    )

    fireEvent.click(screen.getByTestId('image-list-item'))

    const sidebar = screen.getByTestId('viewer-sidebar-scroll')
    sidebar.scrollTop = 240
    fireEvent.scroll(sidebar)
    expect(sidebar.scrollTop).toBe(240)
  })
})
