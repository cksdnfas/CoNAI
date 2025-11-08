import React from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared';
import SearchBar from '../../components/SearchBar/SearchBar';
import ImageGrid from '../../components/ImageGrid/ImageGrid';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
import { useSearch } from '../../hooks/useSearch';
import { useSelection } from '../../hooks/useSelection';

const SearchPage: React.FC = () => {
  const { t } = useTranslation(['search', 'common']);

  const {
    images,
    loading,
    error,
    currentPage,
    pageSize,
    totalPages,
    total,
    lastSearchParams,
    lastComplexRequest,
    allResultIds,
    searchComplex,
    changePage,
    changePageSize,
    deleteImages,
    refreshSearch,
    clearSearch,
  } = useSearch();

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    selectedCount,
  } = useSelection();

  const handleSearch = (request: ComplexSearchRequest) => {
    deselectAll(); // 새 검색 시 선택 해제
    searchComplex(request);
  };

  // ✅ id 기반으로 변경 (중복 이미지 개별 선택)
  const handleSelectionChange = (newSelectedIds: number[]) => {
    if (newSelectedIds.length === 0) {
      deselectAll();
    } else {
      if (newSelectedIds.length === images.length) {
        selectAll(newSelectedIds);
      } else {
        const lastSelected = newSelectedIds.find(id => !selectedIds.includes(id));
        const lastDeselected = selectedIds.find(id => !newSelectedIds.includes(id));

        if (lastSelected) {
          toggleSelection(lastSelected);
        } else if (lastDeselected) {
          toggleSelection(lastDeselected);
        }
      }
    }
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
    refreshSearch();
  };

  const hasSearched = lastSearchParams !== null || lastComplexRequest !== null;
  const hasResults = images.length > 0;

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
          {t('search:title')}
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            fontSize: { xs: '0.875rem', sm: '1rem' },
          }}
        >
          {t('search:description')}
        </Typography>
      </Box>

      {/* 검색 바 */}
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <SearchBar onSearch={handleSearch} loading={loading} />
      </Box>

      {/* 검색 결과 헤더 */}
      {hasSearched && (
        <Box sx={{ mb: { xs: 2, sm: 3 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            spacing={2}
          >
            <Box>
              <Typography variant="h6">
                {t('search:results.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {loading ? t('search:results.searching') : t('search:results.found', { count: total })}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={clearSearch}
                startIcon={<ClearIcon />}
              >
                {t('search:results.reset')}
              </Button>
              {hasResults && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={refreshSearch}
                  disabled={loading}
                  startIcon={<RefreshIcon />}
                >
                  {t('search:results.refresh')}
                </Button>
              )}
            </Box>
          </Stack>
        </Box>
      )}

      {/* 에러 메시지 */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: { xs: 2, sm: 3 },
            borderRadius: 2,
          }}
        >
          {error}
        </Alert>
      )}

      {/* 검색 결과 또는 안내 메시지 */}
      {!hasSearched ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('search:results.initialMessage')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('search:results.initialHint')}
          </Typography>
        </Box>
      ) : hasResults ? (
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
          searchParams={lastSearchParams || undefined}
          allImageIds={allResultIds}
        />
      ) : !loading ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {t('search:results.noResults')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('search:results.noResultsHint')}
          </Typography>
        </Box>
      ) : null}

      {/* 벌크 액션 바 */}
      {hasResults && (
        <BulkActionBar
          selectedCount={selectedCount}
          selectedIds={selectedIds}
          selectedImages={images.filter(img => img.id && selectedIds.includes(img.id))}
          onSelectionClear={deselectAll}
          onActionComplete={handleBulkActionComplete}
        />
      )}
    </Box>
  );
};

export default SearchPage;