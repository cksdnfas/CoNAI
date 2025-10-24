import { useState, useEffect } from 'react';
import api from '../../../../services/api';
import type { GroupWithStats } from '@comfyui-image-manager/shared';
import { GROUP_STORAGE_KEY } from '../constants/nai.constants';

export function useNAIGroupSelection() {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithStats | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);

  // 선택된 그룹 ID LocalStorage에서 불러오기
  useEffect(() => {
    try {
      const savedGroupId = localStorage.getItem(GROUP_STORAGE_KEY);
      if (savedGroupId) {
        const groupId = parseInt(savedGroupId);
        setSelectedGroupId(groupId);
        loadGroupInfo(groupId);
      }
    } catch (e) {
      console.error('Failed to load saved group:', e);
    }
  }, []);

  // 그룹 선택 시 LocalStorage에 저장
  useEffect(() => {
    if (selectedGroupId !== null) {
      localStorage.setItem(GROUP_STORAGE_KEY, selectedGroupId.toString());
    } else {
      localStorage.removeItem(GROUP_STORAGE_KEY);
    }
  }, [selectedGroupId]);

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

  const handleGroupSelect = async (groupId: number) => {
    setSelectedGroupId(groupId);
    await loadGroupInfo(groupId);
    setGroupModalOpen(false);
  };

  const handleRemoveGroup = () => {
    setSelectedGroupId(null);
    setSelectedGroup(null);
  };

  return {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    handleGroupSelect,
    handleRemoveGroup
  };
}
