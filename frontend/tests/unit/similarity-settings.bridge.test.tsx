import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SimilaritySettings from '@/features/settings/bridges/similarity-settings'

const { translateMock } = vi.hoisted(() => {
  const dictionary: Record<string, string> = {
    'similarity.title': 'Image Similarity Search Settings',
    'similarity.systemStatus.title': 'System status',
    'similarity.systemStatus.description': 'Current status of the similarity hash system.',
    'similarity.systemStatus.autoGenerateHash': 'Auto-generate hashes on upload',
    'similarity.systemStatus.refreshButton': 'Refresh stats',
    'similarity.systemStatus.rebuildingButton': 'Rebuilding...',
    'similarity.systemStatus.rebuildButton': 'Rebuild missing hashes ({{count}})',
    'similarity.systemStatus.totalImages': 'Total images: {{count}}',
    'similarity.systemStatus.withHash': 'With hash: {{count}}',
    'similarity.systemStatus.withoutHash': 'Without hash: {{count}}',
    'similarity.systemStatus.completion': 'Completion: {{percent}}%',
    'similarity.systemStatus.rebuildProgress': 'Rebuilding hashes... {{processed}}/{{total}} ({{percent}}%)',
    'similarity.systemStatus.rebuildComplete': 'Rebuild completed: {{processed}} image hashes generated.',
    'similarity.systemStatus.rebuildCompleteWithErrors': 'Rebuild completed: {{success}} succeeded, {{failed}} failed.',
    'similarity.systemStatus.rebuildFailed': 'Failed to rebuild similarity hashes.',
    'similarity.systemStatus.refreshFailed': 'Failed to refresh similarity statistics.',
    'similarity.systemStatus.noImagesToProcess': 'No images require hash generation.',
    'similarity.systemStatus.autoGenerateUpdateFailed': 'Failed to update auto-generate hash setting.',
    'similarity.test.title': 'Test',
    'similarity.test.description': 'Test current settings with a specific image.',
    'similarity.test.placeholderHash': 'e.g., abc123def456...',
    'similarity.test.searchType': 'Search Type',
    'similarity.test.searchButton': 'Run Search',
    'similarity.test.searching': 'Searching...',
    'similarity.test.searchFailed': 'Search failed',
    'similarity.test.validation.requiredHash': 'Please enter an image hash.',
    'similarity.test.validation.invalidHashFormat': 'Invalid hash format. Expected 48 hexadecimal characters.',
    'similarity.test.types.duplicates': 'Duplicates',
    'similarity.test.types.similar': 'Similar',
    'similarity.test.types.color': 'Color',
    'similarity.test.queryImage': 'Query Image',
    'similarity.test.resultImage': 'Result Image',
    'similarity.test.noPreview': 'No preview',
    'similarity.test.imageDetails.hash': 'Hash:',
    'similarity.test.imageDetails.filename': 'File:',
    'similarity.test.imageDetails.size': 'Size:',
    'similarity.test.results': 'Search Results: {{count}}',
    'similarity.test.modeLabel': 'Mode: {{mode}}',
    'similarity.test.matchLabel': 'Match: {{type}}',
    'similarity.test.matchTypes.nearDuplicate': 'Near Duplicate',
    'similarity.test.similarity': 'Similarity: {{percent}}%',
    'similarity.test.colorSimilarity': 'Color Similarity: {{percent}}%',
    'similarity.test.noResults': 'No similar images found.',
    'similarity.duplicateScan.title': 'Full Duplicate Analysis',
    'similarity.duplicateScan.scanButton': 'Run Full Scan',
    'similarity.duplicateScan.scanning': 'Scanning...',
    'similarity.duplicateScan.foundGroups': 'Found Duplicate Groups: {{count}}',
    'similarity.duplicateScan.groupLabel': 'Group {{id}} • {{count}} images',
    'similarity.duplicateScan.similarityLabel': '{{percent}}% similar',
    'similarity.duplicateScan.selectAll': 'Select All',
    'similarity.duplicateScan.deselectAll': 'Deselect All',
    'similarity.duplicateScan.keepOneDelete': 'Keep first image and select rest for deletion',
    'similarity.duplicateScan.deleteSelected': 'Delete {{count}} Selected',
    'similarity.duplicateScan.deleting': 'Deleting...',
    'similarity.duplicateScan.selectForDelete': 'Select for delete (ID: {{id}})',
    'similarity.duplicateScan.deleteConfirmMessage': 'Are you sure you want to delete {{count}} selected images?',
    'similarity.duplicateScan.deleteWarning': 'Deleted images cannot be recovered!',
    'similarity.duplicateScan.deleteSuccess': '{{count}} images deleted successfully.',
    'similarity.duplicateScan.deletePartialSuccess': '{{success}} succeeded, {{failed}} failed',
    'similarity.duplicateScan.deleteFailed': 'Failed to delete images.',
    'similarity.thresholds.title': 'Threshold Settings',
    'similarity.thresholds.duplicate.label': 'Duplicate threshold: {{value}}',
    'similarity.thresholds.similar.label': 'Similar threshold: {{value}}',
    'similarity.thresholds.color.label': 'Color similarity threshold: {{value}}%',
    'similarity.thresholds.searchLimit.label': 'Search result limit',
    'common.loading': 'Loading...',
  }

  const translate = (key: string, options?: Record<string, unknown>) => {
    const template = dictionary[key] ?? key
    if (!options) {
      return template
    }

    return Object.entries(options).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), template)
  }

  return { translateMock: vi.fn(translate) }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateMock,
  }),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange?: (value: string) => void; children: React.ReactNode }) => (
    <select aria-label="Similarity mode" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}))

