import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { MediaFileDropSurface } from '@/components/media/media-file-drop-surface'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { MediaLibraryBrowser } from '@/components/media/media-library-browser'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getImageListDisplayName, getImageListItemId, getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { useDropZoneState } from '@/features/upload/use-drop-zone-state'
import { listGenerationSaveImages } from '@/lib/api-image-generation-history'
import type { SaveBrowserImageRecord } from '@/lib/api-image-generation-types'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { getImageViewerSettings } from '@/lib/api-settings'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  buildImageSaveOutput,
  buildImageSaveOutputFileName,
  loadImageSaveSourceInfo,
  type ImageSaveOutputInput,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@conai/shared'
import {
  buildSelectedImageDraftFromDataUrl,
  readFileAsDataUrl,
} from '../image-generation-drafts'
import {
  type SelectedImageDraft,
} from '../image-generation-shared'

type ImageAttachmentSource = 'library' | 'upload' | 'system' | 'save'

type ImageAttachmentPickerButtonProps = {
  label: string
  modalTitle?: string
  disabled?: boolean
  allowSaveDialog?: boolean
  /** Pixel-sensitive source/mask inputs must not inherit global attachment resize/lossy conversion. */
  preserveOriginal?: boolean
  uploadOnly?: boolean
  selectedImage?: SelectedImageDraft | null
  onRemove?: () => void
  onSelect: (image?: SelectedImageDraft) => void
  /** Controlled open state; pair with `hideTrigger` to open the picker from another control. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  /** Extra first tab (e.g. a saved-asset library); the caller closes the picker when it handles a pick. */
  librarySource?: { label: string; content: ReactNode }
}

type PendingImageSaveState = {
  fileName: string
  input: ImageSaveOutputInput
  sourceInfo: ImageSaveSourceInfo
}

type ImageAttachmentBrowserSectionProps = {
  searchValue: string
  searchPlaceholder: string
  items: ImageRecord[]
  selectedIds: string[]
  onSelectedIdsChange: (nextIds: string[]) => void
  onSearchChange: (value: string) => void
  isLoading: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
  renderSelectedAction?: (image: ImageRecord) => ReactNode
}

const IMAGE_ATTACHMENT_SOURCE_VALUES: ImageAttachmentSource[] = ['upload', 'system', 'save']

/** Convert one save-browser item into the shared image-list record shape. */
function toSaveBrowserImageRecord(item: SaveBrowserImageRecord): ImageRecord {
  return {
    id: item.id,
    composite_hash: item.id,
    original_file_path: item.relative_path,
    image_url: item.url,
    thumbnail_url: item.url,
    mime_type: item.mime_type,
    file_size: item.file_size,
    first_seen_date: item.modified_at,
  }
}

/** Build fallback source URLs for picker imports so paged items still import when one route is stale or missing. */
function buildImageAttachmentImportSourceCandidates(image: ImageRecord) {
  const candidates = [
    image.composite_hash ? `/api/images/${encodeURIComponent(image.composite_hash)}/file` : null,
    image.image_url,
    getImageListPreviewUrl(image),
    image.composite_hash ? `/api/images/${encodeURIComponent(image.composite_hash)}/thumbnail` : null,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  return Array.from(new Set(candidates))
}

/** Render one compact empty state using shared alert styling. */
function ImageAttachmentEmptyState({ title }: { title: string }) {
  return <EmptyState size="compact" title={title} />
}

/** Browse unregistered Save files; registered media uses MediaLibraryBrowser. */
function ImageAttachmentBrowserSection({
  searchValue,
  searchPlaceholder,
  items,
  selectedIds,
  onSelectedIdsChange,
  onSearchChange,
  isLoading,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  renderSelectedAction,
}: ImageAttachmentBrowserSectionProps) {
  const { t } = useI18n()
  const selectedImageAttachmentIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="max-w-md" />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={`image-attachment-skeleton-${index}`} className="ui-tone-plinth space-y-2 rounded-sm p-3">
              <Skeleton radius="sm" className="h-44 w-full" />
              <Skeleton radius="sm" className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : items.length > 0 ? (
        <ImageList
          items={items}
          layout="grid"
          selectable
          forceSelectionMode
          selectedIds={selectedIds}
          onSelectedIdsChange={(nextIds) => onSelectedIdsChange(nextIds.slice(-1))}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          scrollMode="container"
          viewportHeight={520}
          minColumnWidth={180}
          gridItemHeight={220}
          renderItemOverlay={(image) => (
            selectedImageAttachmentIdSet.has(getImageListItemId(image)) ? renderSelectedAction?.(image) ?? null : null
          )}
        />
      ) : (
        <ImageAttachmentEmptyState title={t({ ko: '선택할 이미지가 없어', en: 'No images to select' })} />
      )}
    </div>
  )
}

