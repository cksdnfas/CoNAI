import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ImagePlus, Loader2, Upload } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getImageListDisplayName, getImageListItemId, getImageListPreviewUrl } from '@/features/images/components/image-list/image-list-utils'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
  onSelect: (image?: SelectedImageDraft) => void
}

type PendingImageSaveState = {
  fileName: string
  input: ImageSaveOutputInput
  sourceInfo: ImageSaveSourceInfo
}

type ImageAttachmentBrowserSectionProps = {
  title: string
  searchValue: string
  searchPlaceholder: string
  searchHint: string
  totalCount: number
  selectedCount: number
  items: ImageRecord[]
  selectedIds: string[]
  onSelectedIdsChange: (nextIds: string[]) => void
  onSearchChange: (value: string) => void
  isLoading: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => Promise<unknown> | void
}

const IMAGE_ATTACHMENT_SOURCE_ITEMS = [
  { value: 'upload', label: '업로드' },
  { value: 'system', label: '시스템' },
  { value: 'save', label: 'Save' },
]

const SYSTEM_IMAGE_PAGE_SIZE = 24

/** Format one optional file size into a compact localized label. */
function formatImageAttachmentFileSize(value?: number | null) {
  if (!value || value <= 0) {
    return '—'
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`
  }

  return `${value} B`
}

/** Format one optional timestamp into the shared Korean datetime style. */
function formatImageAttachmentDateTime(value?: string | null) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

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
  title,
  searchValue,
  searchPlaceholder,
  searchHint,
  totalCount,
  selectedCount,
  items,
  selectedIds,
  onSelectedIdsChange,
  onSearchChange,
  isLoading,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: ImageAttachmentBrowserSectionProps) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading={title}
          actions={
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">전체 {totalCount}</Badge>
              <Badge variant={selectedCount > 0 ? 'secondary' : 'outline'}>선택 {selectedCount}</Badge>
            </div>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="max-w-sm" />
          <div className="text-xs text-muted-foreground">{searchHint}</div>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={`image-attachment-skeleton-${index}`} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
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
            viewportHeight={430}
            minColumnWidth={180}
            gridItemHeight={220}
            renderItemOverlay={(image) => (
              selectedIds.includes(getImageListItemId(image)) ? (
                <Badge variant="secondary" className="shadow-sm">
                  <Check className="h-3.5 w-3.5" />
                  선택됨
                </Badge>
              ) : null
            )}
          />
        ) : (
          <ImageAttachmentEmptyState title="선택할 이미지가 없어" description="검색 조건을 바꾸거나 다른 소스를 골라봐." />
        )}
      </CardContent>
    </Card>
  )
}

/** Render a compact selection summary card for the active picker source. */
function ImageAttachmentSelectionCard({
  image,
  sourceLabel,
  isImporting,
  onConfirm,
  onCancel,
}: {
  image: ImageRecord | null
  sourceLabel: string
  isImporting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const previewUrl = image ? getImageListPreviewUrl(image) : null
  const fileName = image ? getImageListDisplayName(image) : null

  return (
    <Card>
      <CardContent className="space-y-4">
        <SectionHeading
          variant="inside"
          className="border-b border-border/70 pb-4"
          heading="선택 요약"
          description="선택한 이미지를 확인해."
          actions={image ? <Badge variant="secondary">1 selected</Badge> : <Badge variant="outline">0 selected</Badge>}
        />

        {image && previewUrl ? (
          <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
            <img src={previewUrl} alt={fileName ?? 'selected image'} className="max-h-72 w-full rounded-sm border border-border bg-surface-lowest object-contain" />
            <div className="space-y-2">
              <div className="break-all text-sm font-medium text-foreground">{fileName}</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{sourceLabel}</Badge>
                <Badge variant="outline">{image.mime_type || 'image/*'}</Badge>
                <Badge variant="outline">{formatImageAttachmentFileSize(image.file_size)}</Badge>
              </div>
              <div className="space-y-1 rounded-sm border border-border/70 bg-surface-lowest px-3 py-2 text-xs text-muted-foreground">
                <div>수정일 · {formatImageAttachmentDateTime(image.first_seen_date)}</div>
                {image.original_file_path ? <div className="break-all">경로 · {image.original_file_path}</div> : null}
              </div>
            </div>
          </div>
        ) : (
          <ImageAttachmentEmptyState title="아직 선택한 이미지가 없어" description="왼쪽 목록에서 이미지 하나를 고르면 여기서 바로 확인할 수 있어." />
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isImporting}>
            취소
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isImporting || !image}>
            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            선택한 이미지 가져오기
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Render a shared image attachment button backed by upload/system/save picker sources. */
export function ImageAttachmentPickerButton({ label, modalTitle = '이미지 선택', disabled = false, allowSaveDialog = true, onSelect }: ImageAttachmentPickerButtonProps) {
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

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const systemImagesQuery = useQuery({
    queryKey: ['image-attachment-system-images', systemPage],
    queryFn: () => getImages({ page: systemPage, limit: SYSTEM_IMAGE_PAGE_SIZE }),
    enabled: isOpen && source === 'system',
  })

  const saveImagesQuery = useQuery({
    queryKey: ['image-attachment-save-images'],
    queryFn: () => listGenerationSaveImages(),
    enabled: isOpen && source === 'save',
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

  const selectedSystemImage = useMemo(
    () => filteredSystemImages.find((image) => String(image.composite_hash ?? image.id) === selectedSystemIds[0]) ?? null,
    [filteredSystemImages, selectedSystemIds],
  )

  const selectedSaveImage = useMemo(
    () => filteredSaveImages.find((image) => String(image.composite_hash ?? image.id) === selectedSaveIds[0]) ?? null,
    [filteredSaveImages, selectedSaveIds],
  )

  const activeSelectedImage = source === 'system' ? selectedSystemImage : source === 'save' ? selectedSaveImage : null
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
        ? await fetch(input.source).then((response) => response.blob())
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
  const handleUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.currentTarget.value = ''

    if (!file) {
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

  /** Import one existing image URL and convert it back into the inline draft shape. */
  const handleImportExistingImage = async (image: ImageRecord | null) => {
    if (!image) {
      return
    }

    const sourceUrl = image.image_url || image.thumbnail_url
    if (!sourceUrl) {
      showSnackbar({ message: '선택한 이미지 URL을 찾지 못했어.', tone: 'error' })
      return
    }

    try {
      setIsImporting(true)
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`)
      }

      const blob = await response.blob()
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

          <Card>
            <CardContent className="space-y-4">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 pb-4"
                heading="이미지 소스"
                actions={<Badge variant="outline">3 sources</Badge>}
              />
              <SegmentedControl value={source} items={IMAGE_ATTACHMENT_SOURCE_ITEMS} onChange={(nextSource) => setSource(nextSource as ImageAttachmentSource)} />
            </CardContent>
          </Card>

          {source === 'upload' ? (
            <Card>
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  className="border-b border-border/70 pb-4"
                  heading="로컬 파일 업로드"
                  actions={<Badge variant="outline">Upload</Badge>}
                />

                <div className="rounded-sm border border-dashed border-border bg-surface-low px-5 py-10">
                  <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-lowest text-primary">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button type="button" onClick={() => inputRef.current?.click()} disabled={isImporting}>
                        {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        이미지 선택
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setIsOpen(false)} disabled={isImporting}>
                        닫기
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {source === 'system' ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
              <div className="min-w-0">
                <ImageAttachmentBrowserSection
                  title="시스템 이미지"
                  searchValue={systemSearch}
                  searchPlaceholder="불러온 시스템 이미지에서 이름 검색"
                  searchHint="최신 이미지부터 불러오고 있어."
                  totalCount={filteredSystemImages.length}
                  selectedCount={selectedSystemIds.length}
                  items={filteredSystemImages}
                  selectedIds={selectedSystemIds}
                  onSelectedIdsChange={setSelectedSystemIds}
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
                />
              </div>
              <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
                <ImageAttachmentSelectionCard
                  image={activeSelectedImage}
                  sourceLabel="시스템 이미지"
                  isImporting={isImporting}
                  onCancel={() => setIsOpen(false)}
                  onConfirm={() => void handleImportExistingImage(activeSelectedImage)}
                />
              </div>
            </div>
          ) : null}

          {source === 'save' ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
              <div className="min-w-0">
                <ImageAttachmentBrowserSection
                  title="Save 폴더 이미지"
                  searchValue={saveSearch}
                  searchPlaceholder="save 이미지 이름 검색"
                  searchHint="save 폴더 아래 이미지를 재귀적으로 보여줘."
                  totalCount={filteredSaveImages.length}
                  selectedCount={selectedSaveIds.length}
                  items={filteredSaveImages}
                  selectedIds={selectedSaveIds}
                  onSelectedIdsChange={setSelectedSaveIds}
                  onSearchChange={setSaveSearch}
                  isLoading={saveImagesQuery.isLoading}
                />
              </div>
              <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
                <ImageAttachmentSelectionCard
                  image={activeSelectedImage}
                  sourceLabel="Save 폴더"
                  isImporting={isImporting}
                  onCancel={() => setIsOpen(false)}
                  onConfirm={() => void handleImportExistingImage(activeSelectedImage)}
                />
              </div>
            </div>
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
