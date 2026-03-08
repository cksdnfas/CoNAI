import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImageRecord } from '@/types/image'
import { ImageViewerDialog } from '@/features/images/viewer/image-viewer-dialog'

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

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
}

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

describe('image viewer modal parity navigation', () => {
  it('supports pointer previous and next navigation buttons', () => {
    const images = [makeImage(1), makeImage(2), makeImage(3)]
    const onViewerIndexChange = vi.fn()

    render(
      <ImageViewerDialog
        images={images}
        viewerIndex={1}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onViewerIndexChange).toHaveBeenNthCalledWith(1, 0)
    expect(onViewerIndexChange).toHaveBeenNthCalledWith(2, 2)
  })

  it('renders neutral visible viewer title without prompt text', () => {
    const images = [makeImage(1), makeImage(2), makeImage(3)]

    render(
      <ImageViewerDialog
        images={images}
        viewerIndex={1}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const title = screen.getByTestId('viewer-title')
    expect(title).toHaveTextContent('Image 2 of 3')
    expect(title).not.toHaveTextContent('prompt-2')
  })

  it('reveals file info deterministically via desktop hover and click/tap toggle', () => {
    render(
      <ImageViewerDialog
        images={[makeImage(1)]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const trigger = screen.getByTestId('viewer-file-info-trigger')
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByText('Filename')).not.toBeInTheDocument()

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    expect(screen.getAllByText('Filename').length).toBeGreaterThan(0)

    expect(screen.getAllByText('Filename').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1.png').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dimensions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('512 x 512').length).toBeGreaterThan(0)
    expect(screen.getAllByText('File size').length).toBeGreaterThan(0)
    expect(screen.getAllByText('First seen').length).toBeGreaterThan(0)

    fireEvent.click(trigger)
    expect(screen.queryAllByText('Filename')).toHaveLength(0)

    fireEvent.click(trigger)
    expect(screen.getAllByText('Filename').length).toBeGreaterThan(0)
  })

  it('keeps responsive shell bounds for mobile and desktop', () => {
    render(
      <ImageViewerDialog
        images={[makeImage(1)]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const dialog = screen.getByTestId('image-viewer-dialog')
    expect(dialog.className).toContain('h-[100dvh]')
    expect(dialog.className).toContain('w-[100vw]')
    expect(dialog.className).toContain('sm:h-[82vh]')
    expect(dialog.className).toContain('sm:w-[82vw]')
  })

  it('supports ArrowLeft and ArrowRight keyboard navigation while open', () => {
    const images = [makeImage(1), makeImage(2), makeImage(3)]
    const onViewerIndexChange = vi.fn()

    render(
      <ImageViewerDialog
        images={images}
        viewerIndex={1}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(onViewerIndexChange).toHaveBeenNthCalledWith(1, 0)
    expect(onViewerIndexChange).toHaveBeenNthCalledWith(2, 2)
  })

  it('closes viewer on Escape', () => {
    const onViewerIndexChange = vi.fn()

    render(
      <ImageViewerDialog
        images={[makeImage(1)]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onViewerIndexChange).toHaveBeenCalledWith(null)
  })

  it('triggers random action on Space only when adapter random handler exists', async () => {
    const images = [makeImage(1)]
    const onViewerIndexChange = vi.fn()
    const random = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: ' ' })
    expect(random).not.toHaveBeenCalled()

    rerender(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
        actionAdapter={{ random }}
      />,
    )

    fireEvent.keyDown(window, { key: ' ' })

    await waitFor(() => {
      expect(random).toHaveBeenCalledTimes(1)
    })
  })

  it('cleans keydown listeners on close, unmount, and remount without duplicates', () => {
    const images = [makeImage(1), makeImage(2)]
    const onViewerIndexChange = vi.fn()

    const { rerender, unmount } = render(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onViewerIndexChange).toHaveBeenCalledTimes(1)
    expect(onViewerIndexChange).toHaveBeenLastCalledWith(1)

    rerender(
      <ImageViewerDialog
        images={images}
        viewerIndex={null}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onViewerIndexChange).toHaveBeenCalledTimes(1)

    rerender(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onViewerIndexChange).toHaveBeenCalledTimes(2)

    unmount()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onViewerIndexChange).toHaveBeenCalledTimes(2)

    cleanup()
    render(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onViewerIndexChange).toHaveBeenCalledTimes(3)
  })

  it('prevents wheel default action on viewer media with a cancelable event', () => {
    const images = [makeImage(1)]

    render(
      <ImageViewerDialog
        images={images}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const media = screen.getByRole('img', { name: 'prompt-1' })
    const wheelEvent = createEvent.wheel(media, { deltaY: 120, cancelable: true })
    const dispatchResult = media.dispatchEvent(wheelEvent)

    expect(wheelEvent.cancelable).toBe(true)
    expect(dispatchResult).toBe(false)
    expect(wheelEvent.defaultPrevented).toBe(true)
  })
})
