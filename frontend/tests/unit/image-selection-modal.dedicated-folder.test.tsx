import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageSelectionModal from '@/features/workflows/components/image-selection-modal'

const { getCanvasImagesMock } = vi.hoisted(() => ({
  getCanvasImagesMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/services/workflow-api', () => ({
  workflowApi: {
    getCanvasImages: getCanvasImagesMock,
  },
}))

vi.mock('@/utils/backend', () => ({
  ensureAbsoluteUrl: (path: string) => path,
}))

vi.mock('@/features/workflows/utils/workflow-icons', () => ({
  CloudUpload: () => <span>upload-icon</span>,
  Folder: () => <span>folder-icon</span>,
  History: () => <span>history-icon</span>,
  Search: () => <span>search-icon</span>,
  Tag: () => <span>tag-icon</span>,
}))

vi.mock('@/features/workflows/utils/workflow-ui', async () => {
  const actual = await vi.importActual<typeof import('@/features/workflows/utils/workflow-ui')>('@/features/workflows/utils/workflow-ui')

  const tabIndexByLabel: Record<string, number> = {
    'workflows:imageSelection.tabs.dbSearch': 0,
    'workflows:imageSelection.tabs.hash': 1,
    'workflows:imageSelection.tabs.upload': 2,
    'workflows:imageSelection.tabs.history': 3,
    'workflows:imageSelection.tabs.dedicatedFolder': 4,
  }

  type TabsContextValue = {
    onChange?: (event: React.SyntheticEvent, value: number) => void
  }

  const TabsContext = React.createContext<TabsContextValue | null>(null)

  const Tabs = ({ children, onChange }: { children?: React.ReactNode; onChange?: (event: React.SyntheticEvent, value: number) => void }) => (
    <TabsContext.Provider value={{ onChange }}>
      <div>{children}</div>
    </TabsContext.Provider>
  )

  const Tab = ({ label, disabled = false }: { label?: React.ReactNode; disabled?: boolean }) => {
    const context = React.useContext(TabsContext)
    const labelText = typeof label === 'string' ? label : ''
    const nextValue = tabIndexByLabel[labelText] ?? 0

    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => context?.onChange?.(event, nextValue)}
      >
        {label}
      </button>
    )
  }

  return {
    ...actual,
    Tabs,
    Tab,
    Grid: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  }
})

describe('ImageSelectionModal dedicated-folder tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects image path and closes modal when dedicated-folder thumbnail is clicked', async () => {
    getCanvasImagesMock.mockResolvedValue({
      data: [{ path: '/canvas/image-a.png', filename: 'image-a.png' }],
      canvasPath: '/canvas',
    })

    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <ImageSelectionModal
        open={true}
        onClose={onClose}
        onSelect={onSelect}
        fieldLabel="Workflow image"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflows:imageSelection.tabs.dedicatedFolder' }))

    await waitFor(() => {
      expect(getCanvasImagesMock).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(await screen.findByRole('button', { name: 'image-a.png' }))

    expect(onSelect).toHaveBeenCalledWith('/canvas/image-a.png')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows empty dedicated-folder state with canvas path hint', async () => {
    getCanvasImagesMock.mockResolvedValue({
      data: [],
      canvasPath: '/canvas/empty-folder',
    })

    render(
      <ImageSelectionModal
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        fieldLabel="Workflow image"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflows:imageSelection.tabs.dedicatedFolder' }))

    expect(await screen.findByText('workflows:imageSelection.noImagesInFolder')).toBeInTheDocument()
    expect(
      screen.getByText((content) => content.includes('/canvas/empty-folder') && content.includes('workflows:imageSelection.addImagesPrompt')),
    ).toBeInTheDocument()
  })
})
