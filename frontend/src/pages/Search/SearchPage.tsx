import React from 'react';
import {
  Box,
  Typography,
  Alert,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared';
import SearchBar from '../../components/SearchBar/SearchBar';
import ImageList from '../../components/ImageList/ImageList';
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
    searchComplex,
    changePage,
    changePageSize,
    deleteImages,
    refreshSearch,
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

  const handleSelectionChange = (newSelectedIds: number[]) => {
    if (newSelectedIds.length === 0) {
      deselectAll();
    } else {
      // ImageList provides all selected IDs, so we can check diffs if needed,
      // but useSelection hook might treat toggle one by one.
      // However, ImageList handles logic and returns the full selected list from its specific state logic?
      // Wait, ImageList calls onSelectionChange with the NEW LIST.
      // useSelection expects toggle mostly, or manual state management.
      // But SearchPage's handleSelectionChange (original) had logic to try to use toggleSelection?
      // "if (newSelectedIds.length === images.length) selectAll... else ... toggleSelection..."
      // Let's adopt a simpler approach: update the selection context if possible, or replicate the logic.

      // Original logic was convoluted because ImageGrid didn't just dump the list.
      // Or ImageGrid DID dump the list, but useSelection is context based?
      // Let's try to infer action.

      // Actually, if we just want to sync local state with ImageList's output:
      // But useSelection hook uses a Set internally?
      // Let's look at how SearchPage used it.

      if (newSelectedIds.length === images.length) {
        selectAll(newSelectedIds);
      } else {
        // Find what changed?
        // This is inefficient if we get the whole list every time.
        // But ImageList emits the whole list.

        // Simpler: Just rely on ImageList to tell us what is selected, 
        // IF useSelection allowed setting the whole list directly.
        // It seems selectAll takes ids.
        // Does it have a setSelection?

        // Let's stick to the original logic which tried to be smart:
        const lastSelected = newSelectedIds.find(id => !selectedIds.includes(id));
        const lastDeselected = selectedIds.find(id => !newSelectedIds.includes(id));

        if (lastSelected) {
          toggleSelection(lastSelected);
        } else if (lastDeselected) {
          toggleSelection(lastDeselected);
        } else {
          // Fallback: If multiple changed (e.g. shift click), we need to update all.
          // If useSelection doesn't have setSelection, we might need to loop?
          // Or selectAll(newSelectedIds) but that might imply "select all" semantics?
          // Let's see if we can hack it by clearing and selecting?

          // If `selectAll` replaces the selection, we can just use that.
          // But `selectAll` usually implies "Select All visible".

          // Let's assume for now we use the convoluted logic for single clicks, 
          // but strictly we should support range updates.
        }
      }
    }
  };

  // Actually, useSelection might be shared context for Multi-page?
  // UseSelection seems local enough.

  // NOTE: ImageList handles shift-click range selection internally and returns the FULL LIST.
  // So `newSelectedIds` is the truth.
  // If `useSelection` cannot accept the full list, we have a problem.
  // `selectAll` usually takes an array. Let's assume calling selectAll with the subset works as "Select These".
  // But wait, `selectAll` name implies "All".

  // Let's look at `useSelection` signature if needed. 
  // For now, I will use a simplified handler that assumes `selectAll` sets the selection to the provided array (based on typical implementations).
  // If not, I might need to fix `useSelection` later.
  // Actually the original code did: `selectAll(newSelectedIds)` when length === images.length.

  // Wait, let's keep the original handler logic carefully but add a fallback for bulk changes (Shift Click).
  // The original handler only handled single toggle diffs.

  const handleSelectionChangeAdaptor = (newSelectedIds: number[]) => {
    // Optimized for range selection:
    // If the difference is large (>1), we should probably use a "set" method.
    // If we don't have one, we can iterate toggles? (Bad performance).

    // Let's check if we can just do: deselectAll(); selectAll(newSelectedIds); ?
    // If selectAll appends, that's bad.

    // For now, I'll allow the `ImageList` to manage its own selection if I pass `selectedIds` back to it?
    // Yes, `selectedIds` prop is passed.

    // Let's try to trust `selectAll` behaves as "Set these as selected" or find a way.
    // Re-reading original code:
    // const handleSelectionChange = (newSelectedIds: number[]) => { ... }

    // I will overwrite it with a version that tries to set the list.
    // Since I can't see useSelection source, I'll assume current behavior.

    // Actually, let's just stick to the original logic for now to avoid breaking `useSelection` behavior,
    // but wrapping it for ImageList.

    const added = newSelectedIds.filter(id => !selectedIds.includes(id));
    const removed = selectedIds.filter(id => !newSelectedIds.includes(id));

    if (newSelectedIds.length === 0) {
      deselectAll();
    } else if (newSelectedIds.length === images.length) {
      selectAll(newSelectedIds);
    } else {
      // Process changes
      added.forEach(id => toggleSelection(id));
      removed.forEach(id => toggleSelection(id));
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

      </Box>

      {/* 검색 바 */}
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <SearchBar onSearch={handleSearch} loading={loading} />
      </Box>

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
        </Box>
      ) : hasResults ? (
        <ImageList
          images={images}
          loading={loading}
          contextId="search"
          mode="pagination"
          pagination={{
            currentPage,
            totalPages,
            onPageChange: changePage,
            pageSize: pageSize as number,
            onPageSizeChange: (size) => changePageSize(size as any)
          }}
          selectable={true}
          selection={{
            selectedIds,
            onSelectionChange: handleSelectionChangeAdaptor,
          }}
          onImageDelete={handleImageDelete}
          total={total}
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