import { useState } from 'react';
import api from '../../../services/api';
import type { GroupWithStats } from '@comfyui-image-manager/shared';

/**
 * 그룹 관리 Hook
 * - 그룹 선택
 * - localStorage 연동
 * - 그룹 정보 로딩
 */
export function useGroupManagement() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithStats | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  /**
   * 저장된 그룹 로딩
   */
  const loadSavedGroup = async () => {
    try {
      const savedGroupId = localStorage.getItem('workflow_selected_group_id');
      if (savedGroupId) {
        const groupId = parseInt(savedGroupId);
        setSelectedGroupId(groupId);
        await loadGroupInfo(groupId);
      }
    } catch (e) {
      console.error('Failed to load saved group:', e);
    }
  };

  /**
   * 그룹 정보 로딩
   */
  const loadGroupInfo = async (groupId: number) => {
    try {
      const response = await api.get(`/api/groups/${groupId}`);
      if (response.data.success) {
        setSelectedGroup(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load group info:', error);
      setSelectedGroupId(null);
      setSelectedGroup(null);
    }
  };

  /**
   * 그룹 선택 핸들러
   */
  const handleGroupSelect = async (groupId: number) => {
    setSelectedGroupId(groupId);
    localStorage.setItem('workflow_selected_group_id', groupId.toString());
    await loadGroupInfo(groupId);
    setGroupModalOpen(false);
  };

  /**
   * 그룹 제거 핸들러
   */
  const handleRemoveGroup = () => {
    setSelectedGroupId(null);
    setSelectedGroup(null);
    localStorage.removeItem('workflow_selected_group_id');
  };

  return {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    loadSavedGroup,
    handleGroupSelect,
    handleRemoveGroup
  };
}
