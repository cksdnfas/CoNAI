import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WildcardPage from '@/features/image-generation/bridges/wildcard-page'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

const {
  getWildcardsHierarchicalMock,
  getLastScanLogMock,
} = vi.hoisted(() => ({
  getWildcardsHierarchicalMock: vi.fn(),
  getLastScanLogMock: vi.fn(),
}))

vi.mock('@/services/wildcard-api', () => ({
  wildcardApi: {
    getWildcardsHierarchical: getWildcardsHierarchicalMock,
    getLastScanLog: getLastScanLogMock,
  },
}))

function renderPage(mode?: 'manual' | 'chain' | 'auto') {
  render(<WildcardPage mode={mode} />)
}

describe('WildcardPage bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLastScanLogMock.mockResolvedValue({ data: null })
  })

  it('loads manual wildcard tree and updates detail panel selection', async () => {
    getWildcardsHierarchicalMock.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'root-folder',
          description: 'root description',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [{ id: 101, wildcard_id: 1, tool: 'comfyui', content: 'root item', weight: 1, order_index: 0, created_date: '2026-01-01' }],
          children: [
            {
              id: 2,
              name: 'child-leaf',
              description: 'child description',
              parent_id: 1,
              include_children: 1,
              only_children: 0,
              type: 'wildcard',
              chain_option: 'replace',
              created_date: '2026-01-01',
              updated_date: '2026-01-01',
              is_auto_collected: 0,
              items: [{ id: 102, wildcard_id: 2, tool: 'comfyui', content: 'child item', weight: 1, order_index: 0, created_date: '2026-01-01' }],
              children: [],
            },
          ],
        },
        {
          id: 3,
          name: 'chain-root',
          description: 'chain description',
          parent_id: null,
          include_children: 0,
          only_children: 0,
          type: 'chain',
          chain_option: 'append',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [{ id: 103, wildcard_id: 3, tool: 'comfyui', content: 'chain item', weight: 1, order_index: 0, created_date: '2026-01-01' }],
          children: [],
        },
        {
          id: 4,
          name: 'auto-root',
          description: 'auto description',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 1,
          items: [{ id: 104, wildcard_id: 4, tool: 'comfyui', content: 'auto item', weight: 1, order_index: 0, created_date: '2026-01-01' }],
          children: [],
        },
      ],
    })

    renderPage('manual')

    expect(await screen.findByText('root-folder')).toBeInTheDocument()
    expect(screen.queryByText('chain-root')).not.toBeInTheDocument()
    expect(screen.queryByText('auto-root')).not.toBeInTheDocument()
    expect(screen.getByText('wildcards:detail.selectItem')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'root-folder' })).toBeInTheDocument()
  })

  it('shows visible error feedback and remains interactive when wildcard load fails', async () => {
    getWildcardsHierarchicalMock.mockRejectedValue(new Error('wildcard load failed'))

    renderPage('manual')

    expect(await screen.findByText('wildcards:tabs.manual')).toBeInTheDocument()
    expect(await screen.findByText('wildcard load failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    await waitFor(() => {
      expect(screen.getByText('wildcards:page.noWildcards')).toBeInTheDocument()
    })
  })

  it('renders chain mode with chain-only nodes', async () => {
    getWildcardsHierarchicalMock.mockResolvedValue({
      data: [
        {
          id: 11,
          name: 'manual-node',
          description: 'manual',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [],
          children: [],
        },
        {
          id: 12,
          name: 'chain-node',
          description: 'chain',
          parent_id: null,
          include_children: 0,
          only_children: 0,
          type: 'chain',
          chain_option: 'append',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [],
          children: [],
        },
      ],
    })

    renderPage('chain')

    expect(await screen.findByText('chain-node')).toBeInTheDocument()
    expect(screen.queryByText('manual-node')).not.toBeInTheDocument()
  })

  it('renders auto mode controls and last scan log', async () => {
    getWildcardsHierarchicalMock.mockResolvedValue({
      data: [
        {
          id: 21,
          name: 'auto-node',
          description: 'auto',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 1,
          items: [],
          children: [],
        },
      ],
    })

    getLastScanLogMock.mockResolvedValue({
      data: {
        timestamp: '2026-01-01T00:00:00.000Z',
        loraWeight: 1,
        duplicateHandling: 'number',
        totalWildcards: 1,
        totalItems: 2,
        wildcards: [{ id: 21, name: 'auto-node', itemCount: 2, folderName: 'loras' }],
      },
    })

    renderPage('auto')

    expect(await screen.findByText('wildcards:tabs.autoCollected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'wildcards:autoCollect.scanButton' })).toBeInTheDocument()
    expect(screen.getByText('wildcards:autoCollect.folderPath')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'wildcards:buttons.openLogDialog' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'wildcards:buttons.openLogDialog' }))
    expect(await screen.findByText('wildcards:logDialog.title')).toBeInTheDocument()
    expect(await screen.findByText(/wildcards:autoCollect.scanLog.totalWildcards: 1/)).toBeInTheDocument()
  })
})
