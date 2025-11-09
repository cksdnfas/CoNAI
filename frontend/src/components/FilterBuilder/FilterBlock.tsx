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
import type { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';

interface FilterBlockProps {
  id: string;
  groupType: FilterGroupType;
  condition: FilterCondition;
  onRemove: () => void;
  onEdit: () => void;
}

// 그룹 타입별 설정
const GROUP_CONFIG = {
  exclude: {
    label: '제외',
    color: '#f44336',
    icon: BlockIcon,
    bgColor: '#ffebee',
    darkBgColor: '#5d1f1f',
  },
  or: {
    label: 'OR',
    color: '#2196f3',
    icon: OrIcon,
    bgColor: '#e3f2fd',
    darkBgColor: '#1a3a52',
  },
  and: {
    label: 'AND',
    color: '#4caf50',
    icon: AndIcon,
    bgColor: '#e8f5e9',
    darkBgColor: '#1e4620',
  },
};

// 카테고리 레이블
const CATEGORY_LABELS: Record<string, string> = {
  positive_prompt: '긍정 프롬프트',
  negative_prompt: '네거티브 프롬프트',
  auto_tag: '자동태그',
  basic: '기본',
};

// 조건 타입 레이블
const TYPE_LABELS: Record<string, string> = {
  prompt_contains: '포함',
  prompt_regex: '정규식',
  negative_prompt_contains: '포함',
  negative_prompt_regex: '정규식',
  auto_tag_exists: '자동태그 존재',
  auto_tag_has_character: '캐릭터 존재',
  auto_tag_rating: 'Rating 타입',
  auto_tag_rating_score: 'Rating 점수',
  auto_tag_general: 'General 태그',
  auto_tag_character: 'Character 태그',
  auto_tag_model: '모델',
  ai_tool: 'AI 도구',
  model_name: '모델명',
};

const FilterBlock: React.FC<FilterBlockProps> = ({
  groupType,
  condition,
  onRemove,
  onEdit,
}) => {
  const config = GROUP_CONFIG[groupType];
  const Icon = config.icon;

  // 조건 요약 텍스트 생성
  const getSummaryText = () => {
    const category = CATEGORY_LABELS[condition.category] || condition.category;
    const type = TYPE_LABELS[condition.type] || condition.type;

    let value = String(condition.value);

    // Boolean 타입 처리
    if (typeof condition.value === 'boolean') {
      value = condition.value ? '있음' : '없음';
    }

    // Rating 타입 특별 처리
    if (condition.type === 'auto_tag_rating' && condition.rating_type) {
      value = condition.rating_type;
    }

    // 점수 범위 표시
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
          {/* 헤더: 그룹 타입 + 편집/삭제 버튼 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Chip
              icon={<Icon sx={{ fontSize: '0.875rem' }} />}
              label={config.label}
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
                점수: {scoreRange}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default FilterBlock;
