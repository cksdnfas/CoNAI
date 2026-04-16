import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImagePlus, Loader2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getImageListDisplayName, getImageListItemId, getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { DropSurface } from '@/features/upload/components/upload-page-sections'
import { useDropZoneState } from '@/features/upload/use-drop-zone-state'
import { getAppSettings, getImages, listGenerationSaveImages, type SaveBrowserImageRecord } from '@/lib/api'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  buildImageSaveOutput,
  buildImageSaveOutputFileName,
  loadImageSaveSourceInfo,
  type ImageSaveOutputInput,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@/types/settings'
import {
  buildSelectedImageDraftFromDataUrl,
  readFileAsDataUrl,
  type SelectedImageDraft,
} from '../image-generation-shared'

type ImageAttachmentSource = 'upload' | 'system' | 'save'

type ImageAttachmentPickerButtonProps = {
  label: string
  modalTitle?: string
  disabled?: boolean
  allowSaveDialog?: boolean
  uploadOnly?: boolean
  onSelect: (image?: SelectedImageDraft) => void
}

type PendingImageSaveState = {
  fileName: string
  input: ImageSaveOutputInput
  sourceInfo: ImageSaveSourceInfo
}

type ImageAttachmentBrowserSectionProps = {
  searchValue: string
  searchPlaceholder: string
  searchHint: string
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

const IMAGE_ATTACHMENT_SOURCE_ITEMS = [
  { value: 'upload', label: '업로드' },
  { value: 'system', label: '시스템' },
  { value: 'save', label: 'Save' },
]

const SYSTEM_IMAGE_PAGE_SIZE = 24

/** Keep one canonical image-record map when paginated library pages append into the picker. */
function mergeImageAttachmentRecords(current: ImageRecord[], incoming: ImageRecord[]) {
  const next = new Map<string, ImageRecord>()

  for (const item of [...current, ...incoming]) {
    next.set(String(item.composite_hash ?? item.id), item)
  }

  return Array.from(next.values())
}

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
function ImageAttachmentEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}

/** Render one browser-style image list section for system/save sources. */
function ImageAttachmentBrowserSection({
  searchValue,
  searchPlaceholder,
  searchHint,
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="max-w-md" />
        <div className="text-xs text-muted-foreground">{searchHint}</div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={`image-attachment-skeleton-${index}`} className="space-y-2 rounded-sm border border-border/70 bg-surface-low p-3">
              <Skeleton className="h-44 w-full rounded-sm" />
              <Skeleton className="h-4 w-2/3 rounded-sm" />
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
            selectedIds.includes(getImageListItemId(image)) ? renderSelectedAction?.(image) ?? null : null
          )}
        />
      ) : (
        <ImageAttachmentEmptyState title="선택할 이미지가 없어" description="검색 조건을 바꾸거나 다른 소스를 골라봐." />
      )}
    </div>
  )
}

