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

import { groupApi } from '../../../services/api';
import type { GroupWithStats, GroupCreateData, GroupUpdateData, AutoCollectCondition } from '@comfyui-image-manager/shared';
import BasicInfoTab from './BasicInfoTab';
import AutoCollectTab from './AutoCollectTab';

interface GroupCreateEditModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  group?: GroupWithStats;
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
    auto_collect_enabled: false,
  });
  const [conditions, setConditions] = useState<AutoCollectCondition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!group;

  // 폼 초기화
  useEffect(() => {
    if (group) {
      setFormData({
        name: group.name,
        description: group.description || '',
        color: group.color || '#2196f3',
        auto_collect_enabled: group.auto_collect_enabled,
      });

      // 자동수집 조건 파싱
      if (group.auto_collect_conditions) {
        try {
          const parsedConditions = JSON.parse(group.auto_collect_conditions);
          setConditions(Array.isArray(parsedConditions) ? parsedConditions : []);
        } catch (e) {
          setConditions([]);
        }
      } else {
        setConditions([]);
      }
    } else {
      setFormData({
        name: '',
        description: '',
        color: '#2196f3',
        auto_collect_enabled: false,
      });
      setConditions([]);
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

  // 조건 추가
  const addCondition = () => {
    setConditions(prev => [
      ...prev,
      {
        type: 'prompt_contains',
        value: '',
        case_sensitive: false
      }
    ]);
  };

  // 조건 삭제
  const removeCondition = (index: number) => {
    setConditions(prev => prev.filter((_, i) => i !== index));
  };

  // 조건 변경
  const updateCondition = <K extends keyof AutoCollectCondition>(
    index: number,
    field: K,
    value: AutoCollectCondition[K]
  ) => {
    setConditions(prev => prev.map((condition, i) => {
      if (i === index) {
        return { ...condition, [field]: value };
      }
      return condition;
    }));
  };

  // 조건 타입에 따른 입력 필드 결정
  const getConditionFieldType = (type: AutoCollectCondition['type']): 'string' | 'boolean' | 'score' | 'rating' | 'rating_score' | 'duplicate' => {
    if (type === 'auto_tag_exists' || type === 'auto_tag_has_character') {
      return 'boolean';
    }
    if (type === 'auto_tag_rating') {
      return 'rating';
    }
    if (type === 'auto_tag_rating_score') {
      return 'rating_score';
    }
    if (type === 'auto_tag_general' || type === 'auto_tag_character') {
      return 'score';
    }
    if (type.startsWith('duplicate_')) {
      return 'duplicate';
    }
    return 'string';
  };

  // 폼 유효성 검사
  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError(t('imageGroups:validation.nameRequired'));
      return false;
    }

    if (formData.auto_collect_enabled) {
      if (conditions.length === 0) {
        setError(t('imageGroups:validation.conditionRequired'));
        return false;
      }

      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        const fieldType = getConditionFieldType(condition.type);

        // 값 검증
        if (fieldType === 'string' && typeof condition.value === 'string' && !condition.value.trim()) {
          setError(t('imageGroups:validation.valueRequired', { index: i + 1 }));
          return false;
        }

        // Rating 조건 검증
        if (condition.type === 'auto_tag_rating' && !condition.rating_type) {
          setError(t('imageGroups:validation.ratingTypeRequired', { index: i + 1 }));
          return false;
        }

        // Rating Score 조건 검증
        if (condition.type === 'auto_tag_rating_score') {
          if (condition.min_score === undefined && condition.max_score === undefined) {
            setError(t('imageGroups:validation.ratingScoreRequired', { index: i + 1 }));
            return false;
          }
          if (condition.min_score !== undefined && condition.min_score < 0) {
            setError(t('imageGroups:validation.minScoreInvalid', { index: i + 1 }));
            return false;
          }
          if (condition.max_score !== undefined && condition.max_score < 0) {
            setError(t('imageGroups:validation.maxScoreInvalid', { index: i + 1 }));
            return false;
          }
          if (condition.min_score !== undefined && condition.max_score !== undefined && condition.min_score >= condition.max_score) {
            setError(t('imageGroups:validation.scoreRangeInvalid', { index: i + 1 }));
            return false;
          }
        }

        // 일반 점수 범위 검증
        if (fieldType === 'rating' || fieldType === 'score') {
          if (condition.min_score !== undefined) {
            if (condition.min_score < 0 || condition.min_score > 1) {
              setError(t('imageGroups:validation.confidenceScoreRange', { index: i + 1 }));
              return false;
            }
          }

          if (condition.max_score !== undefined) {
            if (condition.max_score < 0 || condition.max_score > 1) {
              setError(t('imageGroups:validation.confidenceMaxScoreRange', { index: i + 1 }));
              return false;
            }
          }

          if (condition.min_score !== undefined && condition.max_score !== undefined) {
            if (condition.min_score > condition.max_score) {
              setError(t('imageGroups:validation.confidenceMinMaxInvalid', { index: i + 1 }));
              return false;
            }
          }
        }

        // 중복 조건 검증
        if (fieldType === 'duplicate') {
          if (condition.type === 'duplicate_custom') {
            if (condition.hamming_threshold === undefined) {
              setError(t('imageGroups:validation.hammingThresholdRequired', { index: i + 1 }));
              return false;
            }
            if (condition.hamming_threshold < 0 || condition.hamming_threshold > 64) {
              setError(t('imageGroups:validation.hammingThresholdRange', { index: i + 1 }));
              return false;
            }
          }
        }
      }
    }

    return true;
  };

  // 폼 제출
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError(null);

    try {
      const requestData: GroupCreateData | GroupUpdateData = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        color: formData.color,
        auto_collect_enabled: formData.auto_collect_enabled,
        auto_collect_conditions: formData.auto_collect_enabled && conditions.length > 0
          ? conditions
          : undefined,
      };

      let response;
      if (isEditMode) {
        response = await groupApi.updateGroup(group.id, requestData);
      } else {
        response = await groupApi.createGroup(requestData as GroupCreateData);
      }

      if (response.success) {
        onSuccess();
      } else {
        setError(response.error || t(`imageGroups:messages.${isEditMode ? 'updateFailed' : 'createFailed'}`));
      }
    } catch (error) {
      console.error('Error saving group:', error);
      setError(t(`imageGroups:messages.${isEditMode ? 'updateFailed' : 'createFailed'}`));
    } finally {
      setLoading(false);
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
          />
        </TabPanel>

        {/* 자동수집 탭 */}
        <TabPanel value={activeTab} index={1}>
          <AutoCollectTab
            enabled={formData.auto_collect_enabled}
            conditions={conditions}
            onEnabledChange={(enabled) => handleFormChange('auto_collect_enabled', enabled)}
            onAddCondition={addCondition}
            onUpdateCondition={updateCondition}
            onRemoveCondition={removeCondition}
          />
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {t('imageGroups:modal.buttonCancel')}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {isEditMode ? t('imageGroups:modal.buttonUpdate') : t('imageGroups:modal.buttonCreate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GroupCreateEditModal;
