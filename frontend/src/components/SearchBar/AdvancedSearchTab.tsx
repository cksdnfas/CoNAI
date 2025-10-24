import React from 'react';
import { Box, Typography, Alert } from '@mui/material';
import { FilterCondition } from '@comfyui-image-manager/shared';
import FilterGroupCard from '../FilterBuilder/FilterGroupCard';

interface AdvancedSearchTabProps {
  excludeConditions: FilterCondition[];
  orConditions: FilterCondition[];
  andConditions: FilterCondition[];
  onAddExcludeCondition: () => void;
  onUpdateExcludeCondition: (index: number, condition: FilterCondition) => void;
  onRemoveExcludeCondition: (index: number) => void;
  onAddOrCondition: () => void;
  onUpdateOrCondition: (index: number, condition: FilterCondition) => void;
  onRemoveOrCondition: (index: number) => void;
  onAddAndCondition: () => void;
  onUpdateAndCondition: (index: number, condition: FilterCondition) => void;
  onRemoveAndCondition: (index: number) => void;
}

const AdvancedSearchTab: React.FC<AdvancedSearchTabProps> = ({
  excludeConditions,
  orConditions,
  andConditions,
  onAddExcludeCondition,
  onUpdateExcludeCondition,
  onRemoveExcludeCondition,
  onAddOrCondition,
  onUpdateOrCondition,
  onRemoveOrCondition,
  onAddAndCondition,
  onUpdateAndCondition,
  onRemoveAndCondition,
}) => {
  const totalConditions =
    excludeConditions.length + orConditions.length + andConditions.length;

  return (
    <Box sx={{ py: 2 }}>
      {/* 설명 */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2" fontWeight={500} gutterBottom>
          고급 검색: PoE 스타일 복합 필터 시스템
        </Typography>
        <Typography variant="caption" component="div" sx={{ mt: 1 }}>
          • <strong>제외 (NOT)</strong>: 이 조건에 맞는 이미지를 결과에서 제외합니다 (최우선 실행)
        </Typography>
        <Typography variant="caption" component="div">
          • <strong>OR 그룹</strong>: 조건 중 하나라도 만족하면 포함됩니다
        </Typography>
        <Typography variant="caption" component="div">
          • <strong>AND 그룹</strong>: 모든 조건을 만족해야 포함됩니다
        </Typography>
        <Typography variant="caption" component="div" sx={{ mt: 1, fontStyle: 'italic' }}>
          실행 순서: 제외 → OR → AND 순으로 필터링됩니다
        </Typography>
      </Alert>

      {totalConditions === 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          조건이 하나도 없습니다. 아래에서 조건을 추가하세요.
        </Alert>
      )}

      {/* 제외 (NOT) 그룹 */}
      <FilterGroupCard
        type="exclude"
        conditions={excludeConditions}
        onAddCondition={onAddExcludeCondition}
        onUpdateCondition={onUpdateExcludeCondition}
        onRemoveCondition={onRemoveExcludeCondition}
      />

      {/* OR 그룹 */}
      <FilterGroupCard
        type="or"
        conditions={orConditions}
        onAddCondition={onAddOrCondition}
        onUpdateCondition={onUpdateOrCondition}
        onRemoveCondition={onRemoveOrCondition}
      />

      {/* AND 그룹 */}
      <FilterGroupCard
        type="and"
        conditions={andConditions}
        onAddCondition={onAddAndCondition}
        onUpdateCondition={onUpdateAndCondition}
        onRemoveCondition={onRemoveAndCondition}
      />

      {/* 사용 예시 */}
      <Alert severity="success" sx={{ mt: 2 }}>
        <Typography variant="body2" fontWeight={500} gutterBottom>
          💡 사용 예시
        </Typography>
        <Typography variant="caption" component="div" sx={{ mt: 1 }}>
          <strong>시나리오</strong>: "nsfw 제외, 1girl OR 2girls, 캐릭터 있음"
        </Typography>
        <Typography variant="caption" component="div">
          1. 제외 그룹에 "오토태그 > General 태그: nsfw" 추가
        </Typography>
        <Typography variant="caption" component="div">
          2. OR 그룹에 "오토태그 > General 태그: 1girl" 추가
        </Typography>
        <Typography variant="caption" component="div">
          3. OR 그룹에 "오토태그 > General 태그: 2girls" 추가
        </Typography>
        <Typography variant="caption" component="div">
          4. AND 그룹에 "오토태그 > 캐릭터 존재: 있음" 추가
        </Typography>
      </Alert>
    </Box>
  );
};

export default AdvancedSearchTab;
