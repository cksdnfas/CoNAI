import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptExplorer } from '@/features/settings/bridges/prompt-explorer'

const {
  searchPromptsMock,
  getGroupsMock,
} = vi.hoisted(() => ({
  searchPromptsMock: vi.fn(),
  getGroupsMock: vi.fn(),
}))

vi.mock('@/services/prompt-api', () => ({
  promptCollectionApi: {
    searchPrompts: searchPromptsMock,
    assignPromptToGroup: vi.fn(),
    deletePrompt: vi.fn(),
  },
  promptGroupApi: {
    getGroups: getGroupsMock,
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
  },
}))

describe('PromptExplorer bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getGroupsMock.mockResolvedValue({
      success: true,
      data: [
        { id: 1, group_name: 'Portraits', parent_id: null, display_order: 0, prompt_count: 2 },
      ],
    })
  })

  it('renders explorer layout and calls search API with selected type', async () => {
    searchPromptsMock.mockResolvedValue({
      success: true,
      data: [
        { id: 1, prompt: 'sunset lighting', usage_count: 12, type: 'positive', group_id: 1 },
        { id: 2, prompt: 'cinematic framing', usage_count: 7, type: 'positive', group_id: 1 },
      ],
    })

    render(<PromptExplorer type="positive" />)

    expect(await screen.findByText('All Prompts')).toBeInTheDocument()
    expect((await screen.findAllByText('Portraits')).length).toBeGreaterThan(0)
    expect(await screen.findByText('sunset lighting')).toBeInTheDocument()
    expect(screen.getByText('cinematic framing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()

    await waitFor(() => {
      expect(searchPromptsMock).toHaveBeenCalledWith('', 'positive', 1, 200, 'usage_count', 'DESC', null)
    })
  })

  it('shows error feedback when search API fails and component remains mounted', async () => {
    searchPromptsMock.mockRejectedValue(new Error('Prompt fetch failed'))

    render(<PromptExplorer type="negative" />)

    expect(await screen.findByText('Prompt fetch failed')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search prompts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})
