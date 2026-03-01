import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Settings2, X } from 'lucide-react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared'
import type { PageSize } from '@/types/image'
import { useInfiniteImages } from '@/hooks/use-infinite-images'
import { usePaginatedImages } from '@/hooks/use-paginated-images'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import { useSearch } from '@/hooks/use-search'
import ImageList from '@/features/images/components/image-list'
import { createInfiniteImageListAdapter, createPaginationImageListAdapter } from '@/features/images/components/image-list-contract'
import BulkActionBar from './components/bulk-action-bar'
import SearchBar from './components/search-bar'

export function HomePage() {
  const { t } = useTranslation(['common', 'search'])
  const clampGridColumns = (value: number) => Math.max(1, Math.min(10, Math.floor(value)))

  const [isSearchMode, setIsSearchMode] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'info' | 'error'>('info')
  const [layoutOptionsOpen, setLayoutOptionsOpen] = useState(false)
  const [layoutDraftContext, setLayoutDraftContext] = useState<'home' | 'search'>('home')
  const [draftViewMode, setDraftViewMode] = useState<'grid' | 'masonry'>('masonry')
  const [draftGridColumns, setDraftGridColumns] = useState(4)
  const layoutPanelRef = useRef<HTMLDivElement | null>(null)
  const layoutFabRef = useRef<HTMLButtonElement | null>(null)

  const closeLayoutOptions = useCallback((restoreFocus = false) => {
    setLayoutOptionsOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        layoutFabRef.current?.focus()
      })
    }
  }, [])

  const handleSnackbarClose = useCallback((_event?: Event | object, reason?: string) => {
    if (reason === 'clickaway') {
      return
    }
    setSnackbarOpen(false)
  }, [])

  useEffect(() => {
    if (!snackbarOpen) {
      return
    }

    const timeout = window.setTimeout(() => {
      handleSnackbarClose()
    }, 3000)

    return () => window.clearTimeout(timeout)
  }, [handleSnackbarClose, snackbarOpen])

  useEffect(() => {
    if (!layoutOptionsOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLayoutOptions(true)
      }
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (layoutPanelRef.current?.contains(target)) {
        return
      }

      if (layoutFabRef.current?.contains(target)) {
        return
      }

      if (target.closest('[data-slot="select-content"]')) {
        return
      }

      closeLayoutOptions(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('touchstart', handlePointerDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('touchstart', handlePointerDown)
    }
  }, [closeLayoutOptions, layoutOptionsOpen])

  const {
    settings: homeSettings,
    setViewMode: setHomeViewMode,
    setGridColumns: setHomeGridColumns,
  } = useImageListSettings('home')
  const {
    settings: searchSettings,
    setViewMode: setSearchViewMode,
    setGridColumns: setSearchGridColumns,
  } = useImageListSettings('search')
  const appliedViewMode = isSearchMode ? searchSettings.viewMode : homeSettings.viewMode
  const appliedGridColumns = clampGridColumns(isSearchMode ? searchSettings.gridColumns : homeSettings.gridColumns)

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

  const handleLayoutFabClick = () => {
    const nextDraftContext = isSearchMode ? 'search' : 'home'
    const sourceSettings = nextDraftContext === 'search' ? searchSettings : homeSettings
    setLayoutDraftContext(nextDraftContext)
    setDraftViewMode(sourceSettings.viewMode)
    setDraftGridColumns(clampGridColumns(sourceSettings.gridColumns))
    setLayoutOptionsOpen((previous) => !previous)
  }

  const handleApplyLayout = () => {
    const safeColumns = clampGridColumns(draftGridColumns)
    if (layoutDraftContext === 'search') {
      setSearchViewMode(draftViewMode)
      setSearchGridColumns(safeColumns)
    } else {
      setHomeViewMode(draftViewMode)
      setHomeGridColumns(safeColumns)
    }
    setDraftGridColumns(safeColumns)
    closeLayoutOptions(false)
  }

  const imageListAdapter = isSearchMode
    ? activeMode === 'pagination'
      ? createPaginationImageListAdapter({
          pagination: {
            currentPage: search.currentPage,
            totalPages: search.totalPages,
            onPageChange: search.changePage,
            pageSize: search.pageSize || 25,
            onPageSizeChange: (size: number) => search.changePageSize(size as PageSize),
          },
          total: search.total,
          capabilities: {
            emptyStateAction: {
              label: 'Open Search',
              onClick: handleOpenSearch,
            },
          },
        })
      : createInfiniteImageListAdapter({
          infiniteScroll: {
            hasMore: search.hasMore,
            loadMore: search.loadMore,
          },
          total: search.total,
          capabilities: {
            emptyStateAction: {
              label: 'Open Search',
              onClick: handleOpenSearch,
            },
          },
        })
    : activeMode === 'pagination'
      ? createPaginationImageListAdapter({
          pagination: {
            currentPage: paginatedImages.page,
            totalPages: paginatedImages.totalPages,
            onPageChange: paginatedImages.setPage,
            pageSize: paginatedImages.pageSize,
            onPageSizeChange: paginatedImages.setPageSize,
          },
          total: paginatedImages.total,
          capabilities: {
            emptyStateAction: {
              label: 'Open Search',
              onClick: handleOpenSearch,
            },
          },
        })
      : createInfiniteImageListAdapter({
          infiniteScroll: {
            hasMore: infiniteImages.hasMore,
            loadMore: infiniteImages.loadMore,
          },
          total: infiniteImages.images.length,
          capabilities: {
            emptyStateAction: {
              label: 'Open Search',
              onClick: handleOpenSearch,
            },
          },
        })

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
        viewMode={appliedViewMode}
        gridColumns={appliedGridColumns}
        selectable={true}
        selection={{
          selectedIds,
          onSelectionChange: handleSelectionChange,
        }}
        adapter={imageListAdapter}
      />

      {!searchOpen ? (
        <div className="fixed right-4 bottom-4 z-[1040] sm:right-6 sm:bottom-6">
          {layoutOptionsOpen ? (
            <div
              ref={layoutPanelRef}
              data-testid="home-layout-options-panel"
              className="absolute right-0 bottom-full mb-3 w-[min(280px,calc(100vw-2rem))] rounded-lg border bg-background p-3 shadow-lg"
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="home-layout-mode-select">
                    Layout mode
                  </label>
                  <select
                    id="home-layout-mode-select"
                    data-testid="home-layout-mode-select"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={draftViewMode}
                    onChange={(event) => setDraftViewMode(event.target.value as 'grid' | 'masonry')}
                  >
                    <option value="grid">grid</option>
                    <option value="masonry">masonry</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="home-layout-columns-input">
                    Columns
                  </label>
                  <Input
                    id="home-layout-columns-input"
                    data-testid="home-layout-columns-input"
                    type="number"
                    min={1}
                    max={10}
                    value={draftGridColumns}
                    onChange={(event) => {
                      const parsed = Number(event.target.value)
                      if (Number.isNaN(parsed)) {
                        return
                      }
                      setDraftGridColumns(clampGridColumns(parsed))
                    }}
                  />
                </div>

                <Button
                  type="button"
                  data-testid="home-layout-apply"
                  className="w-full"
                  onClick={handleApplyLayout}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}

          <Button
            type="button"
            size="icon"
            variant="default"
            data-testid="home-layout-options-fab"
            ref={layoutFabRef}
            onClick={handleLayoutFabClick}
            aria-label="Layout options"
            className="h-12 w-12 rounded-full border-2 border-background bg-primary text-primary-foreground shadow-2xl ring-2 ring-black/20 hover:bg-primary/90"
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </div>
      ) : null}

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
