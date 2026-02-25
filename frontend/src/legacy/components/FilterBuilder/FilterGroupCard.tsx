import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Block as BlockIcon,
  CallSplit as OrIcon,
  MergeType as AndIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';
import FilterConditionCard from './FilterConditionCard';

interface FilterGroupCardProps {
  type: FilterGroupType;
  conditions: FilterCondition[];
  onAddCondition: () => void;
  onUpdateCondition: (index: number, condition: FilterCondition) => void;
  onRemoveCondition: (index: number) => void;
}

// Group type configuration (colors and icons only - labels and descriptions from i18n)
const GROUP_CONFIG = {
  exclude: {
    color: '#f44336',
    icon: BlockIcon,
  },
  or: {
    color: '#2196f3',
    icon: OrIcon,
  },
  and: {
    color: '#4caf50',
    icon: AndIcon,
  },
};

const FilterGroupCard: React.FC<FilterGroupCardProps> = ({
  type,
  conditions,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}) => {
  const { t } = useTranslation('common');
  const config = GROUP_CONFIG[type];
  const Icon = config.icon;

  return (
    <Card
      sx={{
        mb: 3,
        borderLeft: `4px solid ${config.color}`,
        backgroundColor: (theme) =>
          theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
      }}
    >
      <CardContent>
        {/* Group header */}
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Icon sx={{ color: config.color }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: config.color }}>
              {t(`filterBuilder.groupTypes.${type}.label`)}
            </Typography>
            <Chip
              label={t('filterBuilder.labels.conditionsCount', { count: conditions.length })}
              size="small"
              sx={{
                backgroundColor: config.color,
                color: 'white',
                fontWeight: 500,
              }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t(`filterBuilder.groupTypes.${type}.description`)}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Condition list */}
        {conditions.length > 0 ? (
          <Stack spacing={2} sx={{ mb: 2 }}>
            {conditions.map((condition, index) => (
              <FilterConditionCard
                key={index}
                condition={condition}
                index={index}
                groupColor={config.color}
                onUpdate={(updatedCondition) => onUpdateCondition(index, updatedCondition)}
                onRemove={() => onRemoveCondition(index)}
              />
            ))}
          </Stack>
        ) : (
          <Box
            sx={{
              border: '2px dashed',
              borderColor: 'grey.300',
              borderRadius: 2,
              p: 3,
              textAlign: 'center',
              mb: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('filterBuilder.messages.noConditions')}
            </Typography>
          </Box>
        )}

        {/* Add condition button */}
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={onAddCondition}
          sx={{
            borderColor: config.color,
            color: config.color,
            '&:hover': {
              borderColor: config.color,
              backgroundColor: `${config.color}10`,
            },
          }}
        >
          {t('filterBuilder.buttons.addCondition')}
        </Button>
      </CardContent>
    </Card>
  );
};

export default FilterGroupCard;
