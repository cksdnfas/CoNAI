import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/modules/auth-settings-feature', () => ({
  AuthSettingsFeature: () => {
    throw new Error('auth bridge crash')
  },
}))

import { AuthSettings } from '@/features/settings/bridges/auth-settings'

describe('AuthSettings bridge', () => {
  it('shows explicit failure feedback instead of crashing when account module fails', async () => {
    render(<AuthSettings />)

    expect(await screen.findByText('Failed to load account settings. Please refresh and try again.')).toBeInTheDocument()
  })
})
