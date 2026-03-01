import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GroupTileBase } from '@/features/image-groups/components/group-tile-base'

describe('GroupTileBase', () => {
  it('renders title, subtitle, badges, preview, and secondary action slots', () => {
    const onClick = vi.fn()

    render(
      <GroupTileBase
        ariaLabel="Example group"
        onClick={onClick}
        title={<span>Example group</span>}
        subtitle={<span>Example subtitle</span>}
        badges={<span>Badge one</span>}
        preview={<img src="/preview.png" alt="Preview tile" />}
        secondaryAction={<button type="button">More</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Example group' })).toBeInTheDocument()
    expect(screen.getByText('Example group')).toBeInTheDocument()
    expect(screen.getByText('Example subtitle')).toBeInTheDocument()
    expect(screen.getByText('Badge one')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Preview tile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.getByTestId('group-tile-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('group-tile-fallback')).not.toBeInTheDocument()
  })

  it('renders fallback state when preview is absent', () => {
    render(
      <GroupTileBase
        ariaLabel="No preview group"
        onClick={() => {}}
        title="No preview group"
      />,
    )

    expect(screen.getByRole('button', { name: 'No preview group' })).toBeInTheDocument()
    expect(screen.getByTestId('group-tile-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('group-tile-preview')).not.toBeInTheDocument()
  })
})
