import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id: 1,
    composite_hash: 'hash-1',
    first_seen_date: '2026-01-01T00:00:00.000Z',
    file_id: 1,
    original_file_path: '/images/1.png',
    file_size: 1024,
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

describe('image viewer transform controls', () => {
  it('renders all required transform control test IDs', () => {
    render(
      <ImageViewerDialog
        images={[makeImage()]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    expect(screen.getByTestId('viewer-zoom-in')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-zoom-out')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-rotate-left')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-rotate-right')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-flip-h')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-flip-v')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-reset')).toBeInTheDocument()
  })

  it('enforces zoom min/max bounds', () => {
    render(
      <ImageViewerDialog
        images={[makeImage()]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const media = screen.getByRole('img', { name: 'sample prompt' })
    const zoomIn = screen.getByTestId('viewer-zoom-in')
    const zoomOut = screen.getByTestId('viewer-zoom-out')

    for (let i = 0; i < 20; i += 1) {
      fireEvent.click(zoomIn)
    }
    expect(media).toHaveStyle({ transform: 'translate(0px, 0px) rotate(0deg) scale(5, 5)' })

    for (let i = 0; i < 40; i += 1) {
      fireEvent.click(zoomOut)
    }
    expect(media).toHaveStyle({ transform: 'translate(0px, 0px) rotate(0deg) scale(0.1, 0.1)' })
  })

  it('allows pan only when zoomed and resets transform when active image changes', () => {
    const firstImage = makeImage({ composite_hash: 'hash-1', prompt: 'first prompt' })
    const secondImage = makeImage({ composite_hash: 'hash-2', prompt: 'second prompt', original_file_path: '/images/2.png' })
    const onViewerIndexChange = vi.fn()

    const { rerender } = render(
      <ImageViewerDialog
        images={[firstImage, secondImage]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    const media = screen.getByRole('img', { name: 'first prompt' })
    fireEvent.mouseDown(media, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 90, clientY: 100 })
    fireEvent.mouseUp(document)
    expect(media).toHaveStyle({ transform: 'translate(0px, 0px) rotate(0deg) scale(1, 1)' })

    fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    fireEvent.click(screen.getByTestId('viewer-rotate-right'))
    fireEvent.click(screen.getByTestId('viewer-flip-h'))
    fireEvent.mouseDown(media, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 100, clientY: 130 })
    fireEvent.mouseUp(document)
    expect(media.style.transform).toContain('translate(90px, 120px)')

    rerender(
      <ImageViewerDialog
        images={[firstImage, secondImage]}
        viewerIndex={1}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={onViewerIndexChange}
      />,
    )

    const nextMedia = screen.getByRole('img', { name: 'second prompt' })
    expect(nextMedia).toHaveStyle({ transform: 'translate(0px, 0px) rotate(0deg) scale(1, 1)' })
  })

  it('applies transform styles to video rendering', () => {
    render(
      <ImageViewerDialog
        images={[
          makeImage({
            file_type: 'video',
            mime_type: 'video/mp4',
            prompt: 'video prompt',
            composite_hash: 'video-hash',
            original_file_path: '/videos/1.mp4',
          }),
        ]}
        viewerIndex={0}
        backendOrigin="http://localhost:1666"
        onViewerIndexChange={() => undefined}
      />,
    )

    const video = document.querySelector('video')
    expect(video).not.toBeNull()

    fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    expect(video).toHaveStyle({ transform: 'translate(0px, 0px) rotate(0deg) scale(1.2, 1.2)' })
  })
})
