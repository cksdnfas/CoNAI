import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationHistoryList } from '@/features/workflows/components/generation-history-list'

const {
  getAllMock,
  getByWorkflowMock,
  cleanupFailedMock,
} = vi.hoisted(() => ({
  getAllMock: vi.fn(),
  getByWorkflowMock: vi.fn(),
  cleanupFailedMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/services/generation-history-api', () => ({
  generationHistoryApi: {
    getAll: getAllMock,
    getByWorkflow: getByWorkflowMock,
    cleanupFailed: cleanupFailedMock,
  },
}))

vi.mock('@/features/images/components/image-list', () => ({
  default: ({ images, adapter }: { images: unknown[]; adapter: { mode: string; infiniteScroll?: { hasMore: boolean; loadMore: () => void } } }) => (
    <div>
      <div data-testid="history-image-count">{images.length}</div>
      {adapter.mode === 'infinite' && adapter.infiniteScroll?.hasMore ? (
        <button type="button" onClick={adapter.infiniteScroll.loadMore}>Load more</button>
      ) : null}
    </div>
  ),
}))

function makeRecord(id: number, status: 'success' | 'failed' = 'success') {
  return {
    id,
    workflow_id: 10,
    service_type: 'comfyui',
    generation_status: status,
    original_path: `/outputs/${id}.png`,
    positive_prompt: `prompt-${id}`,
    negative_prompt: null,
    metadata: JSON.stringify({ steps: 20, cfg_scale: 7, sampler: 'euler', seed: 11 }),
    width: 512,
    height: 512,
    file_size: 2048,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    nai_steps: null,
    nai_scale: null,
    nai_sampler: null,
    nai_seed: null,
    nai_model: null,
    actual_composite_hash: null,
    actual_width: null,
    actual_height: null,
    actual_auto_tags: null,
  }
}

describe('generation-history list parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanupFailedMock.mockResolvedValue({ deleted: 0 })
  })

  it('loads first page and keeps infinite-load offset contract for next page', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => makeRecord(index + 1))
    const secondPage = [makeRecord(51)]

    getAllMock
      .mockResolvedValueOnce({ records: firstPage })
      .mockResolvedValueOnce({ records: secondPage })

    render(<GenerationHistoryList serviceType="comfyui" />)

    await waitFor(() => {
      expect(getAllMock).toHaveBeenCalledWith({
        service_type: 'comfyui',
        limit: 50,
        offset: 0,
        bustCache: false,
      })
    })

    expect(screen.getByTestId('history-image-count')).toHaveTextContent('50')

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getAllMock).toHaveBeenLastCalledWith({
        service_type: 'comfyui',
        limit: 50,
        offset: 50,
      })
    })

    expect(screen.getByTestId('history-image-count')).toHaveTextContent('51')
  })

  it('stops showing infinite-load control after a load-more failure', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => makeRecord(index + 1))

    getAllMock
      .mockResolvedValueOnce({ records: firstPage })
      .mockRejectedValueOnce(new Error('load-more failed'))

    render(<GenerationHistoryList serviceType="comfyui" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    })
  })
})
