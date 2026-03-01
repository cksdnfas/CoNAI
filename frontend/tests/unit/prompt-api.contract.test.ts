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
import { promptCollectionApi, promptGroupApi, type PromptGroupData } from '@/services/prompt-api'

describe('promptApi contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps promptCollectionApi routes with expected method, path, and payload', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true, data: {} } })

    await promptCollectionApi.searchPrompts('portrait', 'negative', 2, 30, 'created_at', 'ASC', null)
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-collection/search', {
      params: {
        q: 'portrait',
        type: 'negative',
        page: 2,
        limit: 30,
        sortBy: 'created_at',
        sortOrder: 'ASC',
        group_id: null,
      },
    })

    await promptCollectionApi.deletePrompt(7, 'negative')
    expect(apiClient.delete).toHaveBeenCalledWith('/api/prompt-collection/7', {
      params: { type: 'negative' },
    })

    await promptCollectionApi.assignPromptToGroup(7, 3, 'positive')
    expect(apiClient.put).toHaveBeenCalledWith('/api/prompt-collection/assign-group', {
      prompt_id: 7,
      group_id: 3,
      type: 'positive',
    })

    await promptCollectionApi.batchAssignPromptsToGroup(['a', 'b'], 4, 'negative')
    expect(apiClient.post).toHaveBeenCalledWith('/api/prompt-collection/batch-assign', {
      prompts: ['a', 'b'],
      group_id: 4,
      type: 'negative',
    })

    await promptCollectionApi.getStatistics()
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-collection/statistics')

    await promptCollectionApi.getTopPrompts(5, 'both')
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-collection/top', {
      params: {
        limit: 5,
        type: 'both',
      },
    })

    await promptCollectionApi.setSynonyms('masterpiece', ['high quality', 'best quality'], 'positive')
    expect(apiClient.post).toHaveBeenCalledWith('/api/prompt-collection/synonyms', {
      mainPrompt: 'masterpiece',
      synonyms: ['high quality', 'best quality'],
      type: 'positive',
    })

    await promptCollectionApi.removeSynonym(11, 'high quality', 'negative')
    expect(apiClient.delete).toHaveBeenCalledWith('/api/prompt-collection/synonyms/11', {
      data: {
        synonym: 'high quality',
        type: 'negative',
      },
    })
  })

  it('maps promptGroupApi routes with expected method, path, and payload', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true, data: {} } })
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true, data: {} } })

    await promptGroupApi.getGroups(true, 'negative')
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-groups', {
      params: {
        include_hidden: true,
        type: 'negative',
      },
    })

    await promptGroupApi.getGroup(2, 'positive')
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-groups/2', {
      params: { type: 'positive' },
    })

    await promptGroupApi.getGroupPrompts(2, 'negative', 3, 15)
    expect(apiClient.get).toHaveBeenCalledWith('/api/prompt-groups/2/prompts', {
      params: {
        type: 'negative',
        page: 3,
        limit: 15,
      },
    })

    const createPayload: PromptGroupData = {
      group_name: 'Favorites',
      display_order: 9,
      is_visible: true,
      parent_id: null,
    }
    await promptGroupApi.createGroup(createPayload, 'negative')
    expect(apiClient.post).toHaveBeenCalledWith('/api/prompt-groups', {
      group_name: 'Favorites',
      display_order: 9,
      is_visible: true,
      parent_id: null,
      type: 'negative',
    })

    await promptGroupApi.updateGroup(2, { group_name: 'Updated' }, 'positive')
    expect(apiClient.put).toHaveBeenCalledWith('/api/prompt-groups/2', {
      group_name: 'Updated',
      type: 'positive',
    })

    await promptGroupApi.deleteGroup(2, 'negative')
    expect(apiClient.delete).toHaveBeenCalledWith('/api/prompt-groups/2', {
      params: { type: 'negative' },
    })

    await promptGroupApi.movePromptToGroup(15, null, 'positive')
    expect(apiClient.put).toHaveBeenCalledWith('/api/prompt-groups/move-prompt', {
      prompt_id: 15,
      target_group_id: null,
      type: 'positive',
    })

    await promptGroupApi.updateGroupOrders(
      [
        { id: 1, display_order: 0 },
        { id: 2, display_order: 1 },
      ],
      'negative',
    )
    expect(apiClient.put).toHaveBeenCalledWith('/api/prompt-groups/reorder', {
      group_orders: [
        { id: 1, display_order: 0 },
        { id: 2, display_order: 1 },
      ],
      type: 'negative',
    })
  })

  it('returns prompt collection mutation response on success', async () => {
    const response = {
      success: true,
      data: {
        assigned: true,
        message: 'Prompt assigned to group successfully',
      },
    }

    vi.mocked(apiClient.put).mockResolvedValue({ data: response })

    await expect(promptCollectionApi.assignPromptToGroup(9, 5, 'positive')).resolves.toEqual(response)
  })

  it('propagates prompt collection mutation failure', async () => {
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Failed to assign prompt to group'))

    await expect(promptCollectionApi.assignPromptToGroup(9, 5, 'positive')).rejects.toThrow('Failed to assign prompt to group')
  })

  it('returns prompt group mutation response on success', async () => {
    const response = {
      success: true,
      data: {
        updated: true,
        message: 'Group updated successfully',
      },
    }

    vi.mocked(apiClient.put).mockResolvedValue({ data: response })

    await expect(promptGroupApi.updateGroup(4, { group_name: 'Portraits' }, 'positive')).resolves.toEqual(response)
  })

  it('propagates prompt group mutation failure', async () => {
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Failed to update group'))

    await expect(promptGroupApi.updateGroup(4, { group_name: 'Portraits' }, 'positive')).rejects.toThrow('Failed to update group')
  })
})
