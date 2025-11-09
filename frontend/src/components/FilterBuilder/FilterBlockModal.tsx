import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Slider,
  Switch,
  FormControlLabel,
  Divider,
  Grid,
} from '@mui/material';
import {
  Block as BlockIcon,
  CallSplit as OrIcon,
  MergeType as AndIcon,
} from '@mui/icons-material';
import type { FilterCondition, FilterGroupType, FilterCategory } from '@comfyui-image-manager/shared';

interface FilterBlockModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (groupType: FilterGroupType, condition: FilterCondition) => void;
  initialData?: {
    groupType: FilterGroupType;
    condition: FilterCondition;
  };
}

// 그룹 타입 스타일
const GROUP_STYLES = {
  exclude: {
    color: '#f44336',
    '&.Mui-selected': {
      backgroundColor: 'rgba(244, 67, 54, 0.12)',
      borderColor: '#f44336 !important',
      color: '#f44336',
      fontWeight: 600,
      '&:hover': {
        backgroundColor: 'rgba(244, 67, 54, 0.2)',
      },
    },
  },
  or: {
    color: '#2196f3',
    '&.Mui-selected': {
      backgroundColor: 'rgba(33, 150, 243, 0.12)',
      borderColor: '#2196f3 !important',
      color: '#2196f3',
      fontWeight: 600,
      '&:hover': {
        backgroundColor: 'rgba(33, 150, 243, 0.2)',
      },
    },
  },
  and: {
    color: '#4caf50',
    '&.Mui-selected': {
      backgroundColor: 'rgba(76, 175, 80, 0.12)',
      borderColor: '#4caf50 !important',
      color: '#4caf50',
      fontWeight: 600,
      '&:hover': {
        backgroundColor: 'rgba(76, 175, 80, 0.2)',
      },
    },
  },
};

// 카테고리별 조건 타입
const CONDITION_TYPES: Record<FilterCategory, Array<{ value: string; label: string }>> = {
  positive_prompt: [
    { value: 'prompt_contains', label: '포함' },
    { value: 'prompt_regex', label: '정규식' },
  ],
  negative_prompt: [
    { value: 'negative_prompt_contains', label: '포함' },
    { value: 'negative_prompt_regex', label: '정규식' },
  ],
  auto_tag: [
    { value: 'auto_tag_exists', label: '자동태그 존재' },
    { value: 'auto_tag_has_character', label: '캐릭터 존재' },
    { value: 'auto_tag_rating', label: 'Rating 타입' },
    { value: 'auto_tag_rating_score', label: 'Rating 점수' },
    { value: 'auto_tag_general', label: 'General 태그' },
    { value: 'auto_tag_character', label: 'Character 태그' },
    { value: 'auto_tag_model', label: '모델' },
  ],
  basic: [
    { value: 'ai_tool', label: 'AI 도구' },
    { value: 'model_name', label: '모델명' },
  ],
};

