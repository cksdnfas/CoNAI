import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from '@/features/home/home-page'

const {
  useInfiniteImagesMock,
  usePaginatedImagesMock,
  useImageListSettingsMock,
  useSearchMock,
} = vi.hoisted(() => ({
  useInfiniteImagesMock: vi.fn(),
  usePaginatedImagesMock: vi.fn(),
  useImageListSettingsMock: vi.fn(),
  useSearchMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-infinite-images', () => ({
  useInfiniteImages: () => useInfiniteImagesMock(),
}))

vi.mock('@/hooks/use-paginated-images', () => ({
  usePaginatedImages: () => usePaginatedImagesMock(),
}))

vi.mock('@/hooks/use-image-list-settings', () => ({
  useImageListSettings: (context: string) => useImageListSettingsMock(context),
}))

vi.mock('@/hooks/use-search', () => ({
  useSearch: () => useSearchMock(),
}))

vi.mock('@/features/home/components/bulk-action-bar', () => ({
  default: () => null,
}))

vi.mock('@/features/home/components/search-bar', () => ({
  default: () => <div data-testid="home-search-panel" />, 
}))

vi.mock('@/features/images/components/image-list', () => ({
  default: ({ adapter }: { adapter: { mode: string; capabilities?: { emptyStateAction?: { label?: string; onClick: () => void } } } }) => (
    <div>
      <div data-testid="image-list-mode">{adapter.mode}</div>
      {adapter.capabilities?.emptyStateAction ? (
        <button type="button" onClick={adapter.capabilities.emptyStateAction.onClick}>
          {adapter.capabilities.emptyStateAction.label ?? 'Open Search'}
        </button>
      ) : null}
    </div>
  ),
}))

const setViewModeMock = vi.fn()
const setGridColumnsMock = vi.fn()

function createImage(id: number) {
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
    thumbnail_path: '/thumb.png',
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
  }
}

describe('home-page parity behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useImageListSettingsMock.mockImplementation((context: string) => ({
      settings: {
        viewMode: 'grid',
        gridColumns: 3,
        activeScrollMode: context === 'search' ? 'pagination' : 'infinite',
        pageSize: 50,
      },
      setViewMode: setViewModeMock,
      setGridColumns: setGridColumnsMock,
    }))

    useInfiniteImagesMock.mockReturnValue({
      images: [createImage(1), createImage(2)],
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refreshImages: vi.fn(),
    })

    usePaginatedImagesMock.mockReturnValue({
      images: [createImage(3)],
      loading: false,
      error: null,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      total: 1,
      setPage: vi.fn(),
      setPageSize: vi.fn(),
      refreshImages: vi.fn(),
    })

    useSearchMock.mockReturnValue({
      images: [],
      loading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      total: 0,
      currentPage: 1,
      totalPages: 1,
      pageSize: 25,
      changePage: vi.fn(),
      changePageSize: vi.fn(),
      searchComplex: vi.fn(),
      refreshSearch: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses home infinite-list adapter with open-search empty action behavior', async () => {
    render(<HomePage />)

    expect(screen.getByTestId('image-list-mode')).toHaveTextContent('infinite')

    fireEvent.click(screen.getByRole('button', { name: 'Open Search' }))

    expect(await screen.findByText('common:search')).toBeInTheDocument()
    expect(screen.getByTestId('home-search-panel')).toBeInTheDocument()
  })

  it('closes layout options via Escape and restores keyboard focus to FAB', async () => {
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      })

    render(<HomePage />)

    const fab = screen.getByTestId('home-layout-options-fab')
    fireEvent.click(fab)
    expect(screen.getByTestId('home-layout-options-panel')).toBeInTheDocument()

    ;(document.body as HTMLElement).focus()
    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('home-layout-options-panel')).not.toBeInTheDocument()
      expect(fab).toHaveFocus()
    })

    requestAnimationFrameMock.mockRestore()
  })
})
