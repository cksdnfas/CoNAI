import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { HelpOutline as HelpOutlineIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { FilterCondition, FilterGroupType } from '@comfyui-image-manager/shared';
import FilterBlockList, { type FilterBlockData } from '../FilterBuilder/FilterBlockList';
import FilterBlockModal from '../FilterBuilder/FilterBlockModal';

interface AdvancedSearchTabProps {
  filterBlocks: FilterBlockData[];
  onAddBlock: (groupType: FilterGroupType, condition: FilterCondition) => void;
  onRemoveBlock: (id: string) => void;
  onEditBlock: (id: string, groupType: FilterGroupType, condition: FilterCondition) => void;
  showHeader?: boolean; // 헤더 표시 여부 (기본값: false, SearchPage에서만 true)
}

const AdvancedSearchTab: React.FC<AdvancedSearchTabProps> = ({
  filterBlocks,
  onAddBlock,
  onRemoveBlock,
  onEditBlock,
  showHeader = false,
}) => {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<FilterBlockData | null>(null);

  const handleOpenModal = () => {
    setEditingBlockId(null);
    setEditingBlock(null);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingBlockId(null);
    setEditingBlock(null);
  };

  const handleEditBlock = (id: string) => {
    const block = filterBlocks.find((b) => b.id === id);
    if (block) {
      setEditingBlockId(id);
      setEditingBlock(block);
      setModalOpen(true);
    }
  };

  const handleAddFilter = (groupType: FilterGroupType, condition: FilterCondition) => {
    if (editingBlockId) {
      // 편집 모드
      onEditBlock(editingBlockId, groupType, condition);
    } else {
      // 추가 모드
      onAddBlock(groupType, condition);
    }
  };

  const handleHelpClick = () => {
    window.open('/help?page=filters#/help', '_blank');
  };

  return (
    <Box sx={{ py: 2 }}>
      {/* 헤더와 도움말 링크 (showHeader가 true일 때만 표시) */}
      {showHeader && (
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
          <Box>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              {t('search:advancedTab.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {filterBlocks.length > 0
                ? t('search:advancedTab.descriptionActive', { count: filterBlocks.length })
                : t('search:advancedTab.descriptionEmpty')}
            </Typography>
          </Box>
          <Tooltip title={t('search:advancedTab.helpTooltip')} arrow>
            <IconButton onClick={handleHelpClick} size="small" color="primary">
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* 필터 블록 리스트 (+ 버튼 포함) */}
      <FilterBlockList
        blocks={filterBlocks}
        onRemove={onRemoveBlock}
        onEdit={handleEditBlock}
        onAdd={handleOpenModal}
      />

      {/* 필터 추가/편집 모달 */}
      <FilterBlockModal
        open={modalOpen}
        onClose={handleCloseModal}
        onAdd={handleAddFilter}
        initialData={editingBlock ? { groupType: editingBlock.groupType, condition: editingBlock.condition } : undefined}
      />
    </Box>
  );
};

export default AdvancedSearchTab;
