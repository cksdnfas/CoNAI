import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AutoFolderGroupWithStats } from '@conai/shared'
import { AutoFolderGroupCard } from '@/features/image-groups/components/auto-folder-group-card'

const mockUseGroupPreviewImage = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`,
  }),
}))

vi.mock('@/features/image-groups/hooks/use-group-preview-image', () => ({
  useGroupPreviewImage: (...args: unknown[]) => mockUseGroupPreviewImage(...args),
}))

function makeGroup(overrides: Partial<AutoFolderGroupWithStats> = {}): AutoFolderGroupWithStats {
  return {
    id: 12,
    folder_path: 'images/auto/cats',
    absolute_path: '/mnt/images/auto/cats',
    display_name: 'Auto Cats',
    parent_id: null,
    depth: 0,
    has_images: true,
    image_count: 7,
    created_date: '2026-03-01T00:00:00.000Z',
    last_updated: '2026-03-01T00:00:00.000Z',
    child_count: 3,
    ...overrides,
  }
}

describe('AutoFolderGroupCard', () => {
  it('renders folder path and count badges while composing GroupTileBase fallback', () => {
    mockUseGroupPreviewImage.mockReturnValue(null)

    render(<AutoFolderGroupCard group={makeGroup()} onClick={() => {}} />)

    expect(screen.getByTestId('group-tile-fallback')).toBeInTheDocument()
    expect(screen.getByText('images/auto/cats')).toBeInTheDocument()
    expect(screen.getByText('groupCard.imageCount:7')).toBeInTheDocument()
    expect(screen.getByText('groupCard.folderCount:3')).toBeInTheDocument()
  })

  it('does not leak settings/edit action controls into auto-folder card', () => {
    mockUseGroupPreviewImage.mockReturnValue(null)

    render(<AutoFolderGroupCard group={makeGroup({ child_count: 0 })} onClick={() => {}} />)

    const cardButton = screen.getByRole('button', { name: 'Auto Cats' })
    expect(cardButton).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /settings|edit/i })).not.toBeInTheDocument()
    expect(screen.queryByText('groupCard.folderCount:0')).not.toBeInTheDocument()
  })
})
