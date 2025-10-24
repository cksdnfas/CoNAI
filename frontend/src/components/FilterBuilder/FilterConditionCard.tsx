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
  Chip,
  Switch,
  FormControlLabel,
  Button,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { FilterCondition, FilterCategory } from '@comfyui-image-manager/shared';

interface FilterConditionCardProps {
  condition: FilterCondition;
  index: number;
  groupColor: string;
  onUpdate: (condition: FilterCondition) => void;
  onRemove: () => void;
}

// 카테고리별 타입 매핑
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
    { value: 'auto_tag_exists', label: '오토태그 존재' },
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

const CATEGORY_LABELS: Record<FilterCategory, string> = {
  positive_prompt: '긍정 프롬프트',
  negative_prompt: '네거티브 프롬프트',
  auto_tag: '오토태그',
  basic: '기본',
};

const FilterConditionCard: React.FC<FilterConditionCardProps> = ({
  condition,
  index,
  groupColor,
  onUpdate,
  onRemove,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingCondition, setEditingCondition] = useState<FilterCondition>(condition);

  const handleCategoryChange = (newCategory: FilterCategory) => {
    // 카테고리 변경 시 타입 초기화
    const firstType = CONDITION_TYPES[newCategory][0].value;
    setEditingCondition({
      ...editingCondition,
      category: newCategory,
      type: firstType as any,
      value: '',
    });
  };

  const handleTypeChange = (newType: string) => {
    setEditingCondition({
      ...editingCondition,
      type: newType as any,
    });
  };

  const handleSave = () => {
    onUpdate(editingCondition);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditingCondition(condition);
    setIsEditing(false);
  };

  // 조건 요약 텍스트 생성
  const getSummaryText = () => {
    const category = CATEGORY_LABELS[condition.category];
    const typeObj = CONDITION_TYPES[condition.category].find((t) => t.value === condition.type);
    const type = typeObj?.label || condition.type;

    let value = String(condition.value);
    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      value = `${condition.rating_type} (${condition.min_score || 0} ~ ${condition.max_score || 1})`;
    } else if (condition.min_score !== undefined || condition.max_score !== undefined) {
      value = `${value} (${condition.min_score || 0} ~ ${condition.max_score || 1})`;
    }

    return `${category} > ${type}: ${value}`;
  };

  if (!isEditing) {
    // 읽기 모드
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
                조건 #{index + 1}
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

  // 편집 모드
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
          {/* 헤더 */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              조건 #{index + 1} 편집
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

          {/* 카테고리 선택 */}
          <FormControl fullWidth size="small">
            <InputLabel>분류</InputLabel>
            <Select
              value={editingCondition.category}
              label="분류"
              onChange={(e) => handleCategoryChange(e.target.value as FilterCategory)}
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <MenuItem key={key} value={key}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 타입 선택 */}
          <FormControl fullWidth size="small">
            <InputLabel>조건 타입</InputLabel>
            <Select
              value={editingCondition.type}
              label="조건 타입"
              onChange={(e) => handleTypeChange(e.target.value)}
            >
              {CONDITION_TYPES[editingCondition.category].map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 값 입력 (조건 타입에 따라 다름) */}
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
              label={editingCondition.value ? '있음' : '없음'}
            />
          )}

          {editingCondition.type === 'auto_tag_rating' && (
            <>
              <FormControl fullWidth size="small">
                <InputLabel>Rating 타입</InputLabel>
                <Select
                  value={editingCondition.rating_type || 'general'}
                  label="Rating 타입"
                  onChange={(e) =>
                    setEditingCondition({ ...editingCondition, rating_type: e.target.value as any })
                  }
                >
                  <MenuItem value="general">General</MenuItem>
                  <MenuItem value="sensitive">Sensitive</MenuItem>
                  <MenuItem value="questionable">Questionable</MenuItem>
                  <MenuItem value="explicit">Explicit</MenuItem>
                </Select>
              </FormControl>
              <Box>
                <Typography variant="caption" gutterBottom>
                  점수 범위: {editingCondition.min_score || 0} ~ {editingCondition.max_score || 1}
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
                label="태그/캐릭터명"
                value={editingCondition.value}
                onChange={(e) =>
                  setEditingCondition({ ...editingCondition, value: e.target.value })
                }
              />
              <Box>
                <Typography variant="caption" gutterBottom>
                  가중치 범위: {editingCondition.min_score || 0} ~ {editingCondition.max_score || 1}
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
                label="값"
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
