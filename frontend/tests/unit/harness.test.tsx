import React from 'react'
import { render, screen } from '@testing-library/react'

function HarnessSample() {
  return <button type="button">Harness Ready</button>
}

describe('frontend harness', () => {
  it('renders a basic interactive element', () => {
    render(<HarnessSample />)

    expect(screen.getByRole('button', { name: 'Harness Ready' })).toBeInTheDocument()
  })
})
