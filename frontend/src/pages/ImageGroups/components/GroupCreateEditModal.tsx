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
  Slider,
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
  // 기본 조건
  { value: 'ai_tool', label: 'AI 도구', group: '기본' },
  { value: 'model_name', label: '모델명 (메타데이터)', group: '기본' },

  // 프롬프트 조건
  { value: 'prompt_contains', label: '프롬프트 포함', group: '프롬프트' },
  { value: 'prompt_regex', label: '프롬프트 정규식', group: '프롬프트' },
  { value: 'negative_prompt_contains', label: '네거티브 프롬프트 포함', group: '프롬프트' },
  { value: 'negative_prompt_regex', label: '네거티브 프롬프트 정규식', group: '프롬프트' },

  // 오토태그 조건
  { value: 'auto_tag_exists', label: '오토태그 존재 여부', group: '오토태그' },
  { value: 'auto_tag_rating', label: '오토태그: Rating', group: '오토태그' },
  { value: 'auto_tag_rating_score', label: '오토태그: Rating 점수 (가중치)', group: '오토태그' },
  { value: 'auto_tag_general', label: '오토태그: General 태그', group: '오토태그' },
  { value: 'auto_tag_character', label: '오토태그: 캐릭터', group: '오토태그' },
  { value: 'auto_tag_has_character', label: '오토태그: 캐릭터 존재 여부', group: '오토태그' },
  { value: 'auto_tag_model', label: '오토태그: 모델명', group: '오토태그' },
];

