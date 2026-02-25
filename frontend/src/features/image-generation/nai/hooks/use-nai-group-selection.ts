import { useCallback, useEffect, useState } from 'react'
import type { GroupWithStats } from '@comfyui-image-manager/shared'
import { apiClient } from '@/lib/api/client'
import { GROUP_STORAGE_KEY } from '../constants/nai.constants'

const GROUP_INFO_STORAGE_KEY = 'nai_selected_group_info'

function getInitialGroupId(): number | null {
  try {
    const savedGroupId = localStorage.getItem(GROUP_STORAGE_KEY)
    if (!savedGroupId) return null

    const parsed = Number.parseInt(savedGroupId, 10)
    return Number.isNaN(parsed) ? null : parsed
  } catch (error) {
    console.error('Failed to load saved group:', error)
    return null
  }
}

function getInitialGroupInfo(): GroupWithStats | null {
  try {
    const saved = localStorage.getItem(GROUP_INFO_STORAGE_KEY)
    if (!saved) return null
    return JSON.parse(saved) as GroupWithStats
  } catch (error) {
    console.error('Failed to load saved group info:', error)
    return null
  }
}

export function useNAIGroupSelection() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(getInitialGroupId)
  const [selectedGroup, setSelectedGroup] = useState<GroupWithStats | null>(getInitialGroupInfo)
  const [groupModalOpen, setGroupModalOpen] = useState(false)

  const loadGroupInfo = useCallback(async (groupId: number) => {
    try {
      const response = await apiClient.get<{ success: boolean; data?: GroupWithStats }>(`/api/groups/${groupId}`)
      if (response.data.success && response.data.data) {
        setSelectedGroup(response.data.data)
      }
    } catch (error) {
      console.error('Failed to load group info:', error)
      setSelectedGroupId(null)
      setSelectedGroup(null)
    }
  }, [])

  useEffect(() => {
    if (selectedGroupId !== null) {
      localStorage.setItem(GROUP_STORAGE_KEY, selectedGroupId.toString())
    } else {
      localStorage.removeItem(GROUP_STORAGE_KEY)
    }
  }, [selectedGroupId])

  useEffect(() => {
    if (selectedGroup) {
      localStorage.setItem(GROUP_INFO_STORAGE_KEY, JSON.stringify(selectedGroup))
    } else {
      localStorage.removeItem(GROUP_INFO_STORAGE_KEY)
    }
  }, [selectedGroup])

  const handleGroupSelect = async (groupId: number) => {
    setSelectedGroupId(groupId)
    await loadGroupInfo(groupId)
    setGroupModalOpen(false)
  }

  const handleRemoveGroup = () => {
    setSelectedGroupId(null)
    setSelectedGroup(null)
  }

  return {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    handleGroupSelect,
    handleRemoveGroup,
  }
}