/** Render a shared image attachment button backed by upload/system/save picker sources. */
export function ImageAttachmentPickerButton({
  label,
  modalTitle,
  disabled = false,
  allowSaveDialog = true,
  preserveOriginal = false,
  uploadOnly = false,
  selectedImage,
  onRemove,
  onSelect,
  open,
  onOpenChange,
  hideTrigger = false,
  librarySource,
}: ImageAttachmentPickerButtonProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = open ?? uncontrolledOpen
  const setIsOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const hasLibrarySource = Boolean(librarySource) && !uploadOnly
  const librarySourceLabel = librarySource?.label
  const [source, setSource] = useState<ImageAttachmentSource>('upload')
  const [isImporting, setIsImporting] = useState(false)
  const [selectedLibraryImage, setSelectedLibraryImage] = useState<ImageRecord | null>(null)
  const [selectedSaveIds, setSelectedSaveIds] = useState<string[]>([])
  const [saveSearch, setSaveSearch] = useState('')
  const debouncedSaveSearch = useDebouncedValue(saveSearch.trim())
  const [saveSession, setSaveSession] = useState(0)
  const refreshSaveOnOpen = useRef(false)
  const saveSnapshot = useRef<{ session: number; id: string | null } | null>(null)
  const [imageSaveOptions, setImageSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [pendingImageSave, setPendingImageSave] = useState<PendingImageSaveState | null>(null)
  const sourceItems = useMemo(() => {
    const values: ImageAttachmentSource[] = uploadOnly
      ? ['upload']
      : hasLibrarySource ? ['library', ...IMAGE_ATTACHMENT_SOURCE_VALUES] : IMAGE_ATTACHMENT_SOURCE_VALUES
    return values.map((value) => ({
      value,
      label: value === 'library'
        ? librarySourceLabel ?? ''
        : value === 'upload'
        ? t({ ko: '업로드', en: 'Upload' })
        : value === 'system'
          ? t({ ko: '시스템', en: 'System' })
          : 'Save',
    }))
  }, [hasLibrarySource, librarySourceLabel, t, uploadOnly])

  const { canViewImages } = useImagePermissions()
  const appSettingsQuery = useQuery({
    queryKey: ['image-viewer-settings'],
    enabled: canViewImages,
    queryFn: getImageViewerSettings,
  })

  const saveImagesQuery = useInfiniteQuery({
    queryKey: ['image-attachment-save-images', saveSession, debouncedSaveSearch],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (saveSnapshot.current?.session !== saveSession) saveSnapshot.current = { session: saveSession, id: null }
      const refresh = pageParam === null && refreshSaveOnOpen.current
      if (refresh) refreshSaveOnOpen.current = false
      const page = await listGenerationSaveImages({
        limit: 60,
        search: debouncedSaveSearch,
        cursor: pageParam,
        snapshot: !refresh && pageParam === null ? saveSnapshot.current.id : undefined,
        refresh,
      })
      if (saveSnapshot.current?.session === saveSession) saveSnapshot.current.id = page.snapshot
      return page
    },
    getNextPageParam: (page) => page.nextCursor,
    gcTime: 0,
    refetchOnWindowFocus: false,
    enabled: canViewImages && isOpen && !uploadOnly && source === 'save' && saveSearch.trim() === debouncedSaveSearch,
  })

  useEffect(() => {
    if (!isOpen) {
      setSource('upload')
      return
    }

    setSource(hasLibrarySource ? 'library' : 'upload')
    setSelectedLibraryImage(null)
    setSelectedSaveIds([])
    setSaveSearch('')
  }, [hasLibrarySource, isOpen])

  useEffect(() => {
    if (uploadOnly && source !== 'upload') {
      setSource('upload')
    }
  }, [source, uploadOnly])

  const saveImageRecords = useMemo(() => (saveImagesQuery.data?.pages ?? []).flatMap((page) => page.items.map(toSaveBrowserImageRecord)), [saveImagesQuery.data])

  const effectiveImageSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS
  const effectiveModalTitle = modalTitle ?? t({ ko: '이미지 선택', en: 'Select image' })

  useEffect(() => {
    if (!pendingImageSave) {
      return
    }

    setImageSaveOptions(effectiveImageSaveSettings)
  }, [effectiveImageSaveSettings, pendingImageSave])

  /** Build one raw selected-image draft without applying save output conversion. */
  const buildRawSelectedImageDraft = async (blob: Blob, fileName: string) => {
    return buildSelectedImageDraftFromDataUrl(await readFileAsDataUrl(blob), fileName)
  }

  /** Finalize one selected image source using the current image-save settings. */
  const finalizeSelectedImage = async (fileName: string, input: ImageSaveOutputInput, libraryHash?: string) => {
    if (preserveOriginal || !effectiveImageSaveSettings.applyToGenerationAttachments) {
      const sourceBlob = typeof input.source === 'string'
        ? await fetch(input.source, {
            credentials: 'include',
          }).then(async (response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch image: ${response.status}`)
            }
            return response.blob()
          })
        : input.source
      const draft = await buildRawSelectedImageDraft(sourceBlob, fileName)
      // Passed on unchanged, a library image keeps its id so callers can point at it instead of copying it.
      onSelect(libraryHash ? { ...draft, compositeHash: libraryHash } : draft)
      setIsOpen(false)
      return
    }

    if (effectiveImageSaveSettings.alwaysShowDialog && allowSaveDialog) {
      const sourceInfo = await loadImageSaveSourceInfo(input)
      setIsOpen(false)
      setPendingImageSave({ fileName, input, sourceInfo })
      return
    }

    const output = await buildImageSaveOutput(input, effectiveImageSaveSettings)
    onSelect(buildSelectedImageDraftFromDataUrl(output.dataUrl, buildImageSaveOutputFileName(fileName, output.format)))
    setIsOpen(false)
  }

  /** Apply the pending save-options dialog and close it after updating the caller field. */
  const handleConfirmImageSave = async () => {
    if (!pendingImageSave) {
      return
    }

    try {
      setIsImporting(true)
      const output = await buildImageSaveOutput(pendingImageSave.input, imageSaveOptions)
      onSelect(buildSelectedImageDraftFromDataUrl(output.dataUrl, buildImageSaveOutputFileName(pendingImageSave.fileName, output.format)))
      setPendingImageSave(null)
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '이미지 저장 옵션을 적용하지 못했어.', en: 'Could not apply image save options.' }), tone: 'error' })
    } finally {
      setIsImporting(false)
    }
  }

  /** Import one picker file and close after updating the caller field. */
  const handleImportUploadFile = async (file: File | null) => {
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      showSnackbar({ message: t({ ko: '이미지 파일만 첨부할 수 있어.', en: 'Only image files can be attached.' }), tone: 'error' })
      return
    }

    try {
      setIsImporting(true)
      await finalizeSelectedImage(file.name, {
        source: file,
        sourceMimeType: file.type,
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '이미지를 불러오지 못했어.', en: 'Could not load the image.' }), tone: 'error' })
    } finally {
      setIsImporting(false)
    }
  }

  /** Handle one file input selection from the upload tab. */
  const handleUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.currentTarget.value = ''
    await handleImportUploadFile(file)
  }

  /** Import one existing image URL and convert it back into the inline draft shape. */
  const handleImportExistingImage = async (image: ImageRecord | null, fromLibrary = false) => {
    if (!image) {
      return
    }

    const sourceCandidates = buildImageAttachmentImportSourceCandidates(image)
    if (sourceCandidates.length === 0) {
      showSnackbar({ message: t({ ko: '선택한 이미지 URL을 찾지 못했어.', en: 'Could not find the selected image URL.' }), tone: 'error' })
      return
    }

    try {
      setIsImporting(true)

      let blob: Blob | null = null
      let lastError: Error | null = null

      for (const sourceUrl of sourceCandidates) {
        const response = await fetch(sourceUrl, {
          credentials: 'include',
        })

        if (!response.ok) {
          lastError = new Error(`Failed to fetch image: ${response.status}`)
          continue
        }

        blob = await response.blob()
        break
      }

      if (!blob) {
        throw lastError ?? new Error('Failed to fetch image')
      }

      await finalizeSelectedImage(getImageListDisplayName(image), {
        source: blob,
        sourceMimeType: blob.type || image.mime_type || undefined,
      }, fromLibrary ? image.composite_hash ?? undefined : undefined)
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' }), tone: 'error' })
    } finally {
      setIsImporting(false)
    }
  }

  const uploadDropZone = useDropZoneState<HTMLButtonElement>({
    onDropFiles: (files) => {
      const imageFile = files.find((file) => file.type.startsWith('image/')) ?? files[0] ?? null
      void handleImportUploadFile(imageFile)
    },
  })

  const handleSaveSelectionChange = (nextIds: string[]) => {
    setSelectedSaveIds(nextIds.slice(-1))
  }

  if (uploadOnly) {
    const uploadDisabled = disabled || isImporting

    return (
      <>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void handleUploadFileChange(event)} />

        <MediaFileDropSurface
          ariaLabel={selectedImage ? t('uploadPageSections.replaceSelectedImage') : t({ ko: '{label} 업로드', en: 'Upload {label}' }, { label })}
          active={uploadDropZone.isDragActive}
          disabled={uploadDisabled}
          onClick={() => inputRef.current?.click()}
          onDrop={uploadDropZone.handleDrop}
          onDragEnter={uploadDropZone.handleDragEnter}
          onDragOver={uploadDropZone.handleDragOver}
          onDragLeave={uploadDropZone.handleDragLeave}
          actions={selectedImage ? (
            <>
              <IconButton
                variant="secondary"
                size="icon-sm"
                disabled={uploadDisabled}
                onClick={() => inputRef.current?.click()}
                label={t('uploadPageSections.replaceSelectedImage')}
              >
                <RefreshCw />
              </IconButton>
              <IconButton
                variant="destructive"
                size="icon-sm"
                disabled={uploadDisabled}
                onClick={() => {
                  if (onRemove) {
                    onRemove()
                    return
                  }

                  onSelect()
                }}
                label={t('uploadPageSections.removeSelectedImage')}
              >
                <Trash2 />
              </IconButton>
            </>
          ) : undefined}
        >
          {selectedImage ? (
            <div className="w-full space-y-2">
              <InlineMediaPreview
                src={selectedImage.dataUrl}
                mimeType={selectedImage.mimeType}
                fileName={selectedImage.fileName}
                alt={label}
                frameClassName="w-full bg-transparent p-0"
                mediaClassName="max-h-40 w-full object-contain"
              />
              <div className="truncate px-2 text-center text-xs text-muted-foreground" title={selectedImage.fileName}>{selectedImage.fileName}</div>
            </div>
          ) : undefined}
        </MediaFileDropSurface>
      </>
    )
  }

  return (
    <>
      {hideTrigger ? null : (
        <IconButton variant="secondary" disabled={disabled} onClick={() => setIsOpen(true)} label={label}>
          <ImagePlus />
        </IconButton>
      )}

      <Modal
        open={isOpen}
        onClose={() => {
          if (!isImporting) {
            setIsOpen(false)
          }
        }}
        title={effectiveModalTitle}
        size="xl" height="tall"
      >
        <div className={source === 'system' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-5'}>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void handleUploadFileChange(event)} />

          {!uploadOnly ? (
            <div>
              <SegmentedTabBar value={source} items={sourceItems} onChange={(value) => {
                const nextSource = value as ImageAttachmentSource
                if (nextSource === 'save' && source !== 'save') {
                  refreshSaveOnOpen.current = true
                  setSaveSession((session) => session + 1)
                }
                setSource(nextSource)
              }} />
            </div>
          ) : null}

          {hasLibrarySource && source === 'library' ? librarySource?.content : null}

          {source === 'upload' ? (
            <div className="pt-1">
              <MediaFileDropSurface
                ariaLabel={t({ ko: '첨부할 이미지 선택', en: 'Select image to attach' })}
                active={uploadDropZone.isDragActive}
                onClick={() => inputRef.current?.click()}
                onDrop={uploadDropZone.handleDrop}
                onDragEnter={uploadDropZone.handleDragEnter}
                onDragOver={uploadDropZone.handleDragOver}
                onDragLeave={uploadDropZone.handleDragLeave}
              />
            </div>
          ) : null}

          {!uploadOnly && source === 'system' ? (
            <>
              <MediaLibraryBrowser
                mediaKind="image"
                maxCount={1}
                disabled={isImporting}
                selectedIds={selectedLibraryImage?.composite_hash ? [selectedLibraryImage.composite_hash] : []}
                onSelectedIdsChange={(ids, items) => setSelectedLibraryImage((current) => {
                  const hash = ids[0]
                  return hash ? items.find((item) => item.composite_hash === hash) ?? (current?.composite_hash === hash ? current : null) : null
                })}
              />
              <ModalFooter>
                <span className="mr-auto min-w-0 truncate text-sm text-muted-foreground">{selectedLibraryImage ? getImageListDisplayName(selectedLibraryImage) : t({ ko: '이미지 한 장을 골라줘.', en: 'Choose one image.' })}</span>
                <Button disabled={!canViewImages || isImporting || !selectedLibraryImage} onClick={() => void handleImportExistingImage(selectedLibraryImage, true)}>
                  {isImporting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t({ ko: '선택', en: 'Select' })}
                </Button>
              </ModalFooter>
            </>
          ) : null}

          {!uploadOnly && source === 'save' ? (
            <ImageAttachmentBrowserSection
              searchValue={saveSearch}
              searchPlaceholder={t({ ko: 'save 이미지 이름 검색', en: 'Search save images by name' })}
              items={saveImageRecords}
              selectedIds={selectedSaveIds}
              onSelectedIdsChange={handleSaveSelectionChange}
              onSearchChange={setSaveSearch}
              isLoading={saveImagesQuery.isLoading}
              hasMore={saveImagesQuery.hasNextPage}
              isLoadingMore={saveImagesQuery.isFetching}
              onLoadMore={() => saveImagesQuery.fetchNextPage()}
              renderSelectedAction={(image) => (
                <Button
                  type="button"
                  size="icon-sm"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleImportExistingImage(image)
                  }}
                  disabled={isImporting}
                  aria-label={t({ ko: '이미지 선택', en: 'Select image' })}
                  title={t({ ko: '이미지 선택', en: 'Select image' })}
                >
                  {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </Button>
              )}
            />
          ) : null}
        </div>
      </Modal>

      <ImageSaveOptionsModal
        open={pendingImageSave !== null}
        title={t({ ko: '이미지 저장', en: 'Save image' })}
        options={imageSaveOptions}
        sourceInfo={pendingImageSave?.sourceInfo ?? null}
        isSaving={isImporting}
        onClose={() => {
          if (!isImporting) {
            setPendingImageSave(null)
          }
        }}
        onOptionsChange={(patch) => setImageSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmImageSave()}
      />
    </>
  )
}
