import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Slider,
  Typography,
  Stack,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, FilterCategory } from '@comfyui-image-manager/shared';

interface FilterConditionCardProps {
  condition: FilterCondition;
  index: number;
  groupColor: string;
  onUpdate: (condition: FilterCondition) => void;
  onRemove: () => void;
}

// Condition types mapping by category (values only - labels from i18n)
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

// Get default value for condition type
const getDefaultValueForType = (type: string): Omit<FilterCondition, 'category' | 'type'> => {
  switch (type) {
    case 'auto_tag_exists':
    case 'auto_tag_has_character':
      return { value: true };

    case 'auto_tag_general':
    case 'auto_tag_character':
      return { value: '', min_score: 0, max_score: 1 };

    case 'auto_tag_rating':
      return { value: true, rating_type: 'general' as const, min_score: 0, max_score: 1 };

    case 'auto_tag_rating_score':
      return { value: true, min_score: 0, max_score: 1 };

    case 'prompt_contains':
    case 'prompt_regex':
    case 'negative_prompt_contains':
    case 'negative_prompt_regex':
    case 'ai_tool':
    case 'model_name':
    case 'auto_tag_model':
      return { value: '' };

    default:
      return { value: '' };
  }
};

const FilterConditionCard: React.FC<FilterConditionCardProps> = ({
  condition,
  index,
  groupColor,
  onUpdate,
  onRemove,
}) => {
  const { t } = useTranslation('common');
  const [isEditing, setIsEditing] = useState(false);
  const [editingCondition, setEditingCondition] = useState<FilterCondition>(condition);

  const handleCategoryChange = (newCategory: FilterCategory) => {
    // Reset type and set appropriate default values when category changes
    const firstType = CONDITION_TYPE_VALUES[newCategory][0];
    const newCondition: FilterCondition = {
      category: newCategory,
      type: firstType as any,
      ...getDefaultValueForType(firstType),
    };
    setEditingCondition(newCondition);
  };

  const handleTypeChange = (newType: string) => {
    // 타입 변경 시 적절한 기본값 설정
    const newCondition: FilterCondition = {
      category: editingCondition.category,
      type: newType as any,
      ...getDefaultValueForType(newType),
    };
    setEditingCondition(newCondition);
  };

  const handleSave = () => {
    onUpdate(editingCondition);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditingCondition(condition);
    setIsEditing(false);
  };

  // Generate condition summary text
  const getSummaryText = () => {
    const category = t(`filterBuilder.categories.${condition.category}`);
    const type = t(`filterBuilder.conditionTypes.${condition.type}`);

    let value = String(condition.value);
    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      const ratingType = t(`filterBuilder.ratingTypes.${condition.rating_type}`);
      value = `${ratingType} (${condition.min_score || 0} ~ ${condition.max_score || 1})`;
    } else if (condition.min_score !== undefined || condition.max_score !== undefined) {
      value = `${value} (${condition.min_score || 0} ~ ${condition.max_score || 1})`;
    }

    return `${category} > ${type}: ${value}`;
  };

  if (!isEditing) {
    // Read-only mode
    return (
      <Card
        variant="outlined"
        sx={{
          borderLeft: `3px solid ${groupColor}`,
          '&:hover': { boxShadow: 2 },
        }}
      >
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t('filterBuilder.labels.conditionNumber', { number: index + 1 })}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {getSummaryText()}
              </Typography>
            </Box>
            <Box>
              <IconButton size="small" onClick={() => setIsEditing(true)} color="primary">
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={onRemove} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </CardContent>
      </Card>
    );
  }

  // Edit mode
  return (
    <Card
      variant="outlined"
      sx={{
        borderLeft: `3px solid ${groupColor}`,
        backgroundColor: (theme) =>
          theme.palette.mode === 'dark' ? 'background.default' : 'grey.100',
      }}
    >
      <CardContent>
        <Stack spacing={2}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {t('filterBuilder.labels.editCondition', { number: index + 1 })}
            </Typography>
            <Box>
              <IconButton size="small" onClick={handleSave} color="success">
                <CheckIcon />
              </IconButton>
              <IconButton size="small" onClick={handleCancel} color="default">
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* Category selection */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('filterBuilder.labels.category')}</InputLabel>
            <Select
              value={editingCondition.category}
              label={t('filterBuilder.labels.category')}
              onChange={(e) => handleCategoryChange(e.target.value as FilterCategory)}
            >
              {Object.keys(CONDITION_TYPE_VALUES).map((key) => (
                <MenuItem key={key} value={key}>
                  {t(`filterBuilder.categories.${key}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Type selection */}
          <FormControl fullWidth size="small">
            <InputLabel>{t('filterBuilder.labels.conditionType')}</InputLabel>
            <Select
              value={editingCondition.type}
              label={t('filterBuilder.labels.conditionType')}
              onChange={(e) => handleTypeChange(e.target.value)}
            >
              {CONDITION_TYPE_VALUES[editingCondition.category].map((typeValue) => (
                <MenuItem key={typeValue} value={typeValue}>
                  {t(`filterBuilder.conditionTypes.${typeValue}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Value input (varies by condition type) */}
          {(editingCondition.type === 'auto_tag_exists' ||
            editingCondition.type === 'auto_tag_has_character') && (
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(editingCondition.value)}
                  onChange={(e) =>
                    setEditingCondition({ ...editingCondition, value: e.target.checked })
                  }
                />
              }
              label={
                editingCondition.value
                  ? t('filterBuilder.values.exists')
                  : t('filterBuilder.values.notExists')
              }
            />
          )}

          {editingCondition.type === 'auto_tag_rating' && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>{t('filterBuilder.labels.ratingType')}</InputLabel>
                <Select
                  value={editingCondition.rating_type || 'general'}
                  label={t('filterBuilder.labels.ratingType')}
                  onChange={(e) =>
                    setEditingCondition({ ...editingCondition, rating_type: e.target.value as any })
                  }
                >
                  <MenuItem value="general">
                    {t('filterBuilder.ratingTypes.general')}
                  </MenuItem>
                  <MenuItem value="sensitive">
                    {t('filterBuilder.ratingTypes.sensitive')}
                  </MenuItem>
                  <MenuItem value="questionable">
                    {t('filterBuilder.ratingTypes.questionable')}
                  </MenuItem>
                  <MenuItem value="explicit">
                    {t('filterBuilder.ratingTypes.explicit')}
                  </MenuItem>
                </Select>
              </FormControl>
              <Box>
                <Typography variant="caption" gutterBottom>
                  {t('filterBuilder.labels.scoreRange', {
                    min: editingCondition.min_score || 0,
                    max: editingCondition.max_score || 1,
                  })}
                </Typography>
                <Slider
                  value={[editingCondition.min_score || 0, editingCondition.max_score || 1]}
                  onChange={(_, newValue) => {
                    const [min, max] = newValue as [number, number];
                    setEditingCondition({
                      ...editingCondition,
                      min_score: min,
                      max_score: max,
                    });
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

          {(editingCondition.type === 'auto_tag_general' ||
            editingCondition.type === 'auto_tag_character') && (
            <>
              <TextField
                fullWidth
                size="small"
                label={t('filterBuilder.labels.tagCharacterName')}
                value={editingCondition.value}
                onChange={(e) =>
                  setEditingCondition({ ...editingCondition, value: e.target.value })
                }
              />
              <Box>
                <Typography variant="caption" gutterBottom>
                  {t('filterBuilder.labels.weightRange', {
                    min: editingCondition.min_score || 0,
                    max: editingCondition.max_score || 1,
                  })}
                </Typography>
                <Slider
                  value={[editingCondition.min_score || 0, editingCondition.max_score || 1]}
                  onChange={(_, newValue) => {
                    const [min, max] = newValue as [number, number];
                    setEditingCondition({
                      ...editingCondition,
                      min_score: min,
                      max_score: max,
                    });
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

          {editingCondition.type !== 'auto_tag_exists' &&
            editingCondition.type !== 'auto_tag_has_character' &&
            editingCondition.type !== 'auto_tag_rating' &&
            editingCondition.type !== 'auto_tag_general' &&
            editingCondition.type !== 'auto_tag_character' && (
              <TextField
                fullWidth
                size="small"
                label={t('filterBuilder.labels.value')}
                value={editingCondition.value}
                onChange={(e) =>
                  setEditingCondition({ ...editingCondition, value: e.target.value })
                }
              />
            )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default FilterConditionCard;
