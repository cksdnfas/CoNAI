import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeSingleGenerationMock, setGroupModalOpenMock, handleGroupSelectMock, handleRemoveGroupMock, startRepeatMock, stopRepeatMock } =
  vi.hoisted(() => ({
    executeSingleGenerationMock: vi.fn().mockResolvedValue(undefined),
    setGroupModalOpenMock: vi.fn(),
    handleGroupSelectMock: vi.fn(),
    handleRemoveGroupMock: vi.fn(),
    startRepeatMock: vi.fn(),
    stopRepeatMock: vi.fn(),
  }))

const { generationState } = vi.hoisted(() => ({
  generationState: {
    generating: false,
    error: null as string | null,
    userData: {
      subscription: {
        tier: 2,
        active: true,
        tierName: 'Pro',
      },
      anlasBalance: 9999,
    },
    historyRefreshKey: 0,
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/image-generation/bridges/nai-anlas-display', () => ({
  default: () => <div data-testid="nai-anlas-display">ANLAS</div>,
}))

vi.mock('@/features/image-generation/bridges/nai-basic-settings', () => ({
  default: ({ onChange, params }: { onChange: (value: unknown) => void; params: { prompt: string } }) => (
    <div>
      <p>Basic Settings Mock</p>
      <p data-testid="nai-prompt-value">{params.prompt}</p>
      <button
        type="button"
        onClick={() =>
          onChange((previous: { prompt: string; negative_prompt: string }) => ({
            ...previous,
            prompt: 'task-15 prompt',
            negative_prompt: 'task-15 negative',
          }))
        }
      >
        Update basic params
      </button>
    </div>
  ),
}))

vi.mock('@/features/image-generation/bridges/nai-sampling-settings', () => ({
  default: ({ onChange, params }: { onChange: (value: unknown) => void; params: { steps: number } }) => (
    <div>
      <p>Sampling Settings Mock</p>
      <p data-testid="nai-steps-value">{params.steps}</p>
      <button
        type="button"
        onClick={() =>
          onChange((previous: { steps: number }) => ({
            ...previous,
            steps: 40,
          }))
        }
      >
        Update sampling params
      </button>
    </div>
  ),
}))

vi.mock('@/features/image-generation/bridges/nai-output-settings', () => ({
  default: ({ onChange, params }: { onChange: (value: unknown) => void; params: { n_samples: number } }) => (
    <div>
      <p>Output Settings Mock</p>
      <p data-testid="nai-samples-value">{params.n_samples}</p>
      <button
        type="button"
        onClick={() =>
          onChange((previous: { n_samples: number }) => ({
            ...previous,
            n_samples: 2,
          }))
        }
      >
        Update output params
      </button>
    </div>
  ),
}))

vi.mock('@/features/image-generation/bridges/nai-group-selector', () => ({
  default: ({ selectedGroup }: { selectedGroup: { id: number; name: string } | null }) => (
    <div>{selectedGroup ? selectedGroup.name : 'No selected group'}</div>
  ),
}))

vi.mock('@/features/workflows/components/repeat-controls', () => ({
  default: () => <div>Repeat Controls Mock</div>,
}))

vi.mock('@/features/workflows/components/generation-history-list', () => ({
  GenerationHistoryList: ({ serviceType }: { serviceType: string }) => <div>History Mock: {serviceType}</div>,
}))

vi.mock('@/features/image-groups/components/group-assign-modal', () => ({
  default: ({ open }: { open: boolean }) => <div>Group modal: {open ? 'open' : 'closed'}</div>,
}))

vi.mock('@/features/image-generation/nai/hooks/use-nai-group-selection', () => ({
  useNAIGroupSelection: () => ({
    selectedGroupId: 123,
    selectedGroup: { id: 123, name: 'Task 15 Group' },
    groupModalOpen: false,
    setGroupModalOpen: setGroupModalOpenMock,
    handleGroupSelect: handleGroupSelectMock,
    handleRemoveGroup: handleRemoveGroupMock,
  }),
}))

vi.mock('@/features/image-generation/bridges/use-repeat-execution', () => ({
  useRepeatExecution: () => ({
    repeatConfig: { enabled: false },
    repeatState: { isRunning: false },
    setRepeatConfig: vi.fn(),
    startRepeat: startRepeatMock,
    stopRepeat: stopRepeatMock,
    isRepeatMode: false,
  }),
}))

vi.mock('@/features/image-generation/bridges/use-nai-generation', () => ({
  useNAIGeneration: () => ({
    generating: generationState.generating,
    error: generationState.error,
    userData: generationState.userData,
    historyRefreshKey: generationState.historyRefreshKey,
    executeSingleGeneration: executeSingleGenerationMock,
    calculateCost: vi.fn().mockReturnValue(1),
  }),
}))

import NAIImageGeneratorV2 from '@/features/image-generation/nai/components/nai-image-generator-v2'

describe('Task 15 NAI generator bridge behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    generationState.generating = false
    generationState.error = null
    generationState.historyRefreshKey = 0
    executeSingleGenerationMock.mockResolvedValue(undefined)
  })

  it('updates parameters from controls before triggering successful generation', async () => {
    render(<NAIImageGeneratorV2 token="token" onLogout={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update basic params' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update sampling params' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update output params' }))

    await waitFor(() => {
      expect(screen.getByTestId('nai-prompt-value')).toHaveTextContent('task-15 prompt')
      expect(screen.getByTestId('nai-steps-value')).toHaveTextContent('40')
      expect(screen.getByTestId('nai-samples-value')).toHaveTextContent('2')
    })

    fireEvent.click(screen.getAllByRole('button', { name: /이미지생성/ })[0])

    await waitFor(() => {
      expect(executeSingleGenerationMock).toHaveBeenCalledTimes(1)
    })

    const [params, selectedGroupId] = executeSingleGenerationMock.mock.calls[0]
    expect(params.prompt).toBe('task-15 prompt')
    expect(params.negative_prompt).toBe('task-15 negative')
    expect(params.steps).toBe(40)
    expect(params.n_samples).toBe(2)
    expect(selectedGroupId).toBe(123)
  })

  it('shows failure feedback and still allows retry trigger', async () => {
    const { rerender } = render(<NAIImageGeneratorV2 token="token" onLogout={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update basic params' }))
    fireEvent.click(screen.getAllByRole('button', { name: /이미지생성/ })[0])

    await waitFor(() => {
      expect(executeSingleGenerationMock).toHaveBeenCalledTimes(1)
    })

    generationState.error = 'Task 15 generation failed'
    rerender(<NAIImageGeneratorV2 token="token" onLogout={vi.fn()} />)

    expect(screen.getByText('Task 15 generation failed')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /이미지생성/ })[0])

    await waitFor(() => {
      expect(executeSingleGenerationMock).toHaveBeenCalledTimes(2)
    })
  })
})
