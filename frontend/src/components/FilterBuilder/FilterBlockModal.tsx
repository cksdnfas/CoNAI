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
import { useTranslation } from 'react-i18next';
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

// 카테고리별 조건 타입 (값만 정의, 라벨은 i18n에서 가져옴)
const CONDITION_TYPE_VALUES: Record<FilterCategory, string[]> = {
  positive_prompt: ['prompt_contains', 'prompt_regex'],
  negative_prompt: ['negative_prompt_contains', 'negative_prompt_regex'],
  auto_tag: [
    'auto_tag_exists',
    'auto_tag_has_character',
    'auto_tag_rating',
    'auto_tag_rating_score',
    'auto_tag_general',
    'auto_tag_character',
    'auto_tag_model',
  ],
  basic: ['ai_tool', 'model_name'],
};

const FilterBlockModal: React.FC<FilterBlockModalProps> = ({ open, onClose, onAdd, initialData }) => {
  const { t } = useTranslation('common');

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
      const firstType = CONDITION_TYPE_VALUES[selectedCategory][0];
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
          <InputLabel>{t('filterModal.conditionSettings.conditionType')}</InputLabel>
          <Select
            value={conditionType}
            label={t('filterModal.conditionSettings.conditionType')}
            onChange={(e) => handleConditionTypeChange(e.target.value)}
          >
            {CONDITION_TYPE_VALUES[selectedCategory].map((typeValue) => (
              <MenuItem key={typeValue} value={typeValue}>
                {t(`filterModal.conditionTypes.${typeValue}`)}
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
            label={conditionValue ? t('filterModal.fields.exists') : t('filterModal.fields.notExists')}
          />
        )}

        {conditionType === 'auto_tag_rating' && (
          <>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>{t('filterModal.fields.ratingType')}</InputLabel>
              <Select
                value={ratingType}
                label={t('filterModal.fields.ratingType')}
                onChange={(e) => setRatingType(e.target.value as any)}
              >
                <MenuItem value="general">{t('filterModal.ratingTypes.general')}</MenuItem>
                <MenuItem value="sensitive">{t('filterModal.ratingTypes.sensitive')}</MenuItem>
                <MenuItem value="questionable">{t('filterModal.ratingTypes.questionable')}</MenuItem>
                <MenuItem value="explicit">{t('filterModal.ratingTypes.explicit')}</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="body2" gutterBottom>
                {t('filterModal.fields.scoreRange', { min: minScore.toFixed(2), max: maxScore.toFixed(2) })}
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
              label={t('filterModal.fields.tagOrCharacter')}
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              placeholder={t('filterModal.fields.tagPlaceholder')}
              sx={{ mb: 2 }}
            />
            <Box>
              <Typography variant="body2" gutterBottom>
                {t('filterModal.fields.weightRange', { min: minScore.toFixed(2), max: maxScore.toFixed(2) })}
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
              {t('filterModal.fields.scoreRange', { min: minScore.toFixed(2), max: maxScore.toFixed(2) })}
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
              label={t('filterModal.conditionSettings.value')}
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              placeholder={t('filterModal.conditionSettings.valuePlaceholder')}
            />
          )}
      </Box>
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        <Typography variant="h6" fontWeight={600}>
          {initialData ? t('filterModal.title.edit') : t('filterModal.title.add')}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        {/* 그룹 선택 */}
        <Box>
          <Typography variant="subtitle2" gutterBottom fontWeight={500}>
            {t('filterModal.groupTypes.label')}
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
              {t('filterModal.groupTypes.exclude')}
            </ToggleButton>
            <ToggleButton value="or" sx={GROUP_STYLES.or}>
              <OrIcon sx={{ mr: 0.5, fontSize: '1.2rem' }} />
              {t('filterModal.groupTypes.or')}
            </ToggleButton>
            <ToggleButton value="and" sx={GROUP_STYLES.and}>
              <AndIcon sx={{ mr: 0.5, fontSize: '1.2rem' }} />
              {t('filterModal.groupTypes.and')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* 카테고리 선택 */}
        {selectedGroup && (
          <Box>
            <Typography variant="subtitle2" gutterBottom fontWeight={500}>
              {t('filterModal.categories.label')}
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
                  {t('filterModal.categories.positive_prompt')}
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
                  {t('filterModal.categories.negative_prompt')}
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
                  {t('filterModal.categories.auto_tag')}
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
                  {t('filterModal.categories.basic')}
                </ToggleButton>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* 조건 설정 */}
        {selectedCategory && (
          <>
            <Divider />
            <Box>
              <Typography variant="subtitle2" gutterBottom fontWeight={500}>
                {t('filterModal.conditionSettings.label')}
              </Typography>
              {renderConditionFields()}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>{t('buttons.cancel')}</Button>
        <Button variant="contained" onClick={handleAdd} disabled={!canAdd()}>
          {initialData ? t('buttons.edit') : t('buttons.add')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilterBlockModal;
