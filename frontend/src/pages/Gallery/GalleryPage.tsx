import React, { useState } from 'react';
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

type SortBy = 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
type SortOrder = 'asc' | 'desc';

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
    changePage,
    changePageSize,
    deleteImages,
    refreshImages,
  } = useImages();

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    selectedCount,
  } = useSelection();

  const [sortBy, setSortBy] = useState<SortBy>('upload_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterAiTool, setFilterAiTool] = useState<string>('');

  const handleSelectionChange = (newSelectedIds: number[]) => {
    // 선택 상태를 직접 업데이트
    selectAll(newSelectedIds);
  };

  const handleImageDelete = async (id: number) => {
    await deleteImages([id]);
    // 선택 목록에서도 제거
    if (selectedIds.includes(id)) {
      toggleSelection(id);
    }
  };

  const handleBulkActionComplete = () => {
    deselectAll();
    refreshImages();
  };

  // 정렬된 이미지 목록 (클라이언트 정렬)
  const sortedImages = [...images].sort((a, b) => {
    let aValue: any = a[sortBy];
    let bValue: any = b[sortBy];

    // 날짜 정렬의 경우
    if (sortBy === 'upload_date') {
      aValue = new Date(aValue).getTime();
      bValue = new Date(bValue).getTime();
    }

    // 문자열 정렬의 경우
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  // AI 도구별 필터링
  const filteredImages = filterAiTool
    ? sortedImages.filter(image => image.ai_tool === filterAiTool)
    : sortedImages;

  // 고유한 AI 도구 목록 추출
  const aiTools = Array.from(new Set(images.map(image => image.ai_tool).filter(Boolean)));

  const clearFilters = () => {
    setFilterAiTool('');
    setSortBy('upload_date');
    setSortOrder('desc');
  };

  const hasActiveFilters = filterAiTool !== '';

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
                value={filterAiTool}
                label={t('gallery:filters.aiTool')}
                onChange={(e) => setFilterAiTool(e.target.value)}
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
                onChange={(e) => setSortBy(e.target.value as SortBy)}
              >
                <MenuItem value="upload_date">{t('gallery:sorting.uploadDate')}</MenuItem>
                <MenuItem value="filename">{t('gallery:sorting.filename')}</MenuItem>
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
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              >
                <MenuItem value="desc">{t('gallery:sorting.descending')}</MenuItem>
                <MenuItem value="asc">{t('gallery:sorting.ascending')}</MenuItem>
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
            {filterAiTool && (
              <Chip
                label={t('gallery:filters.aiToolLabel', { tool: filterAiTool })}
                onDelete={() => setFilterAiTool('')}
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
        images={filteredImages}
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
        selectedImages={filteredImages.filter(img => selectedIds.includes(img.id))}
        onSelectionClear={deselectAll}
        onActionComplete={handleBulkActionComplete}
      />
    </Box>
  );
};

export default GalleryPage;