const {
  updateAutoGenerateHashOnUploadMock,
  getSimilarityThresholdsMock,
  getSimilarityQueryImageMock,
  testSimilaritySearchMock,
  getSimilarityStatsMock,
  getSimilaritySettingsMock,
  rebuildSimilarityHashesMock,
  findDuplicateGroupsMock,
} = vi.hoisted(() => ({
  updateAutoGenerateHashOnUploadMock: vi.fn(),
  getSimilarityThresholdsMock: vi.fn(),
  getSimilarityQueryImageMock: vi.fn(),
  testSimilaritySearchMock: vi.fn(),
  getSimilarityStatsMock: vi.fn(),
  getSimilaritySettingsMock: vi.fn(),
  rebuildSimilarityHashesMock: vi.fn(),
  findDuplicateGroupsMock: vi.fn(),
}))

const { deleteImageFilesMock } = vi.hoisted(() => ({
  deleteImageFilesMock: vi.fn(),
}))

vi.mock('@/features/settings/modules/similarity/similarity-api', () => ({
  findDuplicateGroups: findDuplicateGroupsMock,
  getSimilarityQueryImage: getSimilarityQueryImageMock,
  getSimilaritySettings: getSimilaritySettingsMock,
  getSimilarityStats: getSimilarityStatsMock,
  getSimilarityThresholds: getSimilarityThresholdsMock,
  rebuildSimilarityHashes: rebuildSimilarityHashesMock,
  testSimilaritySearch: testSimilaritySearchMock,
  updateAutoGenerateHashOnUpload: updateAutoGenerateHashOnUploadMock,
}))

