import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GroupAssignModal from '@/features/image-groups/components/group-assign-modal'

const { useAllGroupsWithHierarchyMock } = vi.hoisted(() => ({
  useAllGroupsWithHierarchyMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-groups', () => ({
  useAllGroupsWithHierarchy: () => useAllGroupsWithHierarchyMock(),
}))

describe('group-assign modal parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters current group and assigns selected target group', async () => {
    useAllGroupsWithHierarchyMock.mockReturnValue({
      data: [
        { id: 1, name: 'Current Group', depth: 0 },
        { id: 2, name: 'Target Group', depth: 0 },
        { id: 3, name: 'Nested Group', depth: 1 },
      ],
      isLoading: false,
      error: null,
    })

    const onAssign = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <GroupAssignModal
        open={true}
        onClose={onClose}
        selectedImageCount={3}
        currentGroupId={1}
        onAssign={onAssign}
      />,
    )

    const select = screen.getByRole('combobox')
    expect(screen.queryByRole('option', { name: 'Current Group' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Target Group' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '-- Nested Group' })).toBeInTheDocument()

    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'imageGroups:assignModal.buttonAssign' }))

    await waitFor(() => {
      expect(onAssign).toHaveBeenCalledWith(2)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('shows loading error state and keeps assign disabled', () => {
    useAllGroupsWithHierarchyMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('load failed'),
    })

    render(
      <GroupAssignModal
        open={true}
        onClose={vi.fn()}
        selectedImageCount={1}
        onAssign={vi.fn()}
      />,
    )

    expect(screen.getByText('imageGroups:assignModal.loadError')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'imageGroups:assignModal.buttonAssign' })).toBeDisabled()
  })
})
