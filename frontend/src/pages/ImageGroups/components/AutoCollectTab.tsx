import React, { useState } from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  Typography,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AutoCollectCondition, ComplexFilter, FilterCondition } from '@comfyui-image-manager/shared';
import AdvancedSearchTab from '../../../components/SearchBar/AdvancedSearchTab';

interface AutoCollectTabProps {
  enabled: boolean;
  conditions: AutoCollectCondition[] | ComplexFilter;
  onEnabledChange: (enabled: boolean) => void;
  onConditionsChange: (conditions: AutoCollectCondition[] | ComplexFilter) => void;
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}) => {
  const { t } = useTranslation(['imageGroups']);

  // Determine if conditions are in ComplexFilter format
  const isComplexFilter = conditions && typeof conditions === 'object' && !Array.isArray(conditions);

  // Mode: 'simple' (legacy OR) or 'advanced' (ComplexFilter)
  const [mode, setMode] = useState<'simple' | 'advanced'>(
    isComplexFilter ? 'advanced' : 'simple'
  );

  // State for ComplexFilter (advanced mode)
  const [excludeConditions, setExcludeConditions] = useState<FilterCondition[]>(
    isComplexFilter && conditions.exclude_group ? conditions.exclude_group : []
  );
  const [orConditions, setOrConditions] = useState<FilterCondition[]>(
    isComplexFilter && conditions.or_group ? conditions.or_group : []
  );
  const [andConditions, setAndConditions] = useState<FilterCondition[]>(
    isComplexFilter && conditions.and_group ? conditions.and_group : []
  );

  // Handle mode change
  const handleModeChange = (_event: React.MouseEvent<HTMLElement>, newMode: 'simple' | 'advanced' | null) => {
    if (newMode !== null) {
      setMode(newMode);

      // Convert between formats
      if (newMode === 'advanced' && Array.isArray(conditions)) {
        // Convert legacy to ComplexFilter (migrate to OR group)
        const convertedConditions = conditions.map((cond: AutoCollectCondition): FilterCondition => ({
          category: cond.type.includes('prompt') ? 'positive_prompt' :
                    cond.type.includes('negative') ? 'negative_prompt' :
                    cond.type.startsWith('auto_tag') ? 'auto_tag' : 'basic',
          type: cond.type as any,
          value: cond.value,
          case_sensitive: cond.case_sensitive,
          exact_match: cond.exact_match,
          min_score: cond.min_score,
          max_score: cond.max_score,
          rating_type: cond.rating_type,
          hamming_threshold: cond.hamming_threshold,
        }));

        setOrConditions(convertedConditions);
        setExcludeConditions([]);
        setAndConditions([]);
      }
    }
  };

  // Update parent when conditions change
  React.useEffect(() => {
    if (mode === 'advanced') {
      const complexFilter: ComplexFilter = {
        exclude_group: excludeConditions.length > 0 ? excludeConditions : undefined,
        or_group: orConditions.length > 0 ? orConditions : undefined,
        and_group: andConditions.length > 0 ? andConditions : undefined,
      };
      onConditionsChange(complexFilter);
    }
  }, [excludeConditions, orConditions, andConditions, mode, onConditionsChange]);

  // Default empty condition
  const createEmptyCondition = (): FilterCondition => ({
    category: 'auto_tag',
    type: 'auto_tag_general',
    value: '',
  });

  // Exclude group handlers
  const handleAddExcludeCondition = () => {
    setExcludeConditions([...excludeConditions, createEmptyCondition()]);
  };

  const handleUpdateExcludeCondition = (index: number, condition: FilterCondition) => {
    const updated = [...excludeConditions];
    updated[index] = condition;
    setExcludeConditions(updated);
  };

  const handleRemoveExcludeCondition = (index: number) => {
    setExcludeConditions(excludeConditions.filter((_, i) => i !== index));
  };

  // OR group handlers
  const handleAddOrCondition = () => {
    setOrConditions([...orConditions, createEmptyCondition()]);
  };

  const handleUpdateOrCondition = (index: number, condition: FilterCondition) => {
    const updated = [...orConditions];
    updated[index] = condition;
    setOrConditions(updated);
  };

  const handleRemoveOrCondition = (index: number) => {
    setOrConditions(orConditions.filter((_, i) => i !== index));
  };

  // AND group handlers
  const handleAddAndCondition = () => {
    setAndConditions([...andConditions, createEmptyCondition()]);
  };

  const handleUpdateAndCondition = (index: number, condition: FilterCondition) => {
    const updated = [...andConditions];
    updated[index] = condition;
    setAndConditions(updated);
  };

  const handleRemoveAndCondition = (index: number) => {
    setAndConditions(andConditions.filter((_, i) => i !== index));
  };

  return (
    <Box>
      {/* 자동수집 활성화 토글 */}
      <Box sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              color="primary"
            />
          }
          label={
            <Typography variant="subtitle1" fontWeight={500}>
              {t('imageGroups:modal.autoCollectEnable')}
            </Typography>
          }
        />

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 4 }}>
          {t('imageGroups:modal.autoCollectDescription')}
        </Typography>
      </Box>

      {/* Mode Selector */}
      {enabled && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            조건 모드
          </Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={handleModeChange}
            aria-label="condition mode"
            size="small"
          >
            <ToggleButton value="simple" disabled>
              간단 모드 (Legacy)
            </ToggleButton>
            <ToggleButton value="advanced">
              고급 모드 (ComplexFilter)
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
            고급 모드를 사용하여 Exclude/OR/AND 그룹으로 복잡한 조건을 설정하세요
          </Typography>
        </Box>
      )}

      {/* Advanced Mode: ComplexFilter UI */}
      {enabled && mode === 'advanced' && (
        <Box>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight={500} gutterBottom>
              💡 복합 필터 자동수집
            </Typography>
            <Typography variant="caption" component="div">
              <strong>실행 순서</strong>: 제외(NOT) → OR → AND
            </Typography>
            <Typography variant="caption" component="div" sx={{ mt: 1 }}>
              <strong>예시</strong>: "nsfw 제외, 1girl OR 2girls, 캐릭터 있음"
            </Typography>
          </Alert>

          <AdvancedSearchTab
            excludeConditions={excludeConditions}
            orConditions={orConditions}
            andConditions={andConditions}
            onAddExcludeCondition={handleAddExcludeCondition}
            onUpdateExcludeCondition={handleUpdateExcludeCondition}
            onRemoveExcludeCondition={handleRemoveExcludeCondition}
            onAddOrCondition={handleAddOrCondition}
            onUpdateOrCondition={handleUpdateOrCondition}
            onRemoveOrCondition={handleRemoveOrCondition}
            onAddAndCondition={handleAddAndCondition}
            onUpdateAndCondition={handleUpdateAndCondition}
            onRemoveAndCondition={handleRemoveAndCondition}
          />
        </Box>
      )}

      {/* 비활성화 상태 안내 */}
      {!enabled && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('imageGroups:conditions.autoCollectDisabled')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AutoCollectTab;
