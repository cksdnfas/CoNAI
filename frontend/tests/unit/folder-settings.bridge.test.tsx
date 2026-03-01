import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FolderSettings from '@/features/settings/bridges/folder-settings'

const {
  getFoldersMock,
  addFolderMock,
  updateFolderMock,
  scanFolderMock,
  scanAllFoldersMock,
  getScanLogsMock,
  getRecentScanLogsMock,
  startWatcherMock,
  stopWatcherMock,
  deleteFolderMock,
  getQueueStatusMock,
  getHashStatsMock,
  getVerifyStatsMock,
  getVerifyProgressMock,
  getVerifySettingsMock,
} = vi.hoisted(() => ({
  getFoldersMock: vi.fn(),
  addFolderMock: vi.fn(),
  updateFolderMock: vi.fn(),
  scanFolderMock: vi.fn(),
  scanAllFoldersMock: vi.fn(),
  getScanLogsMock: vi.fn(),
  getRecentScanLogsMock: vi.fn(),
  startWatcherMock: vi.fn(),
  stopWatcherMock: vi.fn(),
  deleteFolderMock: vi.fn(),
  getQueueStatusMock: vi.fn(),
  getHashStatsMock: vi.fn(),
  getVerifyStatsMock: vi.fn(),
  getVerifyProgressMock: vi.fn(),
  getVerifySettingsMock: vi.fn(),
}))

vi.mock('@/services/folder-api', () => ({
  folderApi: {
    getFolders: getFoldersMock,
    addFolder: addFolderMock,
    updateFolder: updateFolderMock,
    scanFolder: scanFolderMock,
    scanAllFolders: scanAllFoldersMock,
    getScanLogs: getScanLogsMock,
    getRecentScanLogs: getRecentScanLogsMock,
    startWatcher: startWatcherMock,
    stopWatcher: stopWatcherMock,
    deleteFolder: deleteFolderMock,
  },
}))

vi.mock('@/services/background-queue-api', () => ({
  backgroundQueueApi: {
    getQueueStatus: getQueueStatusMock,
    getHashStats: getHashStatsMock,
    rebuildHashes: vi.fn(),
  },
}))

vi.mock('@/services/file-verification-api', () => ({
  fileVerificationApi: {
    getStats: getVerifyStatsMock,
    getProgress: getVerifyProgressMock,
    getSettings: getVerifySettingsMock,
    triggerVerification: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('FolderSettings bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getQueueStatusMock.mockResolvedValue({
      queue: {
        queueLength: 0,
        processing: false,
        tasksByType: {
          metadata_extraction: 0,
          prompt_collection: 0,
          civitai_model_lookup: 0,
        },
      },
      autoTag: {
        isRunning: false,
        pollingIntervalSeconds: 1,
        batchSize: 5,
        untaggedCount: 0,
      },
    })
    getHashStatsMock.mockResolvedValue({
      totalImages: 0,
      imagesWithoutHash: 0,
      imagesWithHash: 0,
      completionPercentage: 0,
    })
    getVerifyStatsMock.mockResolvedValue({
      totalFiles: 0,
      missingFiles: 0,
      lastVerificationDate: null,
      lastVerificationResult: null,
    })
    getVerifyProgressMock.mockResolvedValue({
      isRunning: false,
      totalFiles: 0,
      checkedFiles: 0,
      missingFiles: 0,
      startTime: 0,
      progressPercentage: 0,
    })
    getVerifySettingsMock.mockResolvedValue({
      enabled: false,
      interval: 3600,
    })
    getScanLogsMock.mockResolvedValue([])
    getRecentScanLogsMock.mockResolvedValue([])
  })

  it('renders core controls and executes scan folder action on success', async () => {
    getFoldersMock.mockResolvedValue([
      {
        id: 1,
        folder_path: 'D:/images',
        active: true,
      },
    ])
    scanFolderMock.mockResolvedValue({
      totalScanned: 10,
      newImages: 1,
      existingImages: 0,
      updatedPaths: 0,
      missingImages: 0,
      errors: [],
      duration: 5,
      thumbnailsGenerated: 0,
      backgroundTasks: 0,
    })

    render(<FolderSettings />)

    expect(await screen.findByRole('button', { name: 'folderSettings.watchedFolders.refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'folderSettings.watchedFolders.addFolder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'folderSettings.watchedFolders.scanAll' })).toBeInTheDocument()
    expect((await screen.findAllByText('D:/images')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'folderSettings.watchedFolders.tooltips.scan' }))

    await waitFor(() => {
      expect(scanFolderMock).toHaveBeenCalledWith(1)
    })
    await waitFor(() => {
      expect(getFoldersMock).toHaveBeenCalledTimes(2)
    })
  })

  it('shows error feedback when folder delete fails and remains mounted', async () => {
    getFoldersMock.mockResolvedValue([
      {
        id: 7,
        folder_path: 'E:/library',
        active: true,
      },
    ])
    deleteFolderMock.mockRejectedValue(new Error('Delete request failed'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<FolderSettings />)

    expect((await screen.findAllByText('E:/library')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'folderSettings.watchedFolders.tooltips.delete' }))

    expect(await screen.findByText('Delete request failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'folderSettings.watchedFolders.refresh' })).toBeInTheDocument()
    expect((await screen.findAllByText('E:/library')).length).toBeGreaterThan(0)
  })
})
