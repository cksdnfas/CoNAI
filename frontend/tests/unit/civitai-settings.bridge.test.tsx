import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/modules/civitai-settings-feature', () => ({
  CivitaiSettingsFeature: () => {
    throw new Error('civitai bridge crash')
  },
}))

import { CivitaiSettings } from '@/features/settings/bridges/civitai-settings'

describe('CivitaiSettings bridge', () => {
  it('shows explicit failure feedback instead of crashing when civitai module fails', async () => {
    render(<CivitaiSettings />)

    expect(await screen.findByText('Failed to load Civitai settings. Please refresh and try again.')).toBeInTheDocument()
  })
})
