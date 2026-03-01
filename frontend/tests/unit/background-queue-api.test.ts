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
import { backgroundQueueApi } from '@/services/background-queue-api'

describe('backgroundQueueApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns queue status on success', async () => {
    const queueStatus = {
      pending: 2,
      processing: 1,
      completed: 10,
      failed: 0,
    }

    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: queueStatus,
      },
    })

    await expect(backgroundQueueApi.getQueueStatus()).resolves.toEqual(queueStatus)
    expect(apiClient.get).toHaveBeenCalledWith('/api/background-queue/status')
  })

  it('throws normalized error message on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Queue status exploded'))

    await expect(backgroundQueueApi.getQueueStatus()).rejects.toThrow('Queue status exploded')
  })
})