const RATING_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'sensitive', label: 'Sensitive' },
  { value: 'questionable', label: 'Questionable' },
  { value: 'explicit', label: 'Explicit' },
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
        const updated = { ...condition, [field]: value };

        // 타입이 변경될 때 관련 필드 초기화
        if (field === 'type') {
          const newType = value as AutoCollectCondition['type'];

          // Boolean 타입 조건
          if (newType === 'auto_tag_exists' || newType === 'auto_tag_has_character') {
            updated.value = true;
            delete updated.min_score;
            delete updated.max_score;
            delete updated.rating_type;
            delete updated.case_sensitive;
          }
          // Rating 조건
          else if (newType === 'auto_tag_rating') {
            updated.value = '';
            updated.rating_type = 'general';
            delete updated.case_sensitive;
          }
          // Rating Score 조건 (가중치 기반)
          else if (newType === 'auto_tag_rating_score') {
            updated.value = '';  // value는 사용하지 않지만 빈 문자열로 설정
            updated.min_score = 0;
            updated.max_score = 200;
            delete updated.rating_type;
            delete updated.case_sensitive;
          }
          // 점수 범위가 있는 조건
          else if (newType === 'auto_tag_general' || newType === 'auto_tag_character') {
            updated.value = '';
            delete updated.rating_type;
            delete updated.case_sensitive;
          }
          // 문자열 조건
          else {
            updated.value = '';
            delete updated.min_score;
            delete updated.max_score;
            delete updated.rating_type;
          }
        }

        return updated;
      }
      return condition;
    }));
  };

  // 조건 타입에 따른 입력 필드 결정
  const getConditionFieldType = (type: AutoCollectCondition['type']): 'string' | 'boolean' | 'score' | 'rating' | 'rating_score' => {
    // Boolean 타입: 존재 여부 확인
    if (type === 'auto_tag_exists' || type === 'auto_tag_has_character') {
      return 'boolean';
    }
    // Rating 타입: Rating 유형 선택 (General, Sensitive, etc.)
    if (type === 'auto_tag_rating') {
      return 'rating';
    }
    // Rating Score 타입: 가중치 기반 점수 범위 (0-200)
    if (type === 'auto_tag_rating_score') {
      return 'rating_score';
    }
    // Score 타입: 태그명/캐릭터명 + 신뢰도 점수 (0.0-1.0)
    if (type === 'auto_tag_general' || type === 'auto_tag_character') {
      return 'score';
    }
    // String 타입: 문자열 검색 (프롬프트, 모델명 등)
    return 'string';
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
        const condition = conditions[i];
        const fieldType = getConditionFieldType(condition.type);

        // 값 검증
        if (fieldType === 'string' && typeof condition.value === 'string' && !condition.value.trim()) {
          setError(`조건 ${i + 1}의 값을 입력해주세요.`);
          return false;
        }

        // Rating 조건 검증
        if (condition.type === 'auto_tag_rating' && !condition.rating_type) {
          setError(`조건 ${i + 1}: Rating 유형을 선택해주세요.`);
          return false;
        }

        // Rating Score 조건 검증 (가중치 기반)
        if (condition.type === 'auto_tag_rating_score') {
          if (condition.min_score === undefined && condition.max_score === undefined) {
            setError(`조건 ${i + 1}: 최소 점수 또는 최대 점수 중 하나는 설정해야 합니다.`);
            return false;
          }
          if (condition.min_score !== undefined && condition.min_score < 0) {
            setError(`조건 ${i + 1}: 최소 점수는 0 이상이어야 합니다.`);
            return false;
          }
          if (condition.max_score !== undefined && condition.max_score < 0) {
            setError(`조건 ${i + 1}: 최대 점수는 0 이상이어야 합니다.`);
            return false;
          }
          if (condition.min_score !== undefined && condition.max_score !== undefined && condition.min_score >= condition.max_score) {
            setError(`조건 ${i + 1}: 최소 점수는 최대 점수보다 작아야 합니다.`);
            return false;
          }
        }

        // 일반 점수 범위 검증 (Rating, General 태그, 캐릭터만 해당)
        if (fieldType === 'rating' || fieldType === 'score') {
          if (condition.min_score !== undefined) {
            if (condition.min_score < 0 || condition.min_score > 1) {
              setError(`조건 ${i + 1}: 최소 점수는 0.0 ~ 1.0 사이여야 합니다.`);
              return false;
            }
          }

          if (condition.max_score !== undefined) {
            if (condition.max_score < 0 || condition.max_score > 1) {
              setError(`조건 ${i + 1}: 최대 점수는 0.0 ~ 1.0 사이여야 합니다.`);
              return false;
            }
          }

          if (condition.min_score !== undefined && condition.max_score !== undefined) {
            if (condition.min_score > condition.max_score) {
              setError(`조건 ${i + 1}: 최소 점수가 최대 점수보다 클 수 없습니다.`);
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

          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
            설정한 조건에 맞는 이미지를 자동으로 이 그룹에 추가합니다.
          </Typography>
          <Alert severity="info" sx={{ mt: 1 }}>
            <Typography variant="body2">
              <strong>OR 조건:</strong> 여러 조건을 추가하면 <strong>하나라도 만족</strong>하는 이미지가 자동수집됩니다.
            </Typography>
            <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
              예시: "프롬프트에 'anime' 포함" + "오토태그 캐릭터 존재" → 둘 중 하나만 만족해도 수집
            </Typography>
          </Alert>
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

            {conditions.map((condition, index) => {
              const fieldType = getConditionFieldType(condition.type);

              return (
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
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
                    <FormControl sx={{ minWidth: 220 }}>
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

                    {/* Boolean 타입 (존재 여부) */}
                    {fieldType === 'boolean' && (
                      <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel>값</InputLabel>
                        <Select
                          value={condition.value === true ? 'true' : 'false'}
                          label="값"
                          onChange={(e) => updateCondition(index, 'value', e.target.value === 'true')}
                        >
                          <MenuItem value="true">있음</MenuItem>
                          <MenuItem value="false">없음</MenuItem>
                        </Select>
                      </FormControl>
                    )}

                    {/* Rating 조건 */}
                    {fieldType === 'rating' && (
                      <FormControl sx={{ minWidth: 200 }}>
                        <InputLabel>Rating 유형</InputLabel>
                        <Select
                          value={condition.rating_type || 'general'}
                          label="Rating 유형"
                          onChange={(e) => updateCondition(index, 'rating_type', e.target.value)}
                        >
                          {RATING_TYPES.map((rating) => (
                            <MenuItem key={rating.value} value={rating.value}>
                              {rating.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}

                    {/* Rating Score 조건 (가중치 기반) */}
                    {fieldType === 'rating_score' && (
                      <>
                        <TextField
                          label="최소 점수"
                          type="number"
                          value={condition.min_score !== undefined ? condition.min_score : 0}
                          onChange={(e) => updateCondition(index, 'min_score', Number(e.target.value))}
                          sx={{ minWidth: 150 }}
                          inputProps={{ min: 0, step: 1 }}
                          helperText="가중치 합산 점수"
                        />
                        <TextField
                          label="최대 점수"
                          type="number"
                          value={condition.max_score !== undefined ? condition.max_score : 200}
                          onChange={(e) => updateCondition(index, 'max_score', Number(e.target.value))}
                          sx={{ minWidth: 150 }}
                          inputProps={{ min: 0, step: 1 }}
                          helperText="일반적으로 200까지"
                        />
                      </>
                    )}

                    {/* 점수 범위 조건 (General 태그, 캐릭터) */}
                    {fieldType === 'score' && (
                      <TextField
                        label={condition.type === 'auto_tag_character' ? '캐릭터명' : '태그명'}
                        fullWidth
                        value={condition.value}
                        onChange={(e) => updateCondition(index, 'value', e.target.value)}
                        placeholder={condition.type === 'auto_tag_character' ? '캐릭터명 입력' : '태그명 입력'}
                      />
                    )}

                    {/* 문자열 조건 */}
                    {fieldType === 'string' && (
                      <>
                        <TextField
                          label="값"
                          fullWidth
                          value={condition.value}
                          onChange={(e) => updateCondition(index, 'value', e.target.value)}
                          placeholder={
                            condition.type.includes('regex')
                              ? '정규식 패턴을 입력하세요'
                              : condition.type === 'auto_tag_model'
                              ? '모델명 입력 (예: wd-v1-4-moat-tagger-v2)'
                              : '검색할 텍스트를 입력하세요'
                          }
                        />

                        {/* 대소문자 구분 (문자열 조건만) */}
                        {!condition.type.startsWith('auto_tag_') && (
                          <FormControlLabel
                            control={
                              <Switch
                                checked={condition.case_sensitive || false}
                                onChange={(e) => updateCondition(index, 'case_sensitive', e.target.checked)}
                              />
                            }
                            label="대소문자 구분"
                          />
                        )}

                        {/* 오토태그 모델명은 case_sensitive 지원 */}
                        {condition.type === 'auto_tag_model' && (
                          <FormControlLabel
                            control={
                              <Switch
                                checked={condition.case_sensitive || false}
                                onChange={(e) => updateCondition(index, 'case_sensitive', e.target.checked)}
                              />
                            }
                            label="대소문자 구분"
                          />
                        )}
                      </>
                    )}

                    <IconButton
                      onClick={() => removeCondition(index)}
                      color="error"
                      sx={{ mt: 1 }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>

                  {/* 점수 범위 입력 (Rating, General 태그, 캐릭터) - rating_score는 위에서 직접 입력 */}
                  {(fieldType === 'rating' || fieldType === 'score') && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary" gutterBottom>
                        신뢰도 점수 범위 (0.0 ~ 1.0): {(condition.min_score ?? 0).toFixed(2)} ~ {(condition.max_score ?? 1).toFixed(2)}
                      </Typography>
                      <Slider
                        value={[condition.min_score ?? 0, condition.max_score ?? 1]}
                        onChange={(_, newValue) => {
                          const [min, max] = newValue as [number, number];
                          updateCondition(index, 'min_score', min);
                          updateCondition(index, 'max_score', max);
                        }}
                        valueLabelDisplay="auto"
                        min={0}
                        max={1}
                        step={0.01}
                        size="small"
                        marks={[
                          { value: 0, label: '0.0' },
                          { value: 0.5, label: '0.5' },
                          { value: 1, label: '1.0' },
                        ]}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        💡 높은 점수일수록 해당 태그의 신뢰도가 높습니다
                      </Typography>
                    </Box>
                  )}
                </Box>
              );
            })}

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