import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

const {
  getWildcardsHierarchicalMock,
  getLastScanLogMock,
  getAllListsMock,
} = vi.hoisted(() => ({
  getWildcardsHierarchicalMock: vi.fn(),
  getLastScanLogMock: vi.fn(),
  getAllListsMock: vi.fn(),
}))

vi.mock('@/services/wildcard-api', () => ({
  wildcardApi: {
    getWildcardsHierarchical: getWildcardsHierarchicalMock,
    getLastScanLog: getLastScanLogMock,
  },
}))

vi.mock('@/services/custom-dropdown-list-api', () => ({
  customDropdownListApi: {
    getAllLists: getAllListsMock,
    createList: vi.fn(),
    deleteList: vi.fn(),
  },
}))

vi.mock('@/features/image-generation/nai/components/nai-basic-settings', () => ({
  default: function MockNAIBasicSettings({ params, onChange }: { params: { prompt: string }; onChange: React.Dispatch<React.SetStateAction<{ prompt: string }>> }) {
    return (
      <section>
        <h3>NAI Basic Settings</h3>
        <p data-testid="nai-basic-prompt">{params.prompt}</p>
        <button
          type="button"
          onClick={() =>
            onChange((previous) => ({
              ...previous,
              prompt: 'updated-basic-prompt',
            }))
          }
        >
          Update basic prompt
        </button>
      </section>
    )
  },
}))

vi.mock('@/features/image-generation/nai/components/nai-sampling-settings', () => ({
  default: function MockNAISamplingSettings({ params, onChange }: { params: { steps: number }; onChange: React.Dispatch<React.SetStateAction<{ steps: number }>> }) {
    return (
      <section>
        <h3>NAI Sampling Settings</h3>
        <p data-testid="nai-sampling-steps">{params.steps}</p>
        <button
          type="button"
          onClick={() =>
            onChange((previous) => ({
              ...previous,
              steps: 42,
            }))
          }
        >
          Update sampling steps
        </button>
      </section>
    )
  },
}))

vi.mock('@/features/image-generation/nai/components/nai-output-settings', () => ({
  default: function MockNAIOutputSettings({ params, onChange }: { params: { n_samples: number }; onChange: React.Dispatch<React.SetStateAction<{ n_samples: number }>> }) {
    return (
      <section>
        <h3>NAI Output Settings</h3>
        <p data-testid="nai-output-samples">{params.n_samples}</p>
        <button
          type="button"
          onClick={() =>
            onChange((previous) => ({
              ...previous,
              n_samples: 3,
            }))
          }
        >
          Update output samples
        </button>
      </section>
    )
  },
}))

import WildcardPage from '@/features/image-generation/bridges/wildcard-page'
import CustomDropdownListsSection from '@/features/image-generation/bridges/custom-dropdown-lists-section'
import NAIBasicSettings from '@/features/image-generation/bridges/nai-basic-settings'
import NAISamplingSettings from '@/features/image-generation/bridges/nai-sampling-settings'
import NAIOutputSettings from '@/features/image-generation/bridges/nai-output-settings'

