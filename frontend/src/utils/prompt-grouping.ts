import { parsePromptWithLoRAs, cleanPromptTerm, refinePrimaryPrompt, removeLoRAWeight } from '@conai/shared'
import { API_BASE_URL } from '@/lib/api/client'

export interface PromptGroup {
  id: number
  group_name: string
  display_order: number
  is_visible: boolean
}

export interface GroupedPromptTerms {
  id: number
  group_name: string
  terms: string[]
}

export interface GroupedPromptResult {
  groups: GroupedPromptTerms[]
  unclassified_terms: string[]
}

interface PromptGroupApiResponse {
  id: number
  group_name: string
  display_order: number
  is_visible: boolean
}

interface PromptItemResponse {
  prompt: string
}

export const fetchPromptGroups = async (type: 'positive' | 'negative'): Promise<PromptGroup[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/prompt-groups?type=${type}&include_hidden=false`)
    const result: { success: boolean; data?: PromptGroupApiResponse[]; error?: string } = await response.json()

    if (result.success && result.data) {
      return result.data.filter((group) => group.id !== 0)
    }

    console.error('Failed to fetch prompt groups:', result.error)
    return []
  } catch (error) {
    console.error('Error fetching prompt groups:', error)
    return []
  }
}

export const fetchGroupPrompts = async (groupId: number, type: 'positive' | 'negative'): Promise<string[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/prompt-groups/${groupId}/prompts?type=${type}&limit=1000`)
    const result: { success: boolean; data?: { prompts?: PromptItemResponse[] } } = await response.json()

    if (result.success && result.data?.prompts) {
      return result.data.prompts.map((item) => item.prompt)
    }

    return []
  } catch (error) {
    console.error('Error fetching group prompts:', error)
    return []
  }
}

const promptGroupsCache = new Map<string, { data: PromptGroup[]; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000

const fetchPromptGroupsCached = async (type: 'positive' | 'negative'): Promise<PromptGroup[]> => {
  const cacheKey = `groups_${type}`
  const cached = promptGroupsCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  const groups = await fetchPromptGroups(type)
  promptGroupsCache.set(cacheKey, {
    data: groups,
    timestamp: Date.now(),
  })

  return groups
}

export const groupPromptTerms = async (promptText: string, type: 'positive' | 'negative'): Promise<GroupedPromptResult> => {
  if (!promptText) {
    return { groups: [], unclassified_terms: [] }
  }

  const refinedPrompt = refinePrimaryPrompt(promptText)
  const { loras, terms } = parsePromptWithLoRAs(refinedPrompt)
  const groups = await fetchPromptGroupsCached(type)

  const groupPromptMap = new Map<number, string[]>()

  const groupPromptPromises = groups.map(async (group) => {
    const groupPrompts = await fetchGroupPrompts(group.id, type)
    return {
      groupId: group.id,
      prompts: groupPrompts.map((prompt) => prompt.toLowerCase()),
    }
  })

  const groupPromptResults = await Promise.all(groupPromptPromises)
  for (const result of groupPromptResults) {
    groupPromptMap.set(result.groupId, result.prompts)
  }

  const groupedTerms = new Map<number, string[]>()
  const unclassifiedTerms: string[] = []

  for (const term of terms) {
    const normalizedTerm = cleanPromptTerm(term).toLowerCase()
    let matched = false

    for (const [groupId, groupPrompts] of groupPromptMap) {
      if (groupPrompts.includes(normalizedTerm)) {
        if (!groupedTerms.has(groupId)) {
          groupedTerms.set(groupId, [])
        }

        groupedTerms.get(groupId)?.push(term)
        matched = true
        break
      }
    }

    if (!matched) {
      unclassifiedTerms.push(term)
    }
  }

  for (const lora of loras) {
    const normalizedLoRA = removeLoRAWeight(lora).toLowerCase()
    let matched = false

    for (const [groupId, groupPrompts] of groupPromptMap) {
      if (groupPrompts.includes(normalizedLoRA)) {
        if (!groupedTerms.has(groupId)) {
          groupedTerms.set(groupId, [])
        }

        groupedTerms.get(groupId)?.push(lora)
        matched = true
        break
      }
    }

    if (!matched) {
      unclassifiedTerms.push(lora)
    }
  }

  const result: GroupedPromptTerms[] = []

  for (const group of groups) {
    const groupTerms = groupedTerms.get(group.id) || []
    if (groupTerms.length > 0) {
      result.push({
        id: group.id,
        group_name: group.group_name,
        terms: groupTerms,
      })
    }
  }

  result.sort((a, b) => {
    const groupA = groups.find((group) => group.id === a.id)
    const groupB = groups.find((group) => group.id === b.id)
    return (groupA?.display_order || 0) - (groupB?.display_order || 0)
  })

  return {
    groups: result,
    unclassified_terms: unclassifiedTerms,
  }
}
