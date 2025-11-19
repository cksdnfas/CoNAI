import React from 'react';
import {
  Card,
  CardContent,
  IconButton,
  Typography,
  Box,
  Stack,
  Chip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Edit as EditIcon,
  Block as BlockIcon,
  CallSplit as OrIcon,
  MergeType as AndIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';

interface FilterBlockProps {
  id: string;
  groupType: FilterGroupType;
  condition: FilterCondition;
  onRemove: () => void;
  onEdit: () => void;
}

// Group type configuration (colors and icons only - labels from i18n)
const GROUP_CONFIG = {
  exclude: {
    color: '#f44336',
    icon: BlockIcon,
    bgColor: '#ffebee',
    darkBgColor: '#5d1f1f',
  },
  or: {
    color: '#2196f3',
    icon: OrIcon,
    bgColor: '#e3f2fd',
    darkBgColor: '#1a3a52',
  },
  and: {
    color: '#4caf50',
    icon: AndIcon,
    bgColor: '#e8f5e9',
    darkBgColor: '#1e4620',
  },
};

const FilterBlock: React.FC<FilterBlockProps> = ({
  groupType,
  condition,
  onRemove,
  onEdit,
}) => {
  const { t } = useTranslation('common');
  const config = GROUP_CONFIG[groupType];
  const Icon = config.icon;

  // Get translated labels
  const getGroupLabel = () => t(`filterBuilder.groupTypes.${groupType}.labelShort`);
  const getCategoryLabel = () => t(`filterBuilder.categories.${condition.category}`);
  const getTypeLabel = () => t(`filterBuilder.conditionTypes.${condition.type}`);

  // Generate condition summary text
  const getSummaryText = () => {
    const category = getCategoryLabel();
    const type = getTypeLabel();

    let value = String(condition.value);

    // Handle boolean type
    if (typeof condition.value === 'boolean') {
      value = condition.value ? t('filterBuilder.values.exists') : t('filterBuilder.values.notExists');
    }

    // Special handling for rating type
    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      value = t(`filterBuilder.ratingTypes.${condition.rating_type}`);
    }

    // Display score range
    let scoreRange = '';
    if (condition.min_score !== undefined || condition.max_score !== undefined) {
      const min = condition.min_score ?? 0;
      const max = condition.max_score ?? 1;
      scoreRange = ` (${min.toFixed(2)} ~ ${max.toFixed(2)})`;
    }

    return { category, type, value, scoreRange };
  };

  const { category, type, value, scoreRange } = getSummaryText();

  return (
    <Card
      sx={{
        height: '100%',
        borderLeft: `3px solid ${config.color}`,
        position: 'relative',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          boxShadow: 3,
          transform: 'translateY(-1px)',
        },
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? config.darkBgColor : config.bgColor,
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack spacing={1}>
          {/* Header: Group type + Edit/Delete buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Chip
              icon={<Icon sx={{ fontSize: '0.875rem' }} />}
              label={getGroupLabel()}
              size="small"
              sx={{
                bgcolor: config.color,
                color: 'white',
                fontWeight: 600,
                fontSize: '0.75rem',
                height: '24px',
                '& .MuiChip-icon': {
                  color: 'white',
                },
              }}
            />
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={onEdit}
                sx={{
                  p: 0.5,
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'primary.light',
                    color: 'primary.dark',
                  },
                }}
              >
                <EditIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={onRemove}
                sx={{
                  p: 0.5,
                  color: 'error.main',
                  '&:hover': {
                    bgcolor: 'error.light',
                    color: 'error.dark',
                  },
                }}
              >
                <CloseIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Box>
          </Box>

          {/* 카테고리 */}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 500, textTransform: 'uppercase', fontSize: '0.65rem' }}
          >
            {category}
          </Typography>

          {/* 조건 타입 */}
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.813rem' }}>
            {type}
          </Typography>

          {/* 값 */}
          <Box
            sx={{
              bgcolor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              borderRadius: 1,
              p: 0.75,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                wordBreak: 'break-word',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
              }}
            >
              {value}
            </Typography>
            {scoreRange && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.25, fontSize: '0.65rem' }}
              >
                {t('filterBuilder.labels.score')}: {scoreRange}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default FilterBlock;
