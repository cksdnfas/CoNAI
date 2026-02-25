import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip, Drawer, Snackbar, Alert } from '@mui/material';
import { Refresh as RefreshIcon, Close as CloseIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import ImageList from '../../components/ImageList/ImageList';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
import SearchBar from '../../components/SearchBar/SearchBar';
import { useInfiniteImages } from '../../hooks/useInfiniteImages';
import { usePaginatedImages } from '../../hooks/usePaginatedImages';
import { useImageListSettings } from '../../hooks/useImageListSettings';
import { useSearch } from '../../hooks/useSearch';
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared';
import type { PageSize } from '../../types/image';

const HomePage: React.FC = () => {
  const { t } = useTranslation(['common', 'search']);

  // State
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Feedback State
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'info' | 'error'>('info');

  const handleSnackbarClose = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbarOpen(false);
  };

  // Settings
  const { settings: homeSettings } = useImageListSettings('home');
  const { settings: searchSettings } = useImageListSettings('search');

  const activeSettings = isSearchMode ? searchSettings : homeSettings;
  const activeMode = activeSettings.activeScrollMode;

  // Recent Images Hooks
  const infiniteImages = useInfiniteImages();
  const paginatedImages = usePaginatedImages({
    pageSize: homeSettings.pageSize || 50
  });

  // Search Hooks
  const search = useSearch();

  // Selection State
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Toggle Modes
  const handleOpenSearch = () => {
    setSearchOpen(true);
  };

  const handleCloseSearchUI = () => {
    setSearchOpen(false);
  };

  const handleExecuteSearch = (request: ComplexSearchRequest, options?: { shuffle?: boolean }) => {
    setIsSearchMode(true);
    setSearchOpen(false);
    setSelectedIds([]); // Clear selection
    search.searchComplex(request, options);
  };

  const handleExitSearchMode = () => {
    setIsSearchMode(false);
    setSelectedIds([]); // Clear selection
    // Optional: Refresh recent images?
    if (activeMode === 'pagination') {
      paginatedImages.refreshImages();
    } else {
      // infiniteImages.refreshImages(); 
    }
  };

  // Refresh Handler
  const handleRefresh = async () => {
    setSnackbarMessage(t('common:messages.processing'));
    setSnackbarSeverity('info');
    setSnackbarOpen(true);

    try {
      if (activeMode === 'pagination') {
        await paginatedImages.refreshImages();
      } else {
        await infiniteImages.refreshImages();
      }

      setSnackbarMessage(t('common:messages.success'));
      setSnackbarSeverity('success');
    } catch (error) {
      console.error('Refresh failed:', error);
      setSnackbarMessage(t('common:messages.error'));
      setSnackbarSeverity('error');
    }
  };

  // Sync mode transitions
  React.useEffect(() => {
    if (isSearchMode && activeMode === 'pagination') {
      // When switching to pagination in search mode, reset accumulated infinite results
      search.refreshSearch();
    }
  }, [activeMode, isSearchMode, search.refreshSearch]);

  // Listen for global tag add events to open search drawer
  React.useEffect(() => {
    const handleAddTagEvent = () => {
      setSearchOpen(true);
    };

    window.addEventListener('add-search-tag', handleAddTagEvent);
    return () => window.removeEventListener('add-search-tag', handleAddTagEvent);
  }, []);

  // Unified Props
  let currentImages = infiniteImages.images;
  let currentLoading = infiniteImages.loading;
  let currentError = infiniteImages.error;

  if (isSearchMode) {
    currentImages = search.images;
    currentLoading = search.loading;
    currentError = search.error;
  } else if (activeMode === 'pagination') {
    currentImages = paginatedImages.images;
    currentLoading = paginatedImages.loading;
    currentError = paginatedImages.error;
  }

  const handleSelectionChange = (newSelectedIds: number[]) => {
    setSelectedIds(newSelectedIds);
  };

  const handleSelectionClear = () => {
    setSelectedIds([]);
  };

  const handleActionComplete = async (deletedHashes?: string[]) => {
    if (deletedHashes && deletedHashes.length > 0) {
      const deletedImageIds = currentImages
        .filter(img => img.composite_hash && deletedHashes.includes(img.composite_hash))
        .map(img => img.id)
        .filter((id): id is number => id !== undefined);

      setSelectedIds(prev => prev.filter(id => !deletedImageIds.includes(id)));
    }

    // Refresh current view
    if (isSearchMode) {
      search.refreshSearch();
    } else if (activeMode === 'pagination') {
      paginatedImages.refreshImages();
    } else {
      await infiniteImages.refreshImages();
    }
  };

  // ImageList Props based on mode
  const imageListProps = isSearchMode
    ? (activeMode === 'pagination' ? {
      contextId: 'search',
      mode: 'pagination' as const,
      pagination: {
        currentPage: search.currentPage,
        totalPages: search.totalPages,
        onPageChange: search.changePage,
        pageSize: search.pageSize || 25,
        onPageSizeChange: (size: number) => search.changePageSize(size as PageSize)
      },
      total: search.total
    } : {
      contextId: 'search',
      mode: 'infinite' as const,
      infiniteScroll: {
        hasMore: search.hasMore,
        loadMore: search.loadMore
      },
      total: search.total
    })
    : activeMode === 'pagination' ? {
      contextId: 'home', // This was correctly 'home' before? Yes.
      mode: 'pagination' as const,
      pagination: {
        currentPage: paginatedImages.page,
        totalPages: paginatedImages.totalPages,
        onPageChange: paginatedImages.setPage,
        pageSize: paginatedImages.pageSize,
        onPageSizeChange: paginatedImages.setPageSize
      },
      total: paginatedImages.total
    } : {
      contextId: 'home',
      mode: 'infinite' as const,
      infiniteScroll: {
        hasMore: infiniteImages.hasMore,
        loadMore: infiniteImages.loadMore
      },
      total: infiniteImages.images.length // Approximate or N/A
    };

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header */}
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isSearchMode && (
            <IconButton onClick={handleExitSearchMode} color="primary">
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            variant="h4"
            component="h1"
            sx={{
              fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
              fontWeight: 600,
            }}
          >
            {isSearchMode ? t('search:title') : 'Home'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {!isSearchMode && (
            <Tooltip title={t('common:refresh')}>
              <span>
                <IconButton onClick={handleRefresh} disabled={currentLoading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Error Message */}
      {currentError && (
        <Box
          sx={{
            mb: { xs: 2, sm: 3 },
            p: 2,
            bgcolor: 'error.light',
            color: 'error.contrastText',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2">{currentError}</Typography>
        </Box>
      )}

      {/* Image List (Unified) */}
      <ImageList
        images={currentImages}
        loading={currentLoading}
        selectable={true}
        selection={{
          selectedIds,
          onSelectionChange: handleSelectionChange,
        }}
        onSearchClick={handleOpenSearch}
        {...imageListProps}
      />

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        selectedIds={selectedIds}
        selectedImages={currentImages.filter(img => img.id && selectedIds.includes(img.id))}
        onSelectionClear={handleSelectionClear}
        onActionComplete={handleActionComplete}
      />

      {/* Search Overlay Dialog */}
      {/* Search Drawer */}
      <Drawer
        anchor={window.innerWidth < 600 ? 'bottom' : 'right'}
        open={searchOpen}
        onClose={handleCloseSearchUI}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 400 },
            height: { xs: '100%', sm: '100%' },
            bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
          }
        }}
        ModalProps={{
          keepMounted: true // Keep SearchBar mounted to receive events
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            {t('common:search')}
          </Typography>
          <IconButton onClick={handleCloseSearchUI} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
          <SearchBar onSearch={handleExecuteSearch} loading={search.loading} />
        </Box>

      </Drawer>

      {/* Feedback Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbarSeverity} sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box >
  );
};

export default HomePage;
