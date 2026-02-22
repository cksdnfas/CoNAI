import { useEffect, useState } from 'react'
import { Alert, Box, Drawer, IconButton, Snackbar, Tooltip, Typography } from '@mui/material'
import { ArrowBack as ArrowBackIcon, Close as CloseIcon, Refresh as RefreshIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared'
import type { PageSize } from '@/types/image'
import { useInfiniteImages } from '@/hooks/use-infinite-images'
import { usePaginatedImages } from '@/hooks/use-paginated-images'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import { useSearch } from '@/hooks/use-search'
import ImageList from '@/features/images/components/image-list'
import BulkActionBar from './components/bulk-action-bar'
import SearchBar from './components/search-bar'

export function HomePage() {
  const { t } = useTranslation(['common', 'search'])

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'info' | 'error'>('info')

  const handleSnackbarClose = (_event?: Event | React.SyntheticEvent, reason?: string) => {
    if (reason === 'clickaway') {
      return
    }
    setSnackbarOpen(false)
  }

  const { settings: homeSettings } = useImageListSettings('home')
  const { settings: searchSettings } = useImageListSettings('search')

  const activeSettings = isSearchMode ? searchSettings : homeSettings
  const activeMode = activeSettings.activeScrollMode

  const infiniteImages = useInfiniteImages()
  const paginatedImages = usePaginatedImages({
    pageSize: homeSettings.pageSize || 50,
  })

  const search = useSearch()
  const refreshSearch = search.refreshSearch
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const handleOpenSearch = () => {
    setSearchOpen(true)
  }

  const handleCloseSearchUI = () => {
    setSearchOpen(false)
  }

  const handleExecuteSearch = (request: ComplexSearchRequest, options?: { shuffle?: boolean }) => {
    setIsSearchMode(true)
    setSearchOpen(false)
    setSelectedIds([])
    void search.searchComplex(request, options)
  }

  const handleExitSearchMode = () => {
    setIsSearchMode(false)
    setSelectedIds([])

    if (activeMode === 'pagination') {
      void paginatedImages.refreshImages()
    }
  }

  const handleRefresh = async () => {
    setSnackbarMessage(t('common:messages.processing'))
    setSnackbarSeverity('info')
    setSnackbarOpen(true)

    try {
      if (activeMode === 'pagination') {
        await paginatedImages.refreshImages()
      } else {
        await infiniteImages.refreshImages()
      }

      setSnackbarMessage(t('common:messages.success'))
      setSnackbarSeverity('success')
    } catch (error) {
      console.error('Refresh failed:', error)
      setSnackbarMessage(t('common:messages.error'))
      setSnackbarSeverity('error')
    }
  }

  useEffect(() => {
    if (isSearchMode && activeMode === 'pagination') {
      void refreshSearch()
    }
  }, [activeMode, isSearchMode, refreshSearch])

  useEffect(() => {
    const handleAddTagEvent = () => {
      setSearchOpen(true)
    }

    window.addEventListener('add-search-tag', handleAddTagEvent)
    return () => window.removeEventListener('add-search-tag', handleAddTagEvent)
  }, [])

  let currentImages = infiniteImages.images
  let currentLoading = infiniteImages.loading
  let currentError = infiniteImages.error

  if (isSearchMode) {
    currentImages = search.images
    currentLoading = search.loading
    currentError = search.error
  } else if (activeMode === 'pagination') {
    currentImages = paginatedImages.images
    currentLoading = paginatedImages.loading
    currentError = paginatedImages.error
  }

  const handleSelectionChange = (newSelectedIds: number[]) => {
    setSelectedIds(newSelectedIds)
  }

  const handleSelectionClear = () => {
    setSelectedIds([])
  }

  const handleActionComplete = async (deletedHashes?: string[]) => {
    if (deletedHashes && deletedHashes.length > 0) {
      const deletedImageIds = currentImages
        .filter((image) => image.composite_hash && deletedHashes.includes(image.composite_hash))
        .map((image) => image.id)
        .filter((id): id is number => id !== undefined)

      setSelectedIds((previous) => previous.filter((id) => !deletedImageIds.includes(id)))
    }

    if (isSearchMode) {
      await refreshSearch()
    } else if (activeMode === 'pagination') {
      await paginatedImages.refreshImages()
    } else {
      await infiniteImages.refreshImages()
    }
  }

  const imageListProps = isSearchMode
    ? activeMode === 'pagination'
      ? {
          contextId: 'search',
          mode: 'pagination' as const,
          pagination: {
            currentPage: search.currentPage,
            totalPages: search.totalPages,
            onPageChange: search.changePage,
            pageSize: search.pageSize || 25,
            onPageSizeChange: (size: number) => search.changePageSize(size as PageSize),
          },
          total: search.total,
        }
      : {
          contextId: 'search',
          mode: 'infinite' as const,
          infiniteScroll: {
            hasMore: search.hasMore,
            loadMore: search.loadMore,
          },
          total: search.total,
        }
    : activeMode === 'pagination'
      ? {
          contextId: 'home',
          mode: 'pagination' as const,
          pagination: {
            currentPage: paginatedImages.page,
            totalPages: paginatedImages.totalPages,
            onPageChange: paginatedImages.setPage,
            pageSize: paginatedImages.pageSize,
            onPageSizeChange: paginatedImages.setPageSize,
          },
          total: paginatedImages.total,
        }
      : {
          contextId: 'home',
          mode: 'infinite' as const,
          infiniteScroll: {
            hasMore: infiniteImages.hasMore,
            loadMore: infiniteImages.loadMore,
          },
          total: infiniteImages.images.length,
        }

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isSearchMode ? (
            <IconButton onClick={handleExitSearchMode} color="primary">
              <ArrowBackIcon />
            </IconButton>
          ) : null}
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
          {!isSearchMode ? (
            <Tooltip title={t('common:refresh')}>
              <span>
                <IconButton onClick={handleRefresh} disabled={currentLoading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
        </Box>
      </Box>

      {currentError ? (
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
      ) : null}

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

      <BulkActionBar
        selectedCount={selectedIds.length}
        selectedIds={selectedIds}
        selectedImages={currentImages.filter((image) => image.id && selectedIds.includes(image.id))}
        onSelectionClear={handleSelectionClear}
        onActionComplete={handleActionComplete}
      />

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
          },
        }}
        ModalProps={{
          keepMounted: true,
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
    </Box>
  )
}