const FilterBlockModal: React.FC<FilterBlockModalProps> = ({ open, onClose, onAdd, initialData }) => {
  // 상태 관리
  const [selectedGroup, setSelectedGroup] = useState<FilterGroupType | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory | null>(null);
  const [conditionType, setConditionType] = useState<string>('');
  const [conditionValue, setConditionValue] = useState<string | number | boolean>('');
  const [minScore, setMinScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(1);
  const [ratingType, setRatingType] = useState<'general' | 'sensitive' | 'questionable' | 'explicit'>('general');

  // initialData로 폼 초기화 (편집 모드)
  useEffect(() => {
    if (open && initialData) {
      setSelectedGroup(initialData.groupType);
      setSelectedCategory(initialData.condition.category);
      setConditionType(initialData.condition.type);
      setConditionValue(initialData.condition.value);
      setMinScore(initialData.condition.min_score ?? 0);
      setMaxScore(initialData.condition.max_score ?? 1);
      setRatingType(initialData.condition.rating_type ?? 'general');
    }
  }, [open, initialData]);

  // 카테고리 변경 시 조건 타입 초기화 (새 필터 추가 시에만)
  useEffect(() => {
    if (selectedCategory && !initialData) {
      const firstType = CONDITION_TYPES[selectedCategory][0].value;
      setConditionType(firstType);

      // 타입에 따라 기본값 설정
      if (firstType === 'auto_tag_exists' || firstType === 'auto_tag_has_character') {
        setConditionValue(true);
      } else {
        setConditionValue('');
      }

      setMinScore(0);
      setMaxScore(1);
      setRatingType('general');
    }
  }, [selectedCategory, initialData]);

  // 초기화
  const handleClose = () => {
    setSelectedGroup(null);
    setSelectedCategory(null);
    setConditionType('');
    setConditionValue('');
    setMinScore(0);
    setMaxScore(1);
    setRatingType('general');
    onClose();
  };

  // 그룹 변경
  const handleGroupChange = (_event: React.MouseEvent<HTMLElement>, newGroup: FilterGroupType | null) => {
    if (newGroup !== null) {
      setSelectedGroup(newGroup);
    }
  };

  // 카테고리 변경
  const handleCategoryChange = (_event: React.MouseEvent<HTMLElement>, newCategory: FilterCategory | null) => {
    if (newCategory !== null) {
      setSelectedCategory(newCategory);
    }
  };

  // 조건 타입 변경
  const handleConditionTypeChange = (newType: string) => {
    setConditionType(newType);

    // 타입에 따라 기본값 설정
    if (newType === 'auto_tag_exists' || newType === 'auto_tag_has_character') {
      setConditionValue(true);
    } else if (newType === 'auto_tag_rating_score') {
      setConditionValue(true);
    } else {
      setConditionValue('');
    }
  };

  // 필터 추가
  const handleAdd = () => {
    if (!selectedGroup || !selectedCategory || !conditionType) return;

    const condition: FilterCondition = {
      category: selectedCategory,
      type: conditionType as any,
      value: conditionValue,
    };

    // 조건별 추가 속성
    if (conditionType === 'auto_tag_rating') {
      condition.rating_type = ratingType;
      condition.min_score = minScore;
      condition.max_score = maxScore;
    } else if (
      conditionType === 'auto_tag_general' ||
      conditionType === 'auto_tag_character' ||
      conditionType === 'auto_tag_rating_score'
    ) {
      condition.min_score = minScore;
      condition.max_score = maxScore;
    }

    onAdd(selectedGroup, condition);
    handleClose();
  };

  // 추가 가능 여부
  const canAdd = () => {
    if (!selectedGroup || !selectedCategory || !conditionType) return false;

    // Boolean 타입은 항상 가능
    if (conditionType === 'auto_tag_exists' || conditionType === 'auto_tag_has_character') {
      return true;
    }

    // Rating score는 항상 가능
    if (conditionType === 'auto_tag_rating_score') {
      return true;
    }

    // Rating 타입은 항상 가능
    if (conditionType === 'auto_tag_rating') {
      return true;
    }

    // 그 외는 값이 있어야 함
    if (typeof conditionValue === 'string') {
      return conditionValue.trim().length > 0;
    }

    return false;
  };

  // 동적 입력 필드 렌더링
  const renderConditionFields = () => {
    if (!selectedCategory) return null;

    return (
      <Box>
        {/* 조건 타입 선택 */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>조건 타입</InputLabel>
          <Select value={conditionType} label="조건 타입" onChange={(e) => handleConditionTypeChange(e.target.value)}>
            {CONDITION_TYPES[selectedCategory].map((type) => (
              <MenuItem key={type.value} value={type.value}>
                {type.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* 조건별 입력 필드 */}
        {(conditionType === 'auto_tag_exists' || conditionType === 'auto_tag_has_character') && (
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(conditionValue)}
                onChange={(e) => setConditionValue(e.target.checked)}
              />
            }
            label={conditionValue ? '있음' : '없음'}
          />
        )}

        {conditionType === 'auto_tag_rating' && (
          <>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Rating 타입</InputLabel>
              <Select
                value={ratingType}
                label="Rating 타입"
                onChange={(e) => setRatingType(e.target.value as any)}
              >
                <MenuItem value="general">General</MenuItem>
                <MenuItem value="sensitive">Sensitive</MenuItem>
                <MenuItem value="questionable">Questionable</MenuItem>
                <MenuItem value="explicit">Explicit</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="body2" gutterBottom>
                점수 범위: {minScore.toFixed(2)} ~ {maxScore.toFixed(2)}
              </Typography>
              <Slider
                value={[minScore, maxScore]}
                onChange={(_, newValue) => {
                  const [min, max] = newValue as [number, number];
                  setMinScore(min);
                  setMaxScore(max);
                }}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                marks
              />
            </Box>
          </>
        )}

        {(conditionType === 'auto_tag_general' || conditionType === 'auto_tag_character') && (
          <>
            <TextField
              fullWidth
              label="태그/캐릭터명"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              placeholder="예: 1girl, hatsune_miku"
              sx={{ mb: 2 }}
            />
            <Box>
              <Typography variant="body2" gutterBottom>
                가중치 범위: {minScore.toFixed(2)} ~ {maxScore.toFixed(2)}
              </Typography>
              <Slider
                value={[minScore, maxScore]}
                onChange={(_, newValue) => {
                  const [min, max] = newValue as [number, number];
                  setMinScore(min);
                  setMaxScore(max);
                }}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                marks
              />
            </Box>
          </>
        )}

        {conditionType === 'auto_tag_rating_score' && (
          <Box>
            <Typography variant="body2" gutterBottom>
              점수 범위: {minScore.toFixed(2)} ~ {maxScore.toFixed(2)}
            </Typography>
            <Slider
              value={[minScore, maxScore]}
              onChange={(_, newValue) => {
                const [min, max] = newValue as [number, number];
                setMinScore(min);
                setMaxScore(max);
              }}
              min={0}
              max={1}
              step={0.05}
              valueLabelDisplay="auto"
              marks
            />
          </Box>
        )}

        {conditionType !== 'auto_tag_exists' &&
          conditionType !== 'auto_tag_has_character' &&
          conditionType !== 'auto_tag_rating' &&
          conditionType !== 'auto_tag_general' &&
          conditionType !== 'auto_tag_character' &&
          conditionType !== 'auto_tag_rating_score' && (
            <TextField
              fullWidth
              label="값"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              placeholder="검색할 값을 입력하세요"
            />
          )}
      </Box>
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        <Typography variant="h6" fontWeight={600}>
          {initialData ? '필터 편집' : '필터 추가'}
        </Typography>
      </DialogTitle>

      <DialogContent>
        {/* 그룹 선택 */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom fontWeight={500}>
            그룹 선택
          </Typography>
          <ToggleButtonGroup
            value={selectedGroup}
            exclusive
            onChange={handleGroupChange}
            fullWidth
            sx={{ mt: 1 }}
          >
            <ToggleButton value="exclude" sx={GROUP_STYLES.exclude}>
              <BlockIcon sx={{ mr: 0.5, fontSize: '1.2rem' }} />
              제외
            </ToggleButton>
            <ToggleButton value="or" sx={GROUP_STYLES.or}>
              <OrIcon sx={{ mr: 0.5, fontSize: '1.2rem' }} />
              OR
            </ToggleButton>
            <ToggleButton value="and" sx={GROUP_STYLES.and}>
              <AndIcon sx={{ mr: 0.5, fontSize: '1.2rem' }} />
              AND
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* 카테고리 선택 */}
        {selectedGroup && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom fontWeight={500}>
              카테고리
            </Typography>
            <Grid container spacing={1} sx={{ mt: 1 }}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <ToggleButton
                  value="positive_prompt"
                  selected={selectedCategory === 'positive_prompt'}
                  onChange={handleCategoryChange}
                  fullWidth
                  sx={{ py: 1.5 }}
                >
                  긍정
                </ToggleButton>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <ToggleButton
                  value="negative_prompt"
                  selected={selectedCategory === 'negative_prompt'}
                  onChange={handleCategoryChange}
                  fullWidth
                  sx={{ py: 1.5 }}
                >
                  부정
                </ToggleButton>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <ToggleButton
                  value="auto_tag"
                  selected={selectedCategory === 'auto_tag'}
                  onChange={handleCategoryChange}
                  fullWidth
                  sx={{ py: 1.5 }}
                >
                  자동태그
                </ToggleButton>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <ToggleButton
                  value="basic"
                  selected={selectedCategory === 'basic'}
                  onChange={handleCategoryChange}
                  fullWidth
                  sx={{ py: 1.5 }}
                >
                  기본
                </ToggleButton>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* 구분선 */}
        {selectedCategory && (
          <>
            <Divider sx={{ my: 3 }} />

            {/* 조건 설정 */}
            <Box>
              <Typography variant="subtitle2" gutterBottom fontWeight={500} sx={{ mb: 2 }}>
                조건 설정
              </Typography>
              {renderConditionFields()}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>취소</Button>
        <Button variant="contained" onClick={handleAdd} disabled={!canAdd()}>
          {initialData ? '수정' : '추가'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilterBlockModal;
