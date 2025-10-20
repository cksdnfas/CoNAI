import { useState, useCallback } from 'react';
import { promptGroupApi } from '../../../../../services/api';
import type { PromptGroupWithPrompts, PromptGroupData } from '@comfyui-image-manager/shared';

export interface EditingGroup {
  id?: number;
  group_name: string;
  display_order: number;
  is_visible: boolean;
}

export const useGroupManagement = (
  type: 'positive' | 'negative',
  onSuccess: (message: string) => void,
  onError: (message: string) => void
) => {
  const [groups, setGroups] = useState<PromptGroupWithPrompts[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 그룹 목록 조회
  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const response = await promptGroupApi.getGroups(true, type);
      if (response.success && response.data) {
        const sortedGroups = response.data.sort((a, b) => a.display_order - b.display_order);
        setGroups(sortedGroups);
      } else {
        onError('Failed to load groups');
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      onError('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [type, onError]);

  // 새 그룹 추가 시작
  const startAddGroup = useCallback(() => {
    const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.display_order)) : 0;
    setEditingGroup({
      group_name: '',
      display_order: maxOrder + 1,
      is_visible: true,
    });
    setIsEditing(true);
  }, [groups]);

  // 그룹 편집 시작
  const startEditGroup = useCallback((group: PromptGroupWithPrompts) => {
    setEditingGroup({
      id: group.id,
      group_name: group.group_name,
      display_order: group.display_order,
      is_visible: group.is_visible,
    });
    setIsEditing(true);
  }, []);

  // 편집 취소
  const cancelEdit = useCallback(() => {
    setEditingGroup(null);
    setIsEditing(false);
  }, []);

  // 그룹 저장
  const saveGroup = useCallback(async (onGroupsChange: () => void) => {
    if (!editingGroup || !editingGroup.group_name.trim()) {
      onError('Group name is required');
      return;
    }

    try {
      const groupData: PromptGroupData = {
        group_name: editingGroup.group_name.trim(),
        display_order: editingGroup.display_order,
        is_visible: editingGroup.is_visible,
      };

      let response;
      if (editingGroup.id) {
        response = await promptGroupApi.updateGroup(editingGroup.id, groupData, type);
      } else {
        response = await promptGroupApi.createGroup(groupData, type);
      }

      if (response.success) {
        onSuccess(editingGroup.id ? 'Group updated successfully' : 'Group created successfully');
        await fetchGroups();
        onGroupsChange();
        cancelEdit();
      } else {
        onError(response.error || (editingGroup.id ? 'Failed to update group' : 'Failed to create group'));
      }
    } catch (error) {
      console.error('Error saving group:', error);
      onError(editingGroup?.id ? 'Failed to update group' : 'Failed to create group');
    }
  }, [editingGroup, type, onSuccess, onError, fetchGroups, cancelEdit]);

  // 그룹 삭제
  const deleteGroup = useCallback(async (groupId: number, onGroupsChange: () => void) => {
    if (!confirm('Are you sure you want to delete this group?')) {
      return;
    }

    try {
      const response = await promptGroupApi.deleteGroup(groupId, type);
      if (response.success) {
        onSuccess('Group deleted successfully');
        await fetchGroups();
        onGroupsChange();
      } else {
        onError(response.error || 'Failed to delete group');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      onError('Failed to delete group');
    }
  }, [type, onSuccess, onError, fetchGroups]);

  // 가시성 토글
  const toggleVisibility = useCallback(async (group: PromptGroupWithPrompts, onGroupsChange: () => void) => {
    try {
      const groupData: PromptGroupData = {
        group_name: group.group_name,
        display_order: group.display_order,
        is_visible: !group.is_visible,
      };

      const response = await promptGroupApi.updateGroup(group.id, groupData, type);
      if (response.success) {
        await fetchGroups();
        onGroupsChange();
      } else {
        onError(response.error || 'Failed to toggle visibility');
      }
    } catch (error) {
      console.error('Error toggling visibility:', error);
      onError('Failed to toggle visibility');
    }
  }, [type, onError, fetchGroups]);

  // 그룹 순서 업데이트 (드래그앤드롭용)
  const updateGroupsOrder = useCallback(async (reorderedGroups: PromptGroupWithPrompts[], onGroupsChange: () => void) => {
    try {
      // 낙관적 업데이트
      setGroups(reorderedGroups);

      // 서버에 순서 업데이트
      const updatePromises = reorderedGroups.map((group, index) => {
        const groupData: PromptGroupData = {
          group_name: group.group_name,
          display_order: index + 1,
          is_visible: group.is_visible,
        };
        return promptGroupApi.updateGroup(group.id, groupData, type);
      });

      const results = await Promise.all(updatePromises);
      const hasError = results.some(r => !r.success);

      if (hasError) {
        onError('Failed to update group order');
        await fetchGroups(); // 실패 시 다시 로드
      } else {
        onSuccess('Group order updated successfully');
        onGroupsChange();
      }
    } catch (error) {
      console.error('Error updating groups order:', error);
      onError('Failed to update group order');
      await fetchGroups(); // 실패 시 다시 로드
    }
  }, [type, onSuccess, onError, fetchGroups]);

  // 편집 중인 그룹 업데이트
  const updateEditingGroup = useCallback((updates: Partial<EditingGroup>) => {
    setEditingGroup(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  return {
    groups,
    loading,
    editingGroup,
    isEditing,
    fetchGroups,
    startAddGroup,
    startEditGroup,
    cancelEdit,
    saveGroup,
    deleteGroup,
    toggleVisibility,
    updateGroupsOrder,
    updateEditingGroup,
    setGroups,
  };
};
