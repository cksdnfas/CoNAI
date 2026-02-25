import React from 'react';
import { Box, IconButton } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import type { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';
import FilterBlock from './FilterBlock';

export interface FilterBlockData {
  id: string;
  groupType: FilterGroupType;
  condition: FilterCondition;
}

interface FilterBlockListProps {
  blocks: FilterBlockData[];
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void; // 추가 버튼 클릭 핸들러
}

// 블록 정렬: 제외 → OR → AND
const sortBlocks = (blocks: FilterBlockData[]): FilterBlockData[] => {
  const order: Record<FilterGroupType, number> = { exclude: 0, or: 1, and: 2 };
  return [...blocks].sort((a, b) => order[a.groupType] - order[b.groupType]);
};

const FilterBlockList: React.FC<FilterBlockListProps> = ({ blocks, onRemove, onEdit, onAdd }) => {
  const sortedBlocks = sortBlocks(blocks);

  return (
    <Box>
      {/* 반응형 그리드 - 필터 블록 + 추가 버튼 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',                // 모바일: 1열
            sm: 'repeat(2, 1fr)',     // 태블릿: 2열
            md: 'repeat(4, 1fr)',     // 데스크톱: 4열
            lg: 'repeat(5, 1fr)',     // 큰 화면: 5열
            xl: 'repeat(6, 1fr)',     // 초대형 화면: 6열
          },
          gap: 1.5,
        }}
      >
        {/* 기존 필터 블록들 */}
        {sortedBlocks.map((block) => (
          <Box
            key={block.id}
            sx={{
              animation: 'fadeIn 0.3s ease-in-out',
              '@keyframes fadeIn': {
                from: {
                  opacity: 0,
                  transform: 'translateY(10px)',
                },
                to: {
                  opacity: 1,
                  transform: 'translateY(0)',
                },
              },
            }}
          >
            <FilterBlock
              id={block.id}
              groupType={block.groupType}
              condition={block.condition}
              onRemove={() => onRemove(block.id)}
              onEdit={() => onEdit(block.id)}
            />
          </Box>
        ))}

        {/* 추가 버튼 - 그리드의 다음 셀에 배치 */}
        <Box
          onClick={onAdd}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120, // FilterBlock과 동일한 높이
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 2,
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? 'rgba(33, 150, 243, 0.05)'
                : 'rgba(33, 150, 243, 0.02)',
            '&:hover': {
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(33, 150, 243, 0.15)'
                  : 'rgba(33, 150, 243, 0.08)',
              borderColor: 'primary.dark',
              transform: 'scale(1.02)',
            },
            animation: 'fadeIn 0.3s ease-in-out',
            '@keyframes fadeIn': {
              from: {
                opacity: 0,
                transform: 'translateY(10px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
          }}
        >
          <IconButton
            color="primary"
            sx={{
              width: 56,
              height: 56,
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': {
                bgcolor: 'primary.dark',
                transform: 'rotate(90deg)',
              },
              transition: 'all 0.3s ease-in-out',
            }}
          >
            <AddIcon fontSize="large" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default FilterBlockList;
