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
import { wildcardApi, type WildcardCreateInput, type WildcardParseRequest } from '@/services/wildcard-api'

describe('wildcardApi contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps all legacy parity endpoints to expected frontend API routes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true, message: 'ok' } })

    await wildcardApi.getAllWildcards(true)
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards', { params: { withItems: true } })

    await wildcardApi.getWildcardsHierarchical()
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards', { params: { hierarchical: true } })

    await wildcardApi.getRootWildcards()
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards', { params: { rootsOnly: true } })

    await wildcardApi.getWildcardChildren(10)
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/10/children')

    await wildcardApi.getWildcardPath(10)
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/10/path')

    await wildcardApi.getWildcard(10)
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/10')

    await wildcardApi.getStatistics()
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/stats/summary')

    await wildcardApi.checkCircularReference(10)
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/10/circular-check')

    await wildcardApi.getLastScanLog()
    expect(apiClient.get).toHaveBeenCalledWith('/api/wildcards/last-scan-log')

    await wildcardApi.deleteWildcard(11, true)
    expect(apiClient.delete).toHaveBeenCalledWith('/api/wildcards/11', { params: { cascade: true } })

    await wildcardApi.scanLoraFolder({
      loraFiles: [{ folderName: 'models/animals', loraName: 'fox.safetensors', promptLines: ['animal'] }],
      loraWeight: 1,
      duplicateHandling: 'number',
      matchingMode: 'filename',
      commonTextFilename: 'common.txt',
      matchingPriority: 'filename',
    })
    expect(apiClient.post).toHaveBeenCalledWith('/api/wildcards/scan-lora-folder', {
      loraFiles: [{ folderName: 'models/animals', loraName: 'fox.safetensors', promptLines: ['animal'] }],
      loraWeight: 1,
      duplicateHandling: 'number',
      matchingMode: 'filename',
      commonTextFilename: 'common.txt',
      matchingPriority: 'filename',
    })
  })

  it('returns parse endpoint data on success', async () => {
    const parseRequest: WildcardParseRequest = {
      text: '++animal++ portrait',
      tool: 'comfyui',
      count: 2,
    }
    const parseResponse = {
      success: true,
      data: {
        original: parseRequest.text,
        results: ['fox portrait', 'cat portrait'],
        usedWildcards: ['animal'],
      },
    }

    vi.mocked(apiClient.post).mockResolvedValue({ data: parseResponse })

    await expect(wildcardApi.parseWildcards(parseRequest)).resolves.toEqual(parseResponse)
    expect(apiClient.post).toHaveBeenCalledWith('/api/wildcards/parse', parseRequest)
  })

  it('propagates parse endpoint errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Failed to parse wildcards'))

    await expect(wildcardApi.parseWildcards({ text: '++animal++', tool: 'nai' })).rejects.toThrow('Failed to parse wildcards')
  })

  it('returns create wildcard response on success', async () => {
    const createRequest: WildcardCreateInput = {
      name: 'animal',
      description: 'Animal wildcard',
      items: {
        comfyui: [{ content: 'fox', weight: 1 }],
        nai: [{ content: 'cat', weight: 1 }],
      },
      include_children: 0,
      only_children: 0,
      type: 'wildcard',
      chain_option: 'replace',
    }
    const createResponse = {
      success: true,
      data: {
        id: 1,
        name: 'animal',
        description: 'Animal wildcard',
        parent_id: null,
        include_children: 0,
        only_children: 0,
        type: 'wildcard' as const,
        chain_option: 'replace' as const,
        created_date: '2026-01-01',
        updated_date: '2026-01-01',
        items: [
          {
            id: 1,
            wildcard_id: 1,
            tool: 'comfyui' as const,
            content: 'fox',
            weight: 1,
            order_index: 0,
            created_date: '2026-01-01',
          },
        ],
      },
    }

    vi.mocked(apiClient.post).mockResolvedValue({ data: createResponse })

    await expect(wildcardApi.createWildcard(createRequest)).resolves.toEqual(createResponse)
    expect(apiClient.post).toHaveBeenCalledWith('/api/wildcards', createRequest)
  })

  it('propagates create wildcard errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Wildcard with this name already exists'))

    await expect(
      wildcardApi.createWildcard({
        name: 'animal',
        items: { comfyui: [{ content: 'fox', weight: 1 }], nai: [] },
      }),
    ).rejects.toThrow('Wildcard with this name already exists')
  })
})
