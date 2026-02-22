import { useCallback, useState } from 'react'
import { apiClient } from '@/lib/api/client'
import type { GroupWithStats } from '@comfyui-image-manager/shared'

export function useGroupManagement() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<GroupWithStats | null>(null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)

  const loadGroupInfo = useCallback(async (groupId: number) => {
    try {
      const response = await apiClient.get(`/api/groups/${groupId}`)
      if (response.data.success) {
        setSelectedGroup(response.data.data)
      }
    } catch (loadError) {
      console.error('Failed to load group info:', loadError)
      setSelectedGroupId(null)
      setSelectedGroup(null)
    }
  }, [])

  const loadSavedGroup = useCallback(async () => {
    try {
      const savedGroupId = localStorage.getItem('workflow_selected_group_id')
      if (savedGroupId) {
        const groupId = parseInt(savedGroupId, 10)
        setSelectedGroupId(groupId)
        await loadGroupInfo(groupId)
      }
    } catch (loadError) {
      console.error('Failed to load saved group:', loadError)
    }
  }, [loadGroupInfo])

  const handleGroupSelect = useCallback(
    async (groupId: number) => {
      setSelectedGroupId(groupId)
      localStorage.setItem('workflow_selected_group_id', groupId.toString())
      await loadGroupInfo(groupId)
      setGroupModalOpen(false)
    },
    [loadGroupInfo],
  )

  const handleRemoveGroup = useCallback(() => {
    setSelectedGroupId(null)
    setSelectedGroup(null)
    localStorage.removeItem('workflow_selected_group_id')
  }, [])

  return {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    loadSavedGroup,
    handleGroupSelect,
    handleRemoveGroup,
  }
}
