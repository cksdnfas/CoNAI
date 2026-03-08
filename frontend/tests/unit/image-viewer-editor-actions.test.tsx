import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImageRecord } from '@/types/image'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter } from '@/features/images/components/image-list-contract'
import { imageApi } from '@/services/image-api'

vi.mock('@/services/image-api', () => ({
  imageApi: {
    getImage: vi.fn(),
  },
}))

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

vi.mock('@/features/images/editor/image-editor-modal', () => ({
  ImageEditorModal: ({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved?: () => void | Promise<void> }) => {
    if (!open) {
      return null
    }

    return (
      <div data-testid="image-editor-modal-mock">
        <button type="button" onClick={() => onOpenChange(false)}>Cancel Editor</button>
        <button
          type="button"
          onClick={async () => {
            await onSaved?.()
            onOpenChange(false)
          }}
        >
          Save Editor
        </button>
      </div>
    )
  },
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
    ...overrides,
  }
}

describe('image viewer editor actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(imageApi.getImage).mockResolvedValue({
      success: true,
      data: makeImage(1),
    })
  })

  it('shows stable viewer edit action for editable image and opens/closes editor modal', async () => {
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: { hasMore: false, loadMore: () => undefined },
      total: 1,
    })

    render(<ImageList images={[makeImage(1)]} loading={false} adapter={adapter} />)

    fireEvent.click(screen.getByTestId('image-list-item'))
    const editAction = await screen.findByTestId('viewer-edit-action')
    expect(editAction).toBeInTheDocument()

    fireEvent.click(editAction)
    expect(screen.getByTestId('image-editor-modal-mock')).toBeInTheDocument()

    const mockEditor = screen.getByTestId('image-editor-modal-mock')
    const cancelButton = mockEditor.querySelector('button') as HTMLButtonElement
    fireEvent.click(cancelButton)
    await waitFor(() => {
      expect(screen.queryByTestId('image-editor-modal-mock')).toBeNull()
    })
    expect(screen.getByTestId('image-viewer-dialog')).toBeInTheDocument()
  })

  it('hides edit action for unsupported media and missing required identifiers', async () => {
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: { hasMore: false, loadMore: () => undefined },
      total: 1,
    })

    const { rerender } = render(<ImageList images={[makeImage(1, { file_type: 'video' })]} loading={false} adapter={adapter} />)
    fireEvent.click(screen.getByTestId('image-list-item'))
    expect(screen.queryByTestId('viewer-edit-action')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    rerender(<ImageList images={[makeImage(2, { file_id: null })]} loading={false} adapter={adapter} />)
    fireEvent.click(screen.getByTestId('image-list-item'))
    expect(await screen.findByTestId('viewer-edit-action')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('viewer-edit-action'))
    await waitFor(() => {
      expect(screen.getByTestId('image-editor-modal-mock')).toBeInTheDocument()
    })

    const mockEditor = screen.getByTestId('image-editor-modal-mock')
    const cancelButton = mockEditor.querySelector('button') as HTMLButtonElement
    fireEvent.click(cancelButton)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    rerender(<ImageList images={[makeImage(3, { composite_hash: null })]} loading={false} adapter={adapter} />)
    fireEvent.click(screen.getByTestId('image-list-item'))
    expect(screen.queryByTestId('viewer-edit-action')).toBeNull()
  })

  it('runs post-save refresh callback exactly once', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: { hasMore: false, loadMore: () => undefined },
      total: 1,
      viewerEditor: {
        onSave,
      },
    })

    render(<ImageList images={[makeImage(1)]} loading={false} adapter={adapter} />)

    fireEvent.click(screen.getByTestId('image-list-item'))
    fireEvent.click(await screen.findByTestId('viewer-edit-action'))
    const mockEditor = screen.getByTestId('image-editor-modal-mock')
    const saveButton = mockEditor.querySelectorAll('button')[1] as HTMLButtonElement
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(imageApi.getImage).toHaveBeenCalledTimes(1)
  })

  it('keeps action hidden when image lacks required hash', async () => {
    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: { hasMore: false, loadMore: () => undefined },
      total: 1,
    })

    render(<ImageList images={[makeImage(9, { composite_hash: null })]} loading={false} adapter={adapter} />)
    fireEvent.click(screen.getByTestId('image-list-item'))
    expect(screen.queryByTestId('viewer-edit-action')).toBeNull()
  })

  it('does not open editor when lazy file_id resolution is invalid', async () => {
    vi.mocked(imageApi.getImage).mockResolvedValueOnce({
      success: true,
      data: makeImage(11, { file_id: null }),
    })

    const adapter = createInfiniteImageListAdapter({
      infiniteScroll: { hasMore: false, loadMore: () => undefined },
      total: 1,
    })

    render(<ImageList images={[makeImage(11, { file_id: null })]} loading={false} adapter={adapter} />)

    fireEvent.click(screen.getByTestId('image-list-item'))
    fireEvent.click(await screen.findByTestId('viewer-edit-action'))

    await waitFor(() => {
      expect(imageApi.getImage).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('image-editor-modal-mock')).toBeNull()
  })
})
