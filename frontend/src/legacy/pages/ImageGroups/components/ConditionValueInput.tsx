import React from 'react';
import {
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Switch,
  Slider,
  Typography,
  Tooltip,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AutoCollectCondition } from '@comfyui-image-manager/shared';

interface ConditionValueInputProps {
  condition: AutoCollectCondition;
  onUpdate: <K extends keyof AutoCollectCondition>(
    field: K,
    value: AutoCollectCondition[K]
  ) => void;
}

const RATING_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'sensitive', label: 'Sensitive' },
  { value: 'questionable', label: 'Questionable' },
  { value: 'explicit', label: 'Explicit' },
];

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

const ConditionValueInput: React.FC<ConditionValueInputProps> = ({
  condition,
  onUpdate,
}) => {
  const { t } = useTranslation(['imageGroups']);
  const fieldType = getConditionFieldType(condition.type);

  // Boolean 타입 (존재 여부)
  if (fieldType === 'boolean') {
    return (
      <FormControl sx={{ minWidth: 200 }}>
        <InputLabel>{t('imageGroups:conditions.fields.value')}</InputLabel>
        <Select
          value={condition.value === true ? 'true' : 'false'}
          label={t('imageGroups:conditions.fields.value')}
          onChange={(e) => onUpdate('value', e.target.value === 'true')}
        >
          <MenuItem value="true">{t('imageGroups:conditions.values.exists')}</MenuItem>
          <MenuItem value="false">{t('imageGroups:conditions.values.notExists')}</MenuItem>
        </Select>
      </FormControl>
    );
  }

  // Rating 조건
  if (fieldType === 'rating') {
    return (
      <Box sx={{ width: '100%' }}>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('imageGroups:conditions.fields.ratingType')}</InputLabel>
          <Select
            value={condition.rating_type || 'general'}
            label={t('imageGroups:conditions.fields.ratingType')}
            onChange={(e) => onUpdate('rating_type', e.target.value)}
          >
            {RATING_TYPES.map((rating) => (
              <MenuItem key={rating.value} value={rating.value}>
                {t(`imageGroups:conditions.ratings.${rating.value}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* 신뢰도 점수 범위 슬라이더 */}
        <Box sx={{ px: 1 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom component="div">
            {`${t('imageGroups:conditions.fields.confidenceRange', {
              min: (condition.min_score ?? 0).toFixed(2),
              max: (condition.max_score ?? 1).toFixed(2)
            })}`}
          </Typography>
          <Slider
            value={[condition.min_score ?? 0, condition.max_score ?? 1]}
            onChange={(_, newValue) => {
              const [min, max] = newValue as [number, number];
              onUpdate('min_score', min);
              onUpdate('max_score', max);
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
            {t('imageGroups:conditions.fields.confidenceInfo')}
          </Typography>
        </Box>
      </Box>
    );
  }

  // Rating Score 조건 (가중치 기반)
  if (fieldType === 'rating_score') {
    return (
      <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
        <TextField
          label={t('imageGroups:conditions.fields.minScore')}
          type="number"
          value={condition.min_score !== undefined ? condition.min_score : 0}
          onChange={(e) => onUpdate('min_score', Number(e.target.value))}
          fullWidth
          inputProps={{ min: 0, step: 1 }}
          helperText={t('imageGroups:conditions.fields.weightedScore')}
        />
        <TextField
          label={t('imageGroups:conditions.fields.maxScore')}
          type="number"
          value={condition.max_score !== undefined ? condition.max_score : 200}
          onChange={(e) => onUpdate('max_score', Number(e.target.value))}
          fullWidth
          inputProps={{ min: 0, step: 1 }}
          helperText={t('imageGroups:conditions.fields.maxWeightInfo')}
        />
      </Box>
    );
  }

  // Score 타입 (General 태그, 캐릭터)
  if (fieldType === 'score') {
    return (
      <Box sx={{ width: '100%' }}>
        <TextField
          label={
            condition.type === 'auto_tag_character'
              ? t('imageGroups:conditions.fields.characterName')
              : t('imageGroups:conditions.fields.tagName')
          }
          fullWidth
          value={condition.value}
          onChange={(e) => onUpdate('value', e.target.value)}
          placeholder={
            condition.type === 'auto_tag_character'
              ? t('imageGroups:conditions.placeholders.characterName')
              : t('imageGroups:conditions.placeholders.tagName')
          }
          sx={{ mb: 2 }}
        />

        {/* 신뢰도 점수 범위 슬라이더 */}
        <Box sx={{ px: 1 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom component="div">
            {`${t('imageGroups:conditions.fields.confidenceRange', {
              min: (condition.min_score ?? 0).toFixed(2),
              max: (condition.max_score ?? 1).toFixed(2)
            })}`}
          </Typography>
          <Slider
            value={[condition.min_score ?? 0, condition.max_score ?? 1]}
            onChange={(_, newValue) => {
              const [min, max] = newValue as [number, number];
              onUpdate('min_score', min);
              onUpdate('max_score', max);
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
            {t('imageGroups:conditions.fields.confidenceInfo')}
          </Typography>
        </Box>
      </Box>
    );
  }

  // 중복 이미지 조건
  if (fieldType === 'duplicate') {
    // duplicate_custom 타입만 hamming_threshold 입력 표시
    if (condition.type === 'duplicate_custom') {
      return (
        <Box sx={{ width: '100%' }}>
          <TextField
            label={t('imageGroups:conditions.fields.hammingThreshold')}
            type="number"
            fullWidth
            value={condition.hamming_threshold ?? 10}
            onChange={(e) => onUpdate('hamming_threshold', Number(e.target.value))}
            inputProps={{ min: 0, max: 64, step: 1 }}
            helperText={t('imageGroups:conditions.fields.hammingThresholdHelp')}
          />
          <Box sx={{
            mt: 2,
            p: 2,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.08)' : 'info.light',
            borderRadius: 1,
            border: 1,
            borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.3)' : 'info.main'
          }}>
            <Typography variant="caption" color="info.main">
              {t('imageGroups:conditions.fields.hammingInfo')}
            </Typography>
          </Box>
        </Box>
      );
    }

    // exact, near, similar 타입은 설명만 표시
    return (
      <Box sx={{
        width: '100%',
        p: 2,
        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.08)' : 'info.light',
        borderRadius: 1,
        border: 1,
        borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.3)' : 'info.main'
      }}>
        <Typography variant="body2" color="info.main" gutterBottom>
          {t(`imageGroups:conditions.duplicateInfo.${condition.type}`)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('imageGroups:conditions.fields.duplicateNote')}
        </Typography>
      </Box>
    );
  }

  // String 타입 (기본)
  const supportsExactMatch = ['prompt_contains', 'negative_prompt_contains', 'model_name'].includes(condition.type);
  const supportsCaseSensitive = !condition.type.startsWith('auto_tag_') || condition.type === 'auto_tag_model';

  return (
    <Box sx={{ width: '100%' }}>
      {/* 값 입력 필드 */}
      <TextField
        label={t('imageGroups:modal.conditionValue')}
        fullWidth
        value={condition.value}
        onChange={(e) => onUpdate('value', e.target.value)}
        placeholder={
          condition.type.includes('regex')
            ? t('imageGroups:conditions.placeholders.regex')
            : condition.type === 'auto_tag_model'
            ? t('imageGroups:conditions.placeholders.modelName')
            : t('imageGroups:conditions.placeholders.text')
        }
        sx={{ mb: 1 }}
      />

      {/* 대소문자 구분 & 정확히 일치 옵션 (같은 줄에 표시) */}
      {(supportsCaseSensitive || supportsExactMatch) && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', pl: 1 }}>
          {/* 대소문자 구분 */}
          {supportsCaseSensitive && (
            <FormControlLabel
              control={
                <Switch
                  checked={condition.case_sensitive || false}
                  onChange={(e) => onUpdate('case_sensitive', e.target.checked)}
                  size="small"
                />
              }
              label={t('imageGroups:conditions.fields.caseSensitive')}
            />
          )}

          {/* 정확히 일치 */}
          {supportsExactMatch && (
            <Tooltip title={t('imageGroups:conditions.fields.exactMatchHelp')} arrow placement="top">
              <FormControlLabel
                control={
                  <Switch
                    checked={condition.exact_match || false}
                    onChange={(e) => onUpdate('exact_match', e.target.checked)}
                    size="small"
                  />
                }
                label={t('imageGroups:conditions.fields.exactMatch')}
              />
            </Tooltip>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ConditionValueInput;
