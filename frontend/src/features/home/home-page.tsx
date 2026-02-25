import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, X } from 'lucide-react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
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

  const handleSnackbarClose = (_event?: Event | object, reason?: string) => {
    if (reason === 'clickaway') {
      return
    }
    setSnackbarOpen(false)
  }

  useEffect(() => {
    if (!snackbarOpen) {
      return
    }

    const timeout = window.setTimeout(() => {
      handleSnackbarClose()
    }, 3000)

    return () => window.clearTimeout(timeout)
  }, [snackbarOpen])

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
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between sm:mb-3">
        <div className="flex items-center gap-2 sm:gap-3">
          {isSearchMode ? (
            <button
              type="button"
              onClick={handleExitSearchMode}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label={t('common:back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}
          <h1 className="text-[1.75rem] font-semibold leading-tight sm:text-[2rem] md:text-[2.25rem]">
            {isSearchMode ? t('search:title') : 'Home'}
          </h1>
        </div>

        <div className="flex gap-1">
          {!isSearchMode ? (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={currentLoading}
              title={t('common:refresh')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('common:refresh')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {currentError ? (
        <UiAlert variant="destructive" className="mb-2 sm:mb-3">
                  <AlertDescription>{currentError}</AlertDescription>
                </UiAlert>
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

      {searchOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={handleCloseSearchUI}
            aria-label={t('common:close')}
          />
          <div className="absolute inset-x-0 bottom-0 flex h-full w-full flex-col border border-border bg-background sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:max-w-full">
            <div className="flex items-center border-b border-border p-2">
              <h2 className="flex-1 text-lg font-semibold">
                {t('common:search')}
              </h2>
              <button
                type="button"
                onClick={handleCloseSearchUI}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                aria-label={t('common:close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <SearchBar onSearch={handleExecuteSearch} loading={search.loading} />
            </div>
          </div>
        </div>
      ) : null}

      {snackbarOpen ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <UiAlert
            variant={snackbarSeverity === 'error' ? 'destructive' : 'default'}
            className="min-w-[220px] shadow-lg"
          >
            <AlertDescription>{snackbarMessage}</AlertDescription>
          </UiAlert>
        </div>
      ) : null}
    </div>
  )
}