describe('Image generation post-restore parity contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLastScanLogMock.mockResolvedValue({ data: null })
  })

  it('renders wildcard management parity across manual/chain/auto modes', async () => {
    getWildcardsHierarchicalMock.mockResolvedValue({
      data: [
        {
          id: 10,
          name: 'animals',
          description: 'animal tags',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [{ id: 100, wildcard_id: 10, tool: 'comfyui', content: 'cat', weight: 1, order_index: 0, created_date: '2026-01-01' }],
          children: [],
        },
        {
          id: 11,
          name: 'prep-chain',
          description: 'chain flow',
          parent_id: null,
          include_children: 0,
          only_children: 0,
          type: 'chain',
          chain_option: 'append',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 0,
          items: [{ id: 101, wildcard_id: 11, tool: 'comfyui', content: 'prep', weight: 1, order_index: 0, created_date: '2026-01-01' }],
          children: [],
        },
        {
          id: 12,
          name: 'lora-auto',
          description: 'auto flow',
          parent_id: null,
          include_children: 1,
          only_children: 0,
          type: 'wildcard',
          chain_option: 'replace',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
          is_auto_collected: 1,
          items: [{ id: 102, wildcard_id: 12, tool: 'comfyui', content: 'lora', weight: 1, order_index: 0, created_date: '2026-01-01' }],
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
        totalItems: 1,
        wildcards: [{ id: 12, name: 'lora-auto', itemCount: 1, folderName: 'loras' }],
      },
    })

    const rendered = render(<WildcardPage mode="manual" />)

    expect(await screen.findByRole('heading', { name: /Wildcard|wildcards:tabs\.manual/ })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('common:messages.loading')).not.toBeInTheDocument()
    })
    fireEvent.click(await screen.findByRole('button', { name: 'animals' }))
    expect(await screen.findByRole('button', { name: '++animals++' })).toBeInTheDocument()

    rendered.rerender(<WildcardPage mode="chain" />)
    expect(await screen.findByRole('heading', { name: /Preprocessing|wildcards:tabs\.chain/ })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('common:messages.loading')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('prep-chain')).toBeInTheDocument()
    expect(screen.queryByText('animals')).not.toBeInTheDocument()

    rendered.rerender(<WildcardPage mode="auto" />)
    expect(await screen.findByRole('heading', { name: /Auto-Collected \(LORA\)|wildcards:tabs\.autoCollected/ })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('common:messages.loading')).not.toBeInTheDocument()
    })
    expect(await screen.findByText(/LORA Wildcard Auto-Generation|wildcards:autoCollect\.description/)).toBeInTheDocument()
    expect(screen.getByText(/Select LORA Folder|wildcards:autoCollect\.folderPath/)).toBeInTheDocument()
  })

  it('renders custom dropdown management with heading and actionable controls', async () => {
    getAllListsMock.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Auto Model List',
          description: 'from model scan',
          items: ['a', 'b'],
          is_auto_collected: true,
          source_path: 'models/checkpoints',
          created_date: '2026-01-01',
          updated_date: '2026-01-01',
        },
      ],
    })

    render(<CustomDropdownListsSection />)

    expect(await screen.findByRole('heading', { name: 'Custom Dropdown Lists' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add List' })).toBeInTheDocument()
    expect(await screen.findByText('Auto Model List')).toBeInTheDocument()
  })

  it('renders NAI basic settings and updates state through onChange', async () => {
    function BasicHarness() {
      const [params, setParams] = React.useState({ prompt: 'initial-basic-prompt' })
      return (
        <div>
          <NAIBasicSettings params={params as never} onChange={setParams as never} />
          <p data-testid="basic-harness-prompt">{params.prompt}</p>
        </div>
      )
    }

    render(<BasicHarness />)

    expect(screen.getByRole('heading', { name: 'NAI Basic Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update basic prompt' }))
    await waitFor(() => {
      expect(screen.getByTestId('basic-harness-prompt')).toHaveTextContent('updated-basic-prompt')
    })
  })

  it('renders NAI sampling settings and updates state through onChange', async () => {
    function SamplingHarness() {
      const [params, setParams] = React.useState({ steps: 28 })
      return (
        <div>
          <NAISamplingSettings params={params as never} onChange={setParams as never} />
          <p data-testid="sampling-harness-steps">{params.steps}</p>
        </div>
      )
    }

    render(<SamplingHarness />)

    expect(screen.getByRole('heading', { name: 'NAI Sampling Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update sampling steps' }))
    await waitFor(() => {
      expect(screen.getByTestId('sampling-harness-steps')).toHaveTextContent('42')
    })
  })

  it('renders NAI output settings and updates state through onChange', async () => {
    function OutputHarness() {
      const [params, setParams] = React.useState({ n_samples: 1 })
      return (
        <div>
          <NAIOutputSettings params={params as never} onChange={setParams as never} />
          <p data-testid="output-harness-samples">{params.n_samples}</p>
        </div>
      )
    }

    render(<OutputHarness />)

    expect(screen.getByRole('heading', { name: 'NAI Output Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update output samples' }))
    await waitFor(() => {
      expect(screen.getByTestId('output-harness-samples')).toHaveTextContent('3')
    })
  })
})
