import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { GroupCard } from '@/features/image-groups/components/group-card'

const mockUseGroupPreviewImage = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`,
  }),
}))

vi.mock('@/features/image-groups/hooks/use-group-preview-image', () => ({
  useGroupPreviewImage: (...args: unknown[]) => mockUseGroupPreviewImage(...args),
}))

function makeGroup(overrides: Partial<GroupWithStats & { child_count?: number; has_children?: boolean }> = {}) {
  return {
    id: 42,
    name: 'Custom Group',
    created_date: '2026-03-01T00:00:00.000Z',
    updated_date: '2026-03-01T00:00:00.000Z',
    auto_collect_enabled: true,
    image_count: 3,
    auto_collected_count: 0,
    manual_added_count: 3,
    child_count: 2,
    has_children: true,
    ...overrides,
  }
}

describe('GroupCard', () => {
  it('composes GroupTileBase fallback while preserving custom badges', () => {
    mockUseGroupPreviewImage.mockReturnValue(null)

    render(<GroupCard group={makeGroup()} onClick={() => {}} onSettingsClick={() => {}} />)

    expect(screen.getByTestId('group-tile-fallback')).toBeInTheDocument()
    expect(screen.getByText('groupCard.imageCount:3')).toBeInTheDocument()
    expect(screen.getByText('groupCard.subgroupCount:2')).toBeInTheDocument()
  })

  it('keeps settings click isolated from card navigation click', () => {
    mockUseGroupPreviewImage.mockReturnValue(null)
    const onClick = vi.fn()
    const onSettingsClick = vi.fn()

    render(<GroupCard group={makeGroup()} onClick={onClick} onSettingsClick={onSettingsClick} />)

    const cardButton = screen.getByRole('button', { name: 'Custom Group' })
    const settingsButton = screen.getAllByRole('button').find((button) => button !== cardButton)

    expect(settingsButton).toBeDefined()
    fireEvent.click(settingsButton!)

    expect(onSettingsClick).toHaveBeenCalledWith(42)
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.click(cardButton)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
