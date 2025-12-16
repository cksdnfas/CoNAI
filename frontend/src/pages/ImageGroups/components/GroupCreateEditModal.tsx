import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Box,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import DeleteIcon from '@mui/icons-material/Delete';

import { groupApi } from '../../../services/api';
import type { GroupWithStats, GroupWithHierarchy, GroupCreateData, GroupUpdateData, AutoCollectCondition, ComplexFilter } from '@comfyui-image-manager/shared';
import BasicInfoTab from './BasicInfoTab';
import AutoCollectTab from './AutoCollectTab';
import { GroupDeleteConfirmDialog } from './GroupDeleteConfirmDialog';
import { useCreateGroup, useUpdateGroup, useDeleteGroup, useAllGroupsWithHierarchy } from '../../../hooks/useGroups';

interface GroupCreateEditModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  group?: GroupWithHierarchy;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`group-tabpanel-${index}`}
      aria-labelledby={`group-tab-${index}`}
    >
      {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
    </div>
  );
};

const GroupCreateEditModal: React.FC<GroupCreateEditModalProps> = ({
  open,
  onClose,
  onSuccess,
  group
}) => {
  const { t } = useTranslation(['imageGroups', 'common']);
  const [activeTab, setActiveTab] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#2196f3',
    parent_id: null as number | null,
    auto_collect_enabled: false,
  });
  const [conditions, setConditions] = useState<ComplexFilter>({});
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isEditMode = !!group;

  // React Query hooks
  const { data: availableParents = [] } = useAllGroupsWithHierarchy();
  const createGroupMutation = useCreateGroup();
  const updateGroupMutation = useUpdateGroup();
  const deleteGroupMutation = useDeleteGroup();

  // Calculate child count for delete confirmation
  const childCount = group?.child_count || 0;

  // 폼 초기화
  useEffect(() => {
    if (group) {
      setFormData({
        name: group.name,
        description: group.description || '',
        color: group.color || '#2196f3',
        parent_id: group.parent_id || null,
        auto_collect_enabled: Boolean(group.auto_collect_enabled),
      });

      // 자동수집 조건 파싱 (ComplexFilter or legacy format)
      if (group.auto_collect_conditions) {
        try {
          const parsedConditions = JSON.parse(group.auto_collect_conditions);
          // ComplexFilter 형식인지 확인
          if (parsedConditions && typeof parsedConditions === 'object' &&
            ('exclude_group' in parsedConditions || 'or_group' in parsedConditions || 'and_group' in parsedConditions)) {
            setConditions(parsedConditions);
          } else if (Array.isArray(parsedConditions)) {
            // 레거시 배열 형식을 ComplexFilter로 변환
            setConditions({});
          } else {
            setConditions({});
          }
        } catch (e) {
          setConditions({});
        }
      } else {
        setConditions({});
      }
    } else {
      setFormData({
        name: '',
        description: '',
        color: '#2196f3',
        parent_id: null,
        auto_collect_enabled: false,
      });
      setConditions({});
    }
    setError(null);
    setActiveTab(0);
  }, [group, open]);

  // 폼 데이터 변경
  const handleFormChange = <K extends keyof typeof formData>(field: K, value: typeof formData[K]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // 조건 변경 핸들러 (ComplexFilter 지원)
  const handleConditionsChange = React.useCallback((newConditions: ComplexFilter) => {
    setConditions(newConditions);
  }, []);

  // 폼 유효성 검사 (ComplexFilter 지원)
  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError(t('imageGroups:validation.nameRequired'));
      return false;
    }

    if (formData.auto_collect_enabled) {
      // Check if conditions exist (either format)
      const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);
      const hasConditions = isComplexFilter
        ? (conditions.exclude_group?.length || 0) + (conditions.or_group?.length || 0) + (conditions.and_group?.length || 0) > 0
        : (conditions as AutoCollectCondition[]).length > 0;

      if (!hasConditions) {
        setError(t('imageGroups:validation.conditionRequired'));
        return false;
      }

      // Basic validation - detailed validation will be done by backend
      // ComplexFilter format handles validation in FilterConditionCard component
    }

    return true;
  };

  // 폼 제출
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setError(null);

    try {
      // Check if conditions exist (either format)
      const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);
      const hasConditions = isComplexFilter
        ? (conditions.exclude_group?.length || 0) + (conditions.or_group?.length || 0) + (conditions.and_group?.length || 0) > 0
        : (conditions as AutoCollectCondition[]).length > 0;

      const requestData: GroupCreateData | GroupUpdateData = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        color: formData.color,
        parent_id: formData.parent_id || undefined,
        auto_collect_enabled: formData.auto_collect_enabled,
        auto_collect_conditions: formData.auto_collect_enabled && hasConditions
          ? conditions
          : undefined,
      };

      if (isEditMode) {
        await updateGroupMutation.mutateAsync({ id: group.id, data: requestData });
      } else {
        await createGroupMutation.mutateAsync(requestData as GroupCreateData);
      }

      onSuccess();
    } catch (error) {
      console.error('Error saving group:', error);
      setError(t(`imageGroups:messages.${isEditMode ? 'updateFailed' : 'createFailed'}`));
    }
  };

  // 그룹 삭제 핸들러
  const handleDelete = () => {
    setDeleteDialogOpen(true);
  };

  // 삭제 확인 핸들러
  const handleDeleteConfirm = async (cascade: boolean) => {
    if (!group) return;

    try {
      await deleteGroupMutation.mutateAsync({ id: group.id, cascade });
      setDeleteDialogOpen(false);
      onSuccess();
    } catch (error) {
      console.error('Error deleting group:', error);
      setError(t('imageGroups:messages.deleteFailed'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {isEditMode ? t('imageGroups:modal.editTitle') : t('imageGroups:modal.createTitle')}
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* 탭 네비게이션 */}
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          aria-label="group editor tabs"
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          <Tab label={t('imageGroups:tabs.basicInfo')} id="group-tab-0" aria-controls="group-tabpanel-0" />
          <Tab label={t('imageGroups:tabs.autoCollect')} id="group-tab-1" aria-controls="group-tabpanel-1" />
        </Tabs>

        {/* 기본 정보 탭 */}
        <TabPanel value={activeTab} index={0}>
          <BasicInfoTab
            formData={formData}
            onFormChange={handleFormChange}
            availableParents={availableParents}
            currentGroupId={group?.id}
            isEditMode={isEditMode}
          />
        </TabPanel>

        {/* 자동수집 탭 */}
        <TabPanel value={activeTab} index={1}>
          <AutoCollectTab
            enabled={formData.auto_collect_enabled}
            conditions={conditions}
            onEnabledChange={(enabled) => handleFormChange('auto_collect_enabled', enabled)}
            onConditionsChange={handleConditionsChange}
          />
        </TabPanel>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {/* 삭제 버튼 (편집 모드에서만 표시) */}
        <Box>
          {isEditMode && (
            <Button
              onClick={handleDelete}
              color="error"
              startIcon={<DeleteIcon />}
              disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
            >
              {t('common:delete')}
            </Button>
          )}
        </Box>

        {/* 취소/저장 버튼 */}
        <Box>
          <Button onClick={onClose} disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}>
            {t('imageGroups:modal.buttonCancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={createGroupMutation.isPending || updateGroupMutation.isPending || deleteGroupMutation.isPending}
            startIcon={(createGroupMutation.isPending || updateGroupMutation.isPending) ? <CircularProgress size={20} /> : null}
            sx={{ ml: 1 }}
          >
            {isEditMode ? t('imageGroups:modal.buttonUpdate') : t('imageGroups:modal.buttonCreate')}
          </Button>
        </Box>
      </DialogActions>

      {/* 삭제 확인 다이얼로그 */}
      <GroupDeleteConfirmDialog
        open={deleteDialogOpen}
        group={group || null}
        childCount={childCount}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </Dialog>
  );
};

export default GroupCreateEditModal;
