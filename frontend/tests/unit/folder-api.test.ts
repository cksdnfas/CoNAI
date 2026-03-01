import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api/client'
import { folderApi } from '@/services/folder-api'

describe('folderApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns folders on success', async () => {
    const folders = [{ id: 1, folder_path: '/images', active: true }]

    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: folders,
      },
    })

    await expect(folderApi.getFolders()).resolves.toEqual(folders)
    expect(apiClient.get).toHaveBeenCalledWith('/api/folders', { params: undefined })
  })

  it('throws normalized error message on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue({
      response: {
        data: {
          message: 'Folder endpoint failed',
        },
      },
    })

    await expect(folderApi.getFolders()).rejects.toThrow('Folder endpoint failed')
  })
})
