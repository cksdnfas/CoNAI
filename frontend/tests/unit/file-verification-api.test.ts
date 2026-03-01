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
import { fileVerificationApi } from '@/services/file-verification-api'

describe('fileVerificationApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns verification stats on success', async () => {
    const stats = {
      totalFiles: 100,
      missingFiles: 3,
      lastVerificationDate: '2026-03-01T00:00:00.000Z',
      lastVerificationResult: null,
    }

    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: stats,
      },
    })

    await expect(fileVerificationApi.getStats()).resolves.toEqual(stats)
    expect(apiClient.get).toHaveBeenCalledWith('/api/file-verification/stats')
  })

  it('throws normalized error message on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue({
      response: {
        data: {
          error: 'Verification stats failed',
        },
      },
    })

    await expect(fileVerificationApi.getStats()).rejects.toThrow('Verification stats failed')
  })
})