/** Render a shared image attachment button backed by upload/system/save picker sources. */
export function ImageAttachmentPickerButton({ label, modalTitle = '이미지 선택', disabled = false, allowSaveDialog = true, uploadOnly = false, onSelect }: ImageAttachmentPickerButtonProps) {
  const { showSnackbar } = useSnackbar()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [source, setSource] = useState<ImageAttachmentSource>('upload')
  const [isImporting, setIsImporting] = useState(false)
  const [systemPage, setSystemPage] = useState(1)
  const [systemImages, setSystemImages] = useState<ImageRecord[]>([])
  const [selectedSystemIds, setSelectedSystemIds] = useState<string[]>([])
  const [selectedSaveIds, setSelectedSaveIds] = useState<string[]>([])
  const [systemSearch, setSystemSearch] = useState('')
  const [saveSearch, setSaveSearch] = useState('')
  const [imageSaveOptions, setImageSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [pendingImageSave, setPendingImageSave] = useState<PendingImageSaveState | null>(null)
  const sourceItems = useMemo(
    () => (uploadOnly ? IMAGE_ATTACHMENT_SOURCE_ITEMS.filter((item) => item.value === 'upload') : IMAGE_ATTACHMENT_SOURCE_ITEMS),
    [uploadOnly],
  )

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const systemImagesQuery = useQuery({
    queryKey: ['image-attachment-system-images', systemPage],
    queryFn: () => getImages({ page: systemPage, limit: SYSTEM_IMAGE_PAGE_SIZE }),
    enabled: isOpen && !uploadOnly && source === 'system',
  })

  const saveImagesQuery = useQuery({
    queryKey: ['image-attachment-save-images'],
    queryFn: () => listGenerationSaveImages(),
    enabled: isOpen && !uploadOnly && source === 'save',
  })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setSource('upload')
    setSystemPage(1)
    setSystemImages([])
    setSelectedSystemIds([])
    setSelectedSaveIds([])
    setSystemSearch('')
    setSaveSearch('')
  }, [isOpen])

  useEffect(() => {
    if (uploadOnly && source !== 'upload') {
      setSource('upload')
    }
  }, [source, uploadOnly])

  useEffect(() => {
    if (!isOpen || source !== 'system' || !systemImagesQuery.data) {
      return
    }

    setSystemImages((current) => (systemPage === 1 ? systemImagesQuery.data.images : mergeImageAttachmentRecords(current, systemImagesQuery.data.images)))
  }, [isOpen, source, systemImagesQuery.data, systemPage])

  const filteredSystemImages = useMemo(() => {
    const search = systemSearch.trim().toLowerCase()
    if (!search) {
      return systemImages
    }

    return systemImages.filter((image) => getImageListDisplayName(image).toLowerCase().includes(search))
  }, [systemImages, systemSearch])

  const saveImageRecords = useMemo(() => (saveImagesQuery.data ?? []).map(toSaveBrowserImageRecord), [saveImagesQuery.data])

  const filteredSaveImages = useMemo(() => {
    const search = saveSearch.trim().toLowerCase()
    if (!search) {
      return saveImageRecords
    }

    return saveImageRecords.filter((image) => getImageListDisplayName(image).toLowerCase().includes(search))
  }, [saveImageRecords, saveSearch])

  const systemHasMore = Boolean(systemImagesQuery.data?.hasMore)
  const effectiveImageSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

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
  const finalizeSelectedImage = async (fileName: string, input: ImageSaveOutputInput) => {
    if (!effectiveImageSaveSettings.applyToGenerationAttachments) {
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
      onSelect(await buildRawSelectedImageDraft(sourceBlob, fileName))
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
      showSnackbar({ message: error instanceof Error ? error.message : '이미지 저장 옵션을 적용하지 못했어.', tone: 'error' })
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
      showSnackbar({ message: '이미지 파일만 첨부할 수 있어.', tone: 'error' })
      return
    }

    try {
      setIsImporting(true)
      await finalizeSelectedImage(file.name, {
        source: file,
        sourceMimeType: file.type,
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지를 불러오지 못했어.', tone: 'error' })
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
  const handleImportExistingImage = async (image: ImageRecord | null) => {
    if (!image) {
      return
    }

    const sourceCandidates = buildImageAttachmentImportSourceCandidates(image)
    if (sourceCandidates.length === 0) {
      showSnackbar({ message: '선택한 이미지 URL을 찾지 못했어.', tone: 'error' })
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
      })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : '이미지를 가져오지 못했어.', tone: 'error' })
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

  const handleSystemSelectionChange = (nextIds: string[]) => {
    setSelectedSystemIds(nextIds.slice(-1))
  }

  const handleSaveSelectionChange = (nextIds: string[]) => {
    setSelectedSaveIds(nextIds.slice(-1))
  }

  if (uploadOnly) {
    return (
      <>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void handleUploadFileChange(event)} />

        <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
          <DropSurface
            ariaLabel={`${label} 업로드`}
            active={uploadDropZone.isDragActive}
            onClick={() => {
              if (!disabled && !isImporting) {
                inputRef.current?.click()
              }
            }}
            onDrop={uploadDropZone.handleDrop}
            onDragEnter={uploadDropZone.handleDragEnter}
            onDragOver={uploadDropZone.handleDragOver}
            onDragLeave={uploadDropZone.handleDragLeave}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setIsOpen(true)}>
        <ImagePlus className="h-4 w-4" />
        {label}
      </Button>

      <SettingsModal
        open={isOpen}
        onClose={() => {
          if (!isImporting) {
            setIsOpen(false)
          }
        }}
        title={modalTitle}
        widthClassName="max-w-7xl"
      >
        <div className="space-y-5">
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => void handleUploadFileChange(event)} />

          {!uploadOnly ? (
            <div>
              <SegmentedTabBar value={source} items={sourceItems} onChange={(nextSource) => setSource(nextSource as ImageAttachmentSource)} />
            </div>
          ) : null}

          {source === 'upload' ? (
            <div className="pt-1">
              <DropSurface
                ariaLabel="첨부할 이미지 선택"
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
            <ImageAttachmentBrowserSection
              searchValue={systemSearch}
              searchPlaceholder="불러온 시스템 이미지에서 이름 검색"
              searchHint="최신 이미지부터 불러오고 있어."
              items={filteredSystemImages}
              selectedIds={selectedSystemIds}
              onSelectedIdsChange={handleSystemSelectionChange}
              onSearchChange={setSystemSearch}
              isLoading={systemImagesQuery.isLoading && systemImages.length === 0}
              hasMore={systemHasMore && systemSearch.trim().length === 0}
              isLoadingMore={systemImagesQuery.isFetching && systemPage > 1}
              onLoadMore={() => {
                if (!systemHasMore || systemImagesQuery.isFetching) {
                  return
                }

                setSystemPage((current) => current + 1)
              }}
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
                  aria-label="이미지 선택"
                  title="이미지 선택"
                >
                  {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </Button>
              )}
            />
          ) : null}

          {!uploadOnly && source === 'save' ? (
            <ImageAttachmentBrowserSection
              searchValue={saveSearch}
              searchPlaceholder="save 이미지 이름 검색"
              searchHint="save 폴더 아래 이미지를 재귀적으로 보여줘."
              items={filteredSaveImages}
              selectedIds={selectedSaveIds}
              onSelectedIdsChange={handleSaveSelectionChange}
              onSearchChange={setSaveSearch}
              isLoading={saveImagesQuery.isLoading}
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
                  aria-label="이미지 선택"
                  title="이미지 선택"
                >
                  {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </Button>
              )}
            />
          ) : null}
        </div>
      </SettingsModal>

      <ImageSaveOptionsModal
        open={pendingImageSave !== null}
        title="이미지 저장"
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
