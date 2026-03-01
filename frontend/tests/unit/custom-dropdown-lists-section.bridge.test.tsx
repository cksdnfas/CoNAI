import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomDropdownListsSection from '@/features/image-generation/bridges/custom-dropdown-lists-section'

const { getAllListsMock, createListMock, deleteListMock } = vi.hoisted(() => ({
  getAllListsMock: vi.fn(),
  createListMock: vi.fn(),
  deleteListMock: vi.fn(),
}))

vi.mock('@/services/custom-dropdown-list-api', () => ({
  customDropdownListApi: {
    getAllLists: getAllListsMock,
    createList: createListMock,
    deleteList: deleteListMock,
  },
}))

function renderBridge() {
  render(<CustomDropdownListsSection />)
}

describe('CustomDropdownListsSection bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads lists and supports create flow for manual dropdowns', async () => {
    getAllListsMock
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            name: 'Auto List',
            description: 'auto source',
            items: ['a', 'b'],
            is_auto_collected: true,
            source_path: 'models/checkpoints',
            created_date: '2026-01-01',
            updated_date: '2026-01-01',
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            name: 'Auto List',
            description: 'auto source',
            items: ['a', 'b'],
            is_auto_collected: true,
            source_path: 'models/checkpoints',
            created_date: '2026-01-01',
            updated_date: '2026-01-01',
          },
          {
            id: 2,
            name: 'Manual List',
            description: 'manual desc',
            items: ['cat', 'dog'],
            is_auto_collected: false,
            source_path: undefined,
            created_date: '2026-01-01',
            updated_date: '2026-01-01',
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            name: 'Auto List',
            description: 'auto source',
            items: ['a', 'b'],
            is_auto_collected: true,
            source_path: 'models/checkpoints',
            created_date: '2026-01-01',
            updated_date: '2026-01-01',
          },
        ],
      })
    createListMock.mockResolvedValue({ success: true })
    deleteListMock.mockResolvedValue({ success: true })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderBridge()

    expect(await screen.findByText('Custom Dropdown Lists')).toBeInTheDocument()
    expect(await screen.findByText('Auto List')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add list/i }))
    fireEvent.change(screen.getByRole('textbox', { name: 'List name' }), { target: { value: 'Manual List' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'List items' }), {
      target: { value: 'cat\ndog\ndog' },
    })

    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))

    await waitFor(() => {
      expect(createListMock).toHaveBeenCalledWith({
        name: 'Manual List',
        description: undefined,
        items: ['cat', 'dog'],
      })
    })

    fireEvent.click(screen.getByRole('tab', { name: /Manual/i }))
    expect(await screen.findByText('Manual List')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete Manual List/i }))
    await waitFor(() => {
      expect(deleteListMock).toHaveBeenCalledWith(2)
    })
    expect(await screen.findByText('No manual custom dropdown lists found.')).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it('shows visible error feedback and remains interactive when list loading fails', async () => {
    getAllListsMock.mockRejectedValue(new Error('Custom dropdown load failed'))

    renderBridge()

    expect(await screen.findByText('Custom dropdown load failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add List/i })).toBeInTheDocument()
  })
})
