import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RatingScoreSettings from '@/features/settings/bridges/rating-score-settings'

const {
  saveRatingWeightsMock,
  getRatingWeightsMock,
  getAllRatingTiersMock,
  createRatingTierMock,
  updateRatingTierMock,
  deleteRatingTierMock,
  calculateRatingScoreMock,
} = vi.hoisted(() => ({
  saveRatingWeightsMock: vi.fn(),
  getRatingWeightsMock: vi.fn(),
  getAllRatingTiersMock: vi.fn(),
  createRatingTierMock: vi.fn(),
  updateRatingTierMock: vi.fn(),
  deleteRatingTierMock: vi.fn(),
  calculateRatingScoreMock: vi.fn(),
}))

vi.mock('@/features/settings/modules/rating/rating-score-api', () => ({
  getRatingWeights: getRatingWeightsMock,
  saveRatingWeights: saveRatingWeightsMock,
  getAllRatingTiers: getAllRatingTiersMock,
  createRatingTier: createRatingTierMock,
  updateRatingTier: updateRatingTierMock,
  deleteRatingTier: deleteRatingTierMock,
  calculateRatingScore: calculateRatingScoreMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

describe('RatingScoreSettings bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRatingWeightsMock.mockResolvedValue({
      id: 1,
      general_weight: 25,
      sensitive_weight: 25,
      questionable_weight: 25,
      explicit_weight: 25,
      created_at: '',
      updated_at: '',
    })
    getAllRatingTiersMock.mockResolvedValue([])
  })

  it('shows success feedback when saving weights succeeds', async () => {
    saveRatingWeightsMock.mockResolvedValue({
      id: 1,
      general_weight: 25,
      sensitive_weight: 25,
      questionable_weight: 25,
      explicit_weight: 25,
      created_at: '',
      updated_at: '',
    })

    render(<RatingScoreSettings />)

    fireEvent.change(await screen.findByRole('slider', { name: /rating\.weights\.general/i }), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByRole('slider', { name: /rating\.weights\.sensitive/i }), {
      target: { value: '20' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'rating.weights.buttons.save' }))

    expect(await screen.findByText('rating.weights.alerts.saveSuccess')).toBeInTheDocument()
  })

  it('shows error feedback when saving weights fails', async () => {
    saveRatingWeightsMock.mockRejectedValue(new Error('save failed'))

    render(<RatingScoreSettings />)

    fireEvent.change(await screen.findByRole('slider', { name: /rating\.weights\.general/i }), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByRole('slider', { name: /rating\.weights\.sensitive/i }), {
      target: { value: '20' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'rating.weights.buttons.save' }))

    expect(await screen.findByText('rating.weights.alerts.saveFailed')).toBeInTheDocument()
  })
})
