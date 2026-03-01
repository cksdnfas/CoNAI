import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RatingScoreRecalculation } from '@/features/settings/modules/rating/rating-score-recalculation'

const { axiosPostMock } = vi.hoisted(() => ({
  axiosPostMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios')
  return {
    ...actual,
    default: {
      ...actual.default,
      post: axiosPostMock,
      isAxiosError: actual.default.isAxiosError,
    },
  }
})

describe('RatingScoreRecalculation feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows success feedback when recalculation succeeds', async () => {
    axiosPostMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          total: 4,
          success_count: 4,
          fail_count: 0,
        },
      },
    })

    render(<RatingScoreRecalculation />)

    fireEvent.click(screen.getByRole('button', { name: 'rating.recalculation.buttons.recalculate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'rating.recalculation.confirmDialog.confirm' }))

    expect(await screen.findByText('rating.recalculation.success')).toBeInTheDocument()
    expect(axiosPostMock).toHaveBeenCalledWith('/api/images/recalculate-rating-scores')
  })

  it('shows error feedback when recalculation API returns failure', async () => {
    axiosPostMock.mockResolvedValue({
      data: {
        success: false,
        error: 'Recalculation failed from server',
      },
    })

    render(<RatingScoreRecalculation />)

    fireEvent.click(screen.getByRole('button', { name: 'rating.recalculation.buttons.recalculate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'rating.recalculation.confirmDialog.confirm' }))

    expect(await screen.findByText('Recalculation failed from server')).toBeInTheDocument()
  })

  it('shows fallback error feedback when recalculation request throws', async () => {
    axiosPostMock.mockRejectedValue(new Error('network failure'))

    render(<RatingScoreRecalculation />)

    fireEvent.click(screen.getByRole('button', { name: 'rating.recalculation.buttons.recalculate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'rating.recalculation.confirmDialog.confirm' }))

    expect(await screen.findByText('rating.recalculation.failed')).toBeInTheDocument()
  })
})
