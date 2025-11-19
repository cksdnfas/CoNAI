import React, { useState } from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { HelpOutline as HelpOutlineIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ComplexFilter, FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';
import AdvancedSearchTab from '../../../components/SearchBar/AdvancedSearchTab';
import type { FilterBlockData } from '../../../components/FilterBuilder/FilterBlockList';

interface AutoCollectTabProps {
  enabled: boolean;
  conditions: ComplexFilter;
  onEnabledChange: (enabled: boolean) => void;
  onConditionsChange: (conditions: ComplexFilter) => void;
}

const AutoCollectTab: React.FC<AutoCollectTabProps> = ({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}) => {
  const { t } = useTranslation(['imageGroups']);

  // State for ComplexFilter - Unified filter blocks
  const [filterBlocks, setFilterBlocks] = useState<FilterBlockData[]>(() => {
    const blocks: FilterBlockData[] = [];
    let idCounter = 0;

    if (conditions.exclude_group) {
      conditions.exclude_group.forEach((cond) => {
        blocks.push({
          id: `exclude-${idCounter++}`,
          groupType: 'exclude',
          condition: cond,
        });
      });
    }

    if (conditions.or_group) {
      conditions.or_group.forEach((cond) => {
        blocks.push({
          id: `or-${idCounter++}`,
          groupType: 'or',
          condition: cond,
        });
      });
    }

    if (conditions.and_group) {
      conditions.and_group.forEach((cond) => {
        blocks.push({
          id: `and-${idCounter++}`,
          groupType: 'and',
          condition: cond,
        });
      });
    }

    return blocks;
  });

  // Update parent when filter blocks change
  React.useEffect(() => {
    const excludeConditions = filterBlocks
      .filter((block) => block.groupType === 'exclude')
      .map((block) => block.condition);

    const orConditions = filterBlocks
      .filter((block) => block.groupType === 'or')
      .map((block) => block.condition);

    const andConditions = filterBlocks
      .filter((block) => block.groupType === 'and')
      .map((block) => block.condition);

    const complexFilter: ComplexFilter = {
      exclude_group: excludeConditions.length > 0 ? excludeConditions : undefined,
      or_group: orConditions.length > 0 ? orConditions : undefined,
      and_group: andConditions.length > 0 ? andConditions : undefined,
    };
    onConditionsChange(complexFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBlocks]);

  // Filter block handlers
  const handleAddBlock = (groupType: FilterGroupType, condition: FilterCondition) => {
    const newBlock: FilterBlockData = {
      id: `${groupType}-${Date.now()}-${Math.random()}`,
      groupType,
      condition,
    };
    setFilterBlocks([...filterBlocks, newBlock]);
  };

  const handleEditBlock = (id: string, groupType: FilterGroupType, condition: FilterCondition) => {
    setFilterBlocks(
      filterBlocks.map((block) =>
        block.id === id ? { ...block, groupType, condition } : block
      )
    );
  };

  const handleRemoveBlock = (id: string) => {
    setFilterBlocks(filterBlocks.filter((block) => block.id !== id));
  };

  const handleHelpClick = () => {
    window.open('/help?page=filters#/help', '_blank');
  };

  // enabled 체크 전에 filterCount 계산
  const filterCount = enabled
    ? (conditions.exclude_group?.length || 0) +
      (conditions.or_group?.length || 0) +
      (conditions.and_group?.length || 0)
    : 0;

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

      {/* 복합 필터 UI */}
      {enabled && (
        <Box>
          {/* 필터 정보와 도움말 링크 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 2,
              p: 1.5,
              backgroundColor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgb(7, 19, 24)' : 'rgb(229, 246, 253)',
              borderRadius: 1,
              border: '1px solid',
              borderColor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgb(1, 67, 97)' : 'rgb(1, 67, 97)',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {filterCount > 0
                ? t('imageGroups:modal.filterApplied', { count: filterCount })
                : t('imageGroups:modal.addFiltersPrompt')}
            </Typography>
            <Tooltip title={t('imageGroups:modal.filterHelpTooltip')} arrow>
              <IconButton onClick={handleHelpClick} size="small" color="primary">
                <HelpOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <AdvancedSearchTab
            filterBlocks={filterBlocks}
            onAddBlock={handleAddBlock}
            onRemoveBlock={handleRemoveBlock}
            onEditBlock={handleEditBlock}
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
            {t('imageGroups:modal.autoCollectDisabledHelp')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default AutoCollectTab;
