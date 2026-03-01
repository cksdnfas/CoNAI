import { createElement, useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImageRecord } from '@/types/image'
import { useGroupPreviewImage } from '@/features/image-groups/hooks/use-group-preview-image'

type PreviewResponse = { success: boolean; data?: ImageRecord[] }

interface HookHarnessProps {
  groupId: number
  fetchPreviewImages: (groupId: number) => Promise<PreviewResponse>
  onError?: (error: unknown) => void
  onPreview: (preview: ImageRecord | null) => void
}

function HookHarness({ groupId, fetchPreviewImages, onError, onPreview }: HookHarnessProps) {
  const preview = useGroupPreviewImage({
    groupId,
    fetchPreviewImages,
    onError,
  })

  useEffect(() => {
    onPreview(preview)
  }, [onPreview, preview])

  return null
}

function makeImage(overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    composite_hash: 'hash-1',
    first_seen_date: '2026-03-01T00:00:00.000Z',
    file_id: 1,
    original_file_path: '/tmp/image.png',
    file_size: 123,
    mime_type: 'image/png',
    file_type: 'image',
    width: 512,
    height: 512,
    thumbnail_path: '/tmp/thumb.png',
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

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error?: unknown) => void = () => {}

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('useGroupPreviewImage', () => {
  it('returns first preview image on successful fetch', async () => {
    const fetchPreviewImages = vi.fn<HookHarnessProps['fetchPreviewImages']>().mockResolvedValue({
      success: true,
      data: [makeImage({ composite_hash: 'hash-1' }), makeImage({ composite_hash: 'hash-2' })],
    })
    const onPreview = vi.fn<HookHarnessProps['onPreview']>()

    render(createElement(HookHarness, { groupId: 11, fetchPreviewImages, onPreview }))

    await waitFor(() => {
      expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ composite_hash: 'hash-1' }))
    })

    expect(fetchPreviewImages).toHaveBeenCalledWith(11)
  })

  it('clears preview and reports error when fetch rejects', async () => {
    const fetchPreviewImages = vi.fn<HookHarnessProps['fetchPreviewImages']>()
      .mockResolvedValueOnce({ success: true, data: [makeImage({ composite_hash: 'loaded-hash' })] })
      .mockRejectedValueOnce(new Error('preview failed'))
    const onError = vi.fn<NonNullable<HookHarnessProps['onError']>>()
    const onPreview = vi.fn<HookHarnessProps['onPreview']>()

    const { rerender } = render(createElement(HookHarness, { groupId: 11, fetchPreviewImages, onError, onPreview }))

    await waitFor(() => {
      expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ composite_hash: 'loaded-hash' }))
    })

    rerender(createElement(HookHarness, { groupId: 12, fetchPreviewImages, onError, onPreview }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(onPreview).toHaveBeenLastCalledWith(null)
    })

    expect(fetchPreviewImages).toHaveBeenNthCalledWith(1, 11)
    expect(fetchPreviewImages).toHaveBeenNthCalledWith(2, 12)
  })

  it('does not update state or report error after unmount (disposed)', async () => {
    const deferred = createDeferred<PreviewResponse>()
    const fetchPreviewImages = vi.fn<HookHarnessProps['fetchPreviewImages']>().mockImplementation(() => deferred.promise)
    const onError = vi.fn<NonNullable<HookHarnessProps['onError']>>()
    const onPreview = vi.fn<HookHarnessProps['onPreview']>()

    const { unmount } = render(createElement(HookHarness, { groupId: 21, fetchPreviewImages, onError, onPreview }))
    unmount()

    await act(async () => {
      deferred.reject(new Error('late failure'))
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })
})