vi.mock('@/services/image-api', () => ({
  imageApi: {
    deleteImageFiles: deleteImageFilesMock,
  },
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('SimilaritySettings bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSimilarityThresholdsMock.mockResolvedValue({
      duplicateThreshold: 5,
      similarThreshold: 15,
      colorThreshold: 85,
      searchLimit: 20,
    })
    getSimilarityStatsMock.mockResolvedValue({
      totalImages: 100,
      imagesWithHash: 90,
      imagesWithoutHash: 10,
      completionPercentage: 90,
    })
    getSimilaritySettingsMock.mockResolvedValue({ autoGenerateHashOnUpload: true })
    getSimilarityQueryImageMock.mockResolvedValue(null)
    rebuildSimilarityHashesMock.mockResolvedValue({ processed: 10, total: 10, failed: 0, remaining: 0 })
    findDuplicateGroupsMock.mockResolvedValue([])
    testSimilaritySearchMock.mockResolvedValue([])
    deleteImageFilesMock.mockResolvedValue({ success: true, details: { deletedFiles: [] } })
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks request and shows validation when hash is empty or invalid', async () => {
    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    expect(screen.queryByText('similarity.test.searchButton')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))

    expect(await screen.findByText('Please enter an image hash.')).toBeInTheDocument()
    expect(getSimilarityQueryImageMock).not.toHaveBeenCalled()
    expect(testSimilaritySearchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('e.g., abc123def456...'), { target: { value: 'not-a-valid-hash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))

    expect(await screen.findByText('Invalid hash format. Expected 48 hexadecimal characters.')).toBeInTheDocument()
    expect(getSimilarityQueryImageMock).not.toHaveBeenCalled()
    expect(testSimilaritySearchMock).not.toHaveBeenCalled()
  })

  it('maps selected mode payload using current threshold/search-limit controls', async () => {
    const validHash = 'a'.repeat(48)

    render(<SimilaritySettings />)

    await screen.findByRole('switch')

    fireEvent.change(screen.getByLabelText('Duplicate threshold: 5'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Similar threshold: 15'), { target: { value: '23' } })
    fireEvent.change(screen.getByLabelText('Color similarity threshold: 85%'), { target: { value: '91' } })
    fireEvent.change(screen.getByLabelText('Search result limit'), { target: { value: '33' } })

    fireEvent.change(screen.getByPlaceholderText('e.g., abc123def456...'), { target: { value: validHash } })

    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))
    await waitFor(() => {
      expect(testSimilaritySearchMock).toHaveBeenCalledWith(validHash, 'similar', {
        duplicateThreshold: 4,
        similarThreshold: 23,
        colorThreshold: 91,
        limit: 33,
      })
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Similarity mode' }), { target: { value: 'duplicates' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))
    await waitFor(() => {
      expect(testSimilaritySearchMock).toHaveBeenLastCalledWith(validHash, 'duplicates', {
        duplicateThreshold: 4,
        similarThreshold: 23,
        colorThreshold: 91,
        limit: 33,
      })
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Similarity mode' }), { target: { value: 'color' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))
    await waitFor(() => {
      expect(testSimilaritySearchMock).toHaveBeenLastCalledWith(validHash, 'color', {
        duplicateThreshold: 4,
        similarThreshold: 23,
        colorThreshold: 91,
        limit: 33,
      })
    })
  })

  it('uses duplicate threshold integer semantics for duplicate scan requests', async () => {
    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.change(screen.getByLabelText('Duplicate threshold: 5'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Full Scan' }))

    await waitFor(() => {
      expect(findDuplicateGroupsMock).toHaveBeenCalledWith(4, 2)
      expect(findDuplicateGroupsMock).not.toHaveBeenCalledWith(400, 2)
    })
  })

  it('renders query and result previews with readable mode/match labels', async () => {
    const validHash = 'b'.repeat(48)
    getSimilarityQueryImageMock.mockResolvedValue({
      composite_hash: validHash,
      original_file_path: 'query-image.png',
      width: 1024,
      height: 768,
      thumbnail_url: '/thumb/query.png',
    })
    testSimilaritySearchMock.mockResolvedValue([
      {
        image: {
          composite_hash: 'c'.repeat(48),
          file_id: 12,
          original_file_path: 'matched-image.png',
          thumbnail_url: '/thumb/match.png',
        },
        similarity: 92.44,
        matchType: 'near-duplicate',
        colorSimilarity: 88.2,
      },
    ])

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.change(screen.getByPlaceholderText('e.g., abc123def456...'), { target: { value: validHash } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Search' }))

    expect(await screen.findByText('Query Image')).toBeInTheDocument()
    expect(screen.getByText(validHash)).toBeInTheDocument()
    expect(screen.getByText('query-image.png')).toBeInTheDocument()
    expect(screen.getByText('1024 x 768')).toBeInTheDocument()
    expect(screen.getByText('Mode: Similar')).toBeInTheDocument()
    expect(screen.getByText('Match: Near Duplicate')).toBeInTheDocument()
    expect(screen.getByText('Similarity: 92.4%')).toBeInTheDocument()
    expect(screen.getByText('Color Similarity: 88.2%')).toBeInTheDocument()
  })

  it('renders similarity controls and updates auto-generate setting on success', async () => {
    const deferred = createDeferred<boolean>()
    updateAutoGenerateHashOnUploadMock.mockReturnValue(deferred.promise)

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeEnabled()
    })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('switch'))

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeDisabled()

    await waitFor(() => {
      expect(updateAutoGenerateHashOnUploadMock).toHaveBeenCalledWith(false)
    })
    deferred.resolve(false)

    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
      expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeEnabled()
    })
  })

  it('shows explicit feedback and rolls back toggle when update fails', async () => {
    const deferred = createDeferred<boolean>()
    updateAutoGenerateHashOnUploadMock.mockReturnValue(deferred.promise)

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeEnabled()
    })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('switch'))

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeDisabled()

    deferred.reject(new Error('update failed'))

    expect(await screen.findByText('Failed to update auto-generate hash setting.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeEnabled()
    })
  })

  it('refreshes stats from refresh button and shows translated status labels', async () => {
    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    const refreshButton = screen.getByRole('button', { name: 'Refresh stats' })
    await waitFor(() => {
      expect(refreshButton).toBeEnabled()
    })

    expect(screen.queryByText('similarity.systemStatus.refreshButton')).not.toBeInTheDocument()

    getSimilarityStatsMock.mockResolvedValue({
      totalImages: 100,
      imagesWithHash: 95,
      imagesWithoutHash: 5,
      completionPercentage: 95,
    })

    const callsBeforeRefresh = getSimilarityStatsMock.mock.calls.length

    fireEvent.click(refreshButton)

    await waitFor(() => {
      expect(getSimilarityStatsMock.mock.calls.length).toBeGreaterThan(callsBeforeRefresh)
      expect(screen.getByText('Without hash: 5')).toBeInTheDocument()
    })
  })

  it('shows rebuild progress/completion feedback and disables controls during rebuild', async () => {
    let statsSnapshot = {
      totalImages: 100,
      imagesWithHash: 80,
      imagesWithoutHash: 20,
      completionPercentage: 80,
    }

    getSimilarityStatsMock.mockImplementation(async () => statsSnapshot)

    let releaseFirstBatch: (() => void) | null = null
    let releaseSecondBatch: (() => void) | null = null
    const firstBatch = new Promise<{ processed: number; total: number; failed: number; remaining: number }>((resolve) => {
      releaseFirstBatch = () => resolve({ processed: 10, total: 10, failed: 0, remaining: 10 })
    })
    const secondBatch = new Promise<{ processed: number; total: number; failed: number; remaining: number }>((resolve) => {
      releaseSecondBatch = () => resolve({ processed: 10, total: 10, failed: 0, remaining: 0 })
    })

    rebuildSimilarityHashesMock
      .mockImplementationOnce(() => firstBatch)
      .mockImplementationOnce(() => secondBatch)

    render(<SimilaritySettings />)

    const rebuildButton = await screen.findByRole('button', { name: 'Rebuild missing hashes (20)' })
    await waitFor(() => {
      expect(rebuildButton).toBeEnabled()
    })
    fireEvent.click(rebuildButton)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh stats' })).toBeDisabled()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rebuilding...' })).toBeDisabled()
    })

    releaseFirstBatch?.()

    expect(await screen.findByText('Rebuilding hashes... 10/20 (50%)')).toBeInTheDocument()

    statsSnapshot = {
      totalImages: 100,
      imagesWithHash: 100,
      imagesWithoutHash: 0,
      completionPercentage: 100,
    }

    releaseSecondBatch?.()

    expect(await screen.findByText('Rebuild completed: 20 image hashes generated.')).toBeInTheDocument()
  })

  it('renders duplicate groups and supports keep-one group selection', async () => {
    findDuplicateGroupsMock.mockResolvedValue([
      {
        groupId: 'dup-1',
        similarity: 99.9,
        matchType: 'exact',
        images: [
          { file_id: 101, composite_hash: 'd'.repeat(48), original_file_path: 'keep.png', width: 512, height: 512 },
          { file_id: 102, composite_hash: 'e'.repeat(48), original_file_path: 'delete-a.png', width: 512, height: 512 },
          { file_id: 103, composite_hash: 'f'.repeat(48), original_file_path: 'delete-b.png', width: 512, height: 512 },
        ],
      },
    ])

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: 'Run Full Scan' }))

    expect(await screen.findByText('Group dup-1 • 3 images')).toBeInTheDocument()
    expect(screen.getByText('Found Duplicate Groups: 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    expect(await screen.findByRole('button', { name: 'Delete 3 Selected' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep first image and select rest for deletion' }))

    expect(await screen.findByRole('button', { name: 'Delete 2 Selected' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select for delete (ID: 101)' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select for delete (ID: 102)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select for delete (ID: 103)' })).toBeChecked()
  })

  it('shows success feedback when duplicate deletion fully succeeds and rescans', async () => {
    findDuplicateGroupsMock
      .mockResolvedValueOnce([
        {
          groupId: 'dup-3',
          similarity: 99.1,
          matchType: 'exact',
          images: [
            { file_id: 301, composite_hash: '3'.repeat(48), original_file_path: 'first.png' },
            { file_id: 302, composite_hash: '4'.repeat(48), original_file_path: 'second.png' },
          ],
        },
      ])
      .mockResolvedValueOnce([])

    deleteImageFilesMock.mockResolvedValue({
      success: true,
      details: {
        deletedFiles: [{ fileId: 301 }, { fileId: 302 }],
        failedFiles: [],
      },
    })

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: 'Run Full Scan' }))
    await screen.findByText('Group dup-3 • 2 images')

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 Selected' }))

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete 2 selected images? Deleted images cannot be recovered!',
      )
      expect(deleteImageFilesMock).toHaveBeenCalledWith([301, 302])
    })

    expect(await screen.findByText('2 images deleted successfully.')).toBeInTheDocument()
    expect(await screen.findByText('Found Duplicate Groups: 0')).toBeInTheDocument()
  })

  it('confirms duplicate deletion, handles partial failures, and rescans automatically', async () => {
    findDuplicateGroupsMock
      .mockResolvedValueOnce([
        {
          groupId: 'dup-2',
          similarity: 97.5,
          matchType: 'near',
          images: [
            { file_id: 201, composite_hash: '1'.repeat(48), original_file_path: 'first.png' },
            { file_id: 202, composite_hash: '2'.repeat(48), original_file_path: 'second.png' },
          ],
        },
      ])
      .mockResolvedValueOnce([])

    deleteImageFilesMock.mockResolvedValue({
      success: true,
      details: {
        deletedFiles: [{ fileId: 202 }],
        failedFiles: [{ fileId: 201, reason: 'in use' }],
      },
    })

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: 'Run Full Scan' }))
    await screen.findByText('Group dup-2 • 2 images')

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 Selected' }))

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete 2 selected images? Deleted images cannot be recovered!',
      )
      expect(deleteImageFilesMock).toHaveBeenCalledWith([201, 202])
    })

    expect(await screen.findByText('1 succeeded, 1 failed')).toBeInTheDocument()
    await waitFor(() => {
      expect(findDuplicateGroupsMock).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Found Duplicate Groups: 0')).toBeInTheDocument()
    })
  })

  it('shows duplicate deletion error feedback when delete API fails', async () => {
    findDuplicateGroupsMock.mockResolvedValue([
      {
        groupId: 'dup-4',
        similarity: 96.2,
        matchType: 'near',
        images: [
          { file_id: 401, composite_hash: '5'.repeat(48), original_file_path: 'first.png' },
          { file_id: 402, composite_hash: '6'.repeat(48), original_file_path: 'second.png' },
        ],
      },
    ])

    deleteImageFilesMock.mockResolvedValue({
      success: false,
      error: 'Cannot delete selected duplicate files right now.',
    })

    render(<SimilaritySettings />)

    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: 'Run Full Scan' }))
    await screen.findByText('Group dup-4 • 2 images')

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 Selected' }))

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete 2 selected images? Deleted images cannot be recovered!',
      )
      expect(deleteImageFilesMock).toHaveBeenCalledWith([401, 402])
    })

    expect(await screen.findByText('Cannot delete selected duplicate files right now.')).toBeInTheDocument()
  })
})
