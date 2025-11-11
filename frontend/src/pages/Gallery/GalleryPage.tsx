import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  FilterAlt as FilterIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import ImageGrid from '../../components/ImageGrid/ImageGrid';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
import { useImages } from '../../hooks/useImages';
import { useSelection } from '../../hooks/useSelection';
import { imageApi } from '../../services/api';

// ✅ first_seen_date로 변경
type SortBy = 'first_seen_date' | 'file_size' | 'width' | 'height';
type SortOrder = 'ASC' | 'DESC';

const GalleryPage: React.FC = () => {
  const { t } = useTranslation(['gallery', 'common']);

  const {
    images,
    loading,
    error,
    currentPage,
    pageSize,
    totalPages,
    total,
    sortBy,
    sortOrder,
    aiToolFilter,
    changePage,
    changePageSize,
    changeSorting,
    changeAiToolFilter,
    deleteImages,
    refreshImages,
  } = useImages({
    initialSortBy: 'first_seen_date',
    initialSortOrder: 'DESC',
  });

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    selectedCount,
  } = useSelection();

  // ✅ id 기반으로 변경 (중복 이미지 개별 선택)
  const handleSelectionChange = (newSelectedIds: number[]) => {
    // 선택 상태를 직접 업데이트
    selectAll(newSelectedIds);
  };

  const handleImageDelete = async (compositeHash: string) => {
    await deleteImages([compositeHash]);
    // 선택 목록에서도 제거 (composite_hash로 id 찾기)
    const imageToDelete = images.find(img => img.composite_hash === compositeHash);
    if (imageToDelete?.id && selectedIds.includes(imageToDelete.id)) {
      toggleSelection(imageToDelete.id);
    }
  };

  const handleBulkActionComplete = () => {
    deselectAll();
    refreshImages();
  };

  // Handle sort changes
  const handleSortByChange = (newSortBy: SortBy) => {
    changeSorting(newSortBy, sortOrder);
  };

  const handleSortOrderChange = (newSortOrder: SortOrder) => {
    changeSorting(sortBy, newSortOrder);
  };

  // 고유한 AI 도구 목록 추출 (모든 이미지에서)
  const [aiTools, setAiTools] = useState<string[]>([]);

  useEffect(() => {
    // 전체 AI 도구 목록을 가져오기 위해 필터 없이 조회
    const fetchAiTools = async () => {
      try {
        const response = await imageApi.getImages(1, 1000, 'first_seen_date', 'DESC');
        if (response.success && response.data) {
          const tools = Array.from(new Set(
            response.data.images.map(img => img.ai_tool).filter((tool): tool is string => tool !== null)
          ));
          setAiTools(tools);
        }
      } catch (err) {
        console.error('Failed to fetch AI tools:', err);
      }
    };
    fetchAiTools();
  }, []);

  const clearFilters = () => {
    changeAiToolFilter('');
    changeSorting('first_seen_date', 'DESC');
  };

  const hasActiveFilters = aiToolFilter !== '';

  return (
    <Box sx={{ width: '100%' }}>
      {/* 헤더 */}
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          sx={{
            fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
            fontWeight: 600,
          }}
        >
          {t('gallery:page.title')}
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            fontSize: { xs: '0.875rem', sm: '1rem' },
          }}
        >
          {t('gallery:page.description')}
        </Typography>
      </Box>

      {/* 필터 및 정렬 컨트롤 */}
      <Paper
        elevation={1}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: { xs: 2, sm: 3 },
          borderRadius: 2,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: 1 }}>
            {/* AI 도구 필터 */}
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t('gallery:filters.aiTool')}</InputLabel>
              <Select
                value={aiToolFilter}
                label={t('gallery:filters.aiTool')}
                onChange={(e) => changeAiToolFilter(e.target.value)}
              >
                <MenuItem value="">{t('gallery:filters.all')}</MenuItem>
                {aiTools.map((tool) => tool && (
                  <MenuItem key={tool} value={tool}>
                    {tool}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 정렬 기준 */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>{t('gallery:filters.sortBy')}</InputLabel>
              <Select
                value={sortBy}
                label={t('gallery:filters.sortBy')}
                onChange={(e) => handleSortByChange(e.target.value as SortBy)}
              >
                <MenuItem value="first_seen_date">{t('gallery:sorting.uploadDate')}</MenuItem>
                <MenuItem value="file_size">{t('gallery:sorting.fileSize')}</MenuItem>
                <MenuItem value="width">{t('gallery:sorting.width')}</MenuItem>
                <MenuItem value="height">{t('gallery:sorting.height')}</MenuItem>
              </Select>
            </FormControl>

            {/* 정렬 순서 */}
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>{t('gallery:filters.order')}</InputLabel>
              <Select
                value={sortOrder}
                label={t('gallery:filters.order')}
                onChange={(e) => handleSortOrderChange(e.target.value as SortOrder)}
              >
                <MenuItem value="DESC">{t('gallery:sorting.descending')}</MenuItem>
                <MenuItem value="ASC">{t('gallery:sorting.ascending')}</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {hasActiveFilters && (
              <Button
                variant="outlined"
                size="small"
                onClick={clearFilters}
                startIcon={<FilterIcon />}
              >
                {t('gallery:actions.clearFilters')}
              </Button>
            )}

            <Tooltip title={t('gallery:actions.refresh')}>
              <span>
                <IconButton onClick={refreshImages} disabled={loading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Stack>

        {/* 활성 필터 표시 */}
        {hasActiveFilters && (
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {aiToolFilter && (
              <Chip
                label={t('gallery:filters.aiToolLabel', { tool: aiToolFilter })}
                onDelete={() => changeAiToolFilter('')}
                size="small"
                variant="outlined"
              />
            )}
          </Box>
        )}
      </Paper>

      {/* 에러 메시지 */}
      {error && (
        <Box
          sx={{
            mb: { xs: 2, sm: 3 },
            p: 2,
            bgcolor: 'error.light',
            color: 'error.contrastText',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2">{error}</Typography>
        </Box>
      )}

      {/* 이미지 그리드 (상시 선택모드) */}
      <ImageGrid
        images={images}
        loading={loading}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        pageSize={pageSize}
        onPageSizeChange={changePageSize}
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        onPageChange={changePage}
        onImageDelete={handleImageDelete}
      />

      {/* 벌크 액션 바 */}
      <BulkActionBar
        selectedCount={selectedCount}
        selectedIds={selectedIds}
        selectedImages={images.filter(img => img.id && selectedIds.includes(img.id))}
        onSelectionClear={deselectAll}
        onActionComplete={handleBulkActionComplete}
      />
    </Box>
  );
};

export default GalleryPage;