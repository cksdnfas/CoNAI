import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThumbnailCard } from '@/features/image-groups/components/thumbnail-card'

describe('ThumbnailCard', () => {
  it('hides subtitle and badges blocks when metadata is missing', () => {
    render(
      <ThumbnailCard
        ariaLabel="Images card"
        onClick={() => {}}
        title={<span>Images</span>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Images card' })).toBeInTheDocument()
    expect(screen.queryByTestId('thumbnail-card-subtitle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('thumbnail-card-badges')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumbnail-card-fallback')).toBeInTheDocument()
  })

  it('supports selectable and read-only modes without leaking click behavior', () => {
    const onClick = vi.fn()
    const onSelectedChange = vi.fn()

    const { rerender } = render(
      <ThumbnailCard
        ariaLabel="Selectable card"
        onClick={onClick}
        title={<span>Selectable</span>}
        selectable={true}
        selected={false}
        onSelectedChange={onSelectedChange}
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Selectable card' })
    fireEvent.click(checkbox)

    expect(onSelectedChange).toHaveBeenCalledWith(true)
    expect(onClick).not.toHaveBeenCalled()

    rerender(
      <ThumbnailCard
        ariaLabel="Selectable card"
        onClick={onClick}
        title={<span>Selectable</span>}
        selectable={true}
        selected={true}
        readOnly={true}
        onSelectedChange={onSelectedChange}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Selectable card' })).toBeDisabled()
  })
})
