import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Stack,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Block as BlockIcon,
  CallSplit as OrIcon,
  MergeType as AndIcon,
} from '@mui/icons-material';
import { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';
import FilterConditionCard from './FilterConditionCard';

interface FilterGroupCardProps {
  type: FilterGroupType;
  conditions: FilterCondition[];
  onAddCondition: () => void;
  onUpdateCondition: (index: number, condition: FilterCondition) => void;
  onRemoveCondition: (index: number) => void;
}

// 그룹 타입별 설정
const GROUP_CONFIG = {
  exclude: {
    label: '제외 (NOT)',
    color: '#f44336',
    icon: BlockIcon,
    description: '이 조건에 맞는 이미지를 제외합니다 (최우선 실행)'
  },
  or: {
    label: 'OR 그룹',
    color: '#2196f3',
    icon: OrIcon,
    description: '조건 중 하나라도 만족하면 포함됩니다'
  },
  and: {
    label: 'AND 그룹',
    color: '#4caf50',
    icon: AndIcon,
    description: '모든 조건을 만족해야 포함됩니다'
  }
};

const FilterGroupCard: React.FC<FilterGroupCardProps> = ({
  type,
  conditions,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}) => {
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
        {/* 그룹 헤더 */}
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Icon sx={{ color: config.color }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: config.color }}>
              {config.label}
            </Typography>
            <Chip
              label={`${conditions.length}개 조건`}
              size="small"
              sx={{
                backgroundColor: config.color,
                color: 'white',
                fontWeight: 500,
              }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {config.description}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* 조건 리스트 */}
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
              조건이 없습니다. 아래 버튼을 눌러 조건을 추가하세요.
            </Typography>
          </Box>
        )}

        {/* 조건 추가 버튼 */}
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
          조건 추가
        </Button>
      </CardContent>
    </Card>
  );
};

export default FilterGroupCard;
