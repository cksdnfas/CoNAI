import React from 'react';
import {
  Box,
  Card,
  CardContent,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  Chip,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { AutoCollectCondition } from '@comfyui-image-manager/shared';
import ConditionValueInput from './ConditionValueInput';

interface ConditionCardProps {
  condition: AutoCollectCondition;
  index: number;
  onUpdate: <K extends keyof AutoCollectCondition>(
    field: K,
    value: AutoCollectCondition[K]
  ) => void;
  onRemove: () => void;
}

interface ConditionType {
  value: string;
  label: string;
  group: string;
}

const CONDITION_TYPES: ConditionType[] = [
  // 기본 조건
  { value: 'ai_tool', label: 'aiTool', group: 'basic' },
  { value: 'model_name', label: 'modelName', group: 'basic' },

  // 프롬프트 조건
  { value: 'prompt_contains', label: 'promptContains', group: 'prompt' },
  { value: 'prompt_regex', label: 'promptRegex', group: 'prompt' },
  { value: 'negative_prompt_contains', label: 'negativePromptContains', group: 'prompt' },
  { value: 'negative_prompt_regex', label: 'negativePromptRegex', group: 'prompt' },

  // Auto Tag 조건
  { value: 'auto_tag_exists', label: 'autoTagExists', group: 'autotag' },
  { value: 'auto_tag_rating', label: 'autoTagRating', group: 'autotag' },
  { value: 'auto_tag_rating_score', label: 'autoTagRatingScore', group: 'autotag' },
  { value: 'auto_tag_general', label: 'autoTagGeneral', group: 'autotag' },
  { value: 'auto_tag_character', label: 'autoTagCharacter', group: 'autotag' },
  { value: 'auto_tag_has_character', label: 'autoTagHasCharacter', group: 'autotag' },
  { value: 'auto_tag_model', label: 'autoTagModel', group: 'autotag' },

  // 중복 이미지 검색 조건
  { value: 'duplicate_exact', label: 'duplicateExact', group: 'duplicate' },
  // { value: 'duplicate_near', label: 'duplicateNear', group: 'duplicate' },
  // { value: 'duplicate_similar', label: 'duplicateSimilar', group: 'duplicate' },
  // { value: 'duplicate_custom', label: 'duplicateCustom', group: 'duplicate' },
];

// 조건 그룹별 색상
const getGroupColor = (group: string): string => {
  switch (group) {
    case 'basic':
      return '#2196f3';
    case 'prompt':
      return '#4caf50';
    case 'autotag':
      return '#ff9800';
    case 'duplicate':
      return '#9c27b0';
    default:
      return '#757575';
  }
};

const ConditionCard: React.FC<ConditionCardProps> = ({
  condition,
  index,
  onUpdate,
  onRemove,
}) => {
  const { t } = useTranslation(['imageGroups']);

  const currentType = CONDITION_TYPES.find((type) => type.value === condition.type);
  const groupColor = currentType ? getGroupColor(currentType.group) : '#757575';

  const handleTypeChange = (newType: string) => {
    onUpdate('type', newType as AutoCollectCondition['type']);

    // 타입 변경시 필드 초기화
    const typeObj = CONDITION_TYPES.find((t) => t.value === newType);
    if (!typeObj) return;

    // Boolean 타입
    if (newType === 'auto_tag_exists' || newType === 'auto_tag_has_character') {
      onUpdate('value', true);
    }
    // Rating 조건
    else if (newType === 'auto_tag_rating') {
      onUpdate('value', '');
      onUpdate('rating_type', 'general');
    }
    // Rating Score 조건
    else if (newType === 'auto_tag_rating_score') {
      onUpdate('value', '');
      onUpdate('min_score', 0);
      onUpdate('max_score', 200);
    }
    // Score 조건
    else if (newType === 'auto_tag_general' || newType === 'auto_tag_character') {
      onUpdate('value', '');
    }
    // 중복 이미지 조건
    else if (newType.startsWith('duplicate_')) {
      onUpdate('value', ''); // value는 사용하지 않지만 필수이므로 빈 문자열 설정
      if (newType === 'duplicate_custom') {
        onUpdate('hamming_threshold', 10); // 기본값 10
      }
    }
    // String 조건
    else {
      onUpdate('value', '');
    }
  };

  // 조건 타입을 그룹별로 분류
  const groupedTypes = CONDITION_TYPES.reduce((acc, type) => {
    if (!acc[type.group]) {
      acc[type.group] = [];
    }
    acc[type.group].push(type);
    return acc;
  }, {} as Record<string, ConditionType[]>);

  return (
    <Card
      sx={{
        mb: 2,
        borderLeft: `4px solid ${groupColor}`,
        '&:hover': {
          boxShadow: 3,
        },
      }}
    >
      <CardContent>
        {/* 헤더: 조건 번호, 그룹 표시, 삭제 버튼 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('imageGroups:conditions.conditionNumber', { number: index + 1 })}
            </Typography>
            {currentType && (
              <Chip
                label={t(`imageGroups:conditions.groups.${currentType.group}`)}
                size="small"
                sx={{
                  backgroundColor: groupColor,
                  color: 'white',
                  fontWeight: 500,
                }}
              />
            )}
          </Box>
          <IconButton
            onClick={onRemove}
            color="error"
            size="small"
            aria-label={t('imageGroups:conditions.removeCondition')}
          >
            <DeleteIcon />
          </IconButton>
        </Box>

        {/* 조건 타입 선택 */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('imageGroups:modal.conditionType')}</InputLabel>
          <Select
            value={condition.type}
            label={t('imageGroups:modal.conditionType')}
            onChange={(e) => handleTypeChange(e.target.value)}
          >
            {Object.entries(groupedTypes).map(([group, types]) => [
              <MenuItem key={`header-${group}`} disabled sx={{ fontWeight: 'bold', opacity: 1 }}>
                {t(`imageGroups:conditions.groups.${group}`)}
              </MenuItem>,
              ...types.map((type) => (
                <MenuItem key={type.value} value={type.value} sx={{ pl: 4 }}>
                  {t(`imageGroups:conditions.types.${type.label}`)}
                </MenuItem>
              )),
            ])}
          </Select>
        </FormControl>

        {/* 조건 값 입력 */}
        <ConditionValueInput
          condition={condition}
          onUpdate={onUpdate}
        />
      </CardContent>
    </Card>
  );
};

export default ConditionCard;
