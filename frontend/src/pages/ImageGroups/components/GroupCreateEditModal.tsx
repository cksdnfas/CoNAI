import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControlLabel,
  Switch,
  Box,
  Typography,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

import { groupApi } from '../../../services/api';
import type { GroupWithStats, GroupCreateData, GroupUpdateData, AutoCollectCondition } from '../../../types/group';

interface GroupCreateEditModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  group?: GroupWithStats;
}

const CONDITION_TYPES = [
  { value: 'prompt_contains', label: '프롬프트 포함' },
  { value: 'prompt_regex', label: '프롬프트 정규식' },
  { value: 'negative_prompt_contains', label: '네거티브 프롬프트 포함' },
  { value: 'negative_prompt_regex', label: '네거티브 프롬프트 정규식' },
  { value: 'ai_tool', label: 'AI 도구' },
  { value: 'model_name', label: '모델명' },
];

const PRESET_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#cddc39',
  '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
];

const GroupCreateEditModal: React.FC<GroupCreateEditModalProps> = ({
  open,
  onClose,
  onSuccess,
  group
}) => {
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
  }, [group, open]);

  // 폼 데이터 변경
  const handleFormChange = (field: string, value: any) => {
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
  const updateCondition = (index: number, field: keyof AutoCollectCondition, value: any) => {
    setConditions(prev => prev.map((condition, i) =>
      i === index ? { ...condition, [field]: value } : condition
    ));
  };

  // 폼 유효성 검사
  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError('그룹명을 입력해주세요.');
      return false;
    }

    if (formData.auto_collect_enabled) {
      if (conditions.length === 0) {
        setError('자동수집을 활성화하려면 최소 1개의 조건을 추가해주세요.');
        return false;
      }

      for (let i = 0; i < conditions.length; i++) {
        if (!conditions[i].value.trim()) {
          setError(`조건 ${i + 1}의 값을 입력해주세요.`);
          return false;
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
        setError(response.error || `그룹 ${isEditMode ? '수정' : '생성'}에 실패했습니다.`);
      }
    } catch (error) {
      console.error('Error saving group:', error);
      setError(`그룹 ${isEditMode ? '수정' : '생성'}에 실패했습니다.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {isEditMode ? '그룹 편집' : '새 그룹 생성'}
      </DialogTitle>

      <DialogContent dividers>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {/* 기본 정보 */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            기본 정보
          </Typography>

          <TextField
            label="그룹명"
            fullWidth
            required
            value={formData.name}
            onChange={(e) => handleFormChange('name', e.target.value)}
            sx={{ mb: 2 }}
          />

          <TextField
            label="설명"
            fullWidth
            multiline
            rows={2}
            value={formData.description}
            onChange={(e) => handleFormChange('description', e.target.value)}
            sx={{ mb: 2 }}
          />

          {/* 색상 선택 */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              그룹 색상
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {PRESET_COLORS.map((color) => (
                <Box
                  key={color}
                  sx={{
                    width: 32,
                    height: 32,
                    backgroundColor: color,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    border: formData.color === color ? '3px solid #000' : '2px solid #ccc',
                    '&:hover': {
                      transform: 'scale(1.1)',
                    },
                  }}
                  onClick={() => handleFormChange('color', color)}
                />
              ))}
            </Box>
          </Box>
        </Box>

        {/* 자동수집 설정 */}
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={formData.auto_collect_enabled}
                onChange={(e) => handleFormChange('auto_collect_enabled', e.target.checked)}
              />
            }
            label="자동수집 활성화"
          />

          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            설정한 조건에 맞는 이미지를 자동으로 이 그룹에 추가합니다.
          </Typography>
        </Box>

        {/* 자동수집 조건 */}
        {formData.auto_collect_enabled ? (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                자동수집 조건
              </Typography>
              <Button
                startIcon={<AddIcon />}
                onClick={addCondition}
                variant="outlined"
                size="small"
              >
                조건 추가
              </Button>
            </Box>

            {conditions.map((condition, index) => (
              <Box
                key={index}
                sx={{
                  border: '1px solid',
                  borderColor: 'grey.300',
                  borderRadius: 1,
                  p: 2,
                  mb: 2,
                }}
              >
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <FormControl sx={{ minWidth: 200 }}>
                    <InputLabel>조건 유형</InputLabel>
                    <Select
                      value={condition.type}
                      label="조건 유형"
                      onChange={(e) => updateCondition(index, 'type', e.target.value)}
                    >
                      {CONDITION_TYPES.map((type) => (
                        <MenuItem key={type.value} value={type.value}>
                          {type.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    label="값"
                    fullWidth
                    value={condition.value}
                    onChange={(e) => updateCondition(index, 'value', e.target.value)}
                    placeholder={
                      condition.type.includes('regex')
                        ? '정규식 패턴을 입력하세요'
                        : '검색할 텍스트를 입력하세요'
                    }
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={condition.case_sensitive || false}
                        onChange={(e) => updateCondition(index, 'case_sensitive', e.target.checked)}
                      />
                    }
                    label="대소문자 구분"
                  />

                  <IconButton
                    onClick={() => removeCondition(index)}
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              </Box>
            ))}

            {conditions.length === 0 ? (
              <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 3 }}>
                조건을 추가하여 자동수집 규칙을 설정하세요.
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          취소
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {isEditMode ? '수정' : '생성'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GroupCreateEditModal;