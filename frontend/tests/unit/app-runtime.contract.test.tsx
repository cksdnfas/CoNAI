import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import App from '@/App'

const { parityAppSpy } = vi.hoisted(() => ({
  parityAppSpy: vi.fn(() => <div data-testid="parity-app-runtime-root" />),
}))

vi.mock('@/app/parity-app', () => ({
  ParityApp: parityAppSpy,
}))

describe('App runtime contract', () => {
  beforeEach(() => {
    parityAppSpy.mockClear()
  })

  it('keeps canonical runtime by mounting ParityApp', () => {
    render(<App />)

    expect(screen.getByTestId('parity-app-runtime-root')).toBeInTheDocument()
    expect(parityAppSpy).toHaveBeenCalledTimes(1)
  })
})
