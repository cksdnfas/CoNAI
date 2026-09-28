import type { ChangeEvent, DragEvent, RefObject } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, Copy, ExternalLink, File, FileDown, ImageDown, RefreshCw, RotateCcw, Trash2, Video } from 'lucide-react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { MediaFileDropSurface } from '@/components/media/media-file-drop-surface'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { MetadataRewriteForm } from '@/features/metadata/components/metadata-rewrite-form'
import { useHomeSearch, type TextSearchScope } from '@/features/home/home-search-context'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { buildImageSourceState } from '@/features/images/image-source-navigation'
import type { RewriteMetadataDraft } from '@/features/metadata/use-metadata-rewrite-draft'
import { useI18n } from '@/i18n'
import { formatBytes } from '@/features/images/components/detail/image-detail-utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getThemeToneTextStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import { getUploadResultDetailPath } from '../upload-result-links'
import { getVisibleUploadResultLists } from '../upload-result-list'
import { useLocalFilePreviews, type LocalFilePreview } from '../use-local-file-previews'
import type { UploadBatchResult } from '@/lib/api-images'
import type { UploadFlowProgress } from '../use-upload-page-upload-flow'
import type { AutoTestTaggerResult } from '@/lib/api-settings-tagger'
import type { AutoTestKaloscopeResult } from '@/lib/api-settings-kaloscope'
import type { ExtractedPromptActionScope, ExtractedPromptCardItem } from '@/lib/image-extracted-prompts'
import type { ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@conai/shared'

const MAX_VISIBLE_FILES = 6

/** Format image dimensions into a compact width×height label. */
function formatDimensions(width?: number | null, height?: number | null) {
  if (!width || !height) return '—'
  return `${width} × ${height}`
}

function getTextSearchScopeForExtractedPrompt(scope: ExtractedPromptActionScope): TextSearchScope {
  if (scope === 'negative') {
    return 'negative'
  }

  if (scope === 'lora') {
    return 'lora'
  }

  return 'positive'
}

/** Turn a MIME type such as "image/png" into a friendly label like "PNG image". */
function describeFileType(file: File, t: ReturnType<typeof useI18n>['t']): string {
  const [kind = '', subtype = ''] = file.type.split('/')
  const extension = file.name.includes('.') ? file.name.split('.').pop() ?? '' : ''
  const format = (subtype.replace(/^x-/, '').replace(/\+.*$/, '') || extension).toUpperCase()
  if (!format) {
    return '—'
  }
  if (kind === 'image') {
    return t({ ko: '{format} 이미지', en: '{format} image' }, { format })
  }
  if (kind === 'video') {
    return t({ ko: '{format} 동영상', en: '{format} video' }, { format })
  }
  return t({ ko: '{format} 파일', en: '{format} file' }, { format })
}

/** Render a compact summary tile for upload or extraction metadata. */
function SummaryTile({
  label,
  value,
  copyValue,
}: {
  label: string
  value: string
  copyValue?: string | null
}) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()

  const handleCopy = async () => {
    if (!copyValue) {
      return
    }

    try {
      await copyTextToClipboard(copyValue)
      showSnackbar({ message: t({ ko: '{label} 값을 복사했어.', en: '{label} value copied.' }, { label }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '{label} 복사에 실패했어.', en: '{label} copy failed.' }, { label }), tone: 'error' })
    }
  }

  return (
    <Inset className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Text as="div" variant="overline">{label}</Text>
        {copyValue ? (
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={() => void handleCopy()}
            label={t({ ko: '{label} 복사', en: 'Copy {label}' }, { label })}
          >
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
      </div>
      <div className="mt-2 min-w-0 whitespace-pre-wrap break-all text-sm text-foreground">{value}</div>
    </Inset>
  )
}

/** Render the upload-progress bar used by the upload panel. */
function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-container">
      <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Render one compact local file preview with accessible removal. */
function UploadFilePreviewTile({
  preview,
  disabled,
  removeLabel,
  onRemove,
}: {
  preview: LocalFilePreview
  disabled: boolean
  removeLabel: string
  onRemove: () => void
}) {
  const isVideo = preview.file.type.startsWith('video/')

  return (
    <Panel tone="container" padding="none" className="relative min-w-0 overflow-hidden">
      {preview.url ? (
        <InlineMediaPreview
          src={preview.url}
          mimeType={preview.file.type}
          fileName={preview.file.name}
          alt={preview.file.name}
          frameClassName="aspect-square w-full rounded-none p-0"
          mediaClassName="h-full max-h-none w-full object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-surface-lowest text-muted-foreground">
          {isVideo ? <Video className="h-8 w-8" /> : <File className="h-8 w-8" />}
        </div>
      )}

      <IconButton
        variant="destructive"
        size="icon-xs"
        className="absolute right-2 top-2 shadow-elevation-1"
        disabled={disabled}
        onClick={onRemove}
        label={removeLabel}
      >
        <Trash2 />
      </IconButton>

      <div className="space-y-1 p-2">
        <div className="truncate text-xs text-foreground" title={preview.file.name}>{preview.file.name}</div>
        <div className="text-2xs text-muted-foreground">{formatBytes(preview.file.size)}</div>
      </div>
    </Panel>
  )
}

/** Render the upload half of the upload page. */
export function UploadPageUploadSection({
  uploadInputRef,
  uploadAccept,
  uploadFiles,
  uploadResult,
  uploadError,
  uploadProgress,
  uploadPercent,
  processPercent,
  uploadTotalSize,
  isUploading,
  uploadDropZone,
  onUploadFileChange,
  onRemoveUploadFile,
  onResetUpload,
  onUpload,
}: {
  uploadInputRef: RefObject<HTMLInputElement | null>
  uploadAccept: string
  uploadFiles: File[]
  uploadResult: UploadBatchResult | null
  uploadError: string | null
  uploadProgress: UploadFlowProgress | null
  uploadPercent: number
  processPercent: number
  uploadTotalSize: number
  isUploading: boolean
  uploadDropZone: {
    isDragActive: boolean
    handleDrop: (event: DragEvent<HTMLButtonElement>) => void
    handleDragEnter: (event: DragEvent<HTMLButtonElement>) => void
    handleDragOver: (event: DragEvent<HTMLButtonElement>) => void
    handleDragLeave: (event: DragEvent<HTMLButtonElement>) => void
  }
  onUploadFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onRemoveUploadFile: (index: number) => void
  onResetUpload: () => void
  onUpload: () => void
}) {
  const { t, formatNumber } = useI18n()
  const location = useLocation()
  const uploadFilePreviews = useLocalFilePreviews(uploadFiles, MAX_VISIBLE_FILES)
  const uploadResultItems = uploadResult ? getVisibleUploadResultLists(uploadResult, MAX_VISIBLE_FILES) : null

  return (
    <Section
      heading={t('uploadPageSections.fileUpload')}
      actions={
        <>
          <IconButton
            variant="ghost"
            onClick={onResetUpload}
            disabled={uploadFiles.length === 0 && !uploadResult && !uploadError}
            label={t({ ko: '초기화', en: 'Reset' })}
          >
            <RotateCcw />
          </IconButton>
          <Button type="button" onClick={onUpload} disabled={uploadFiles.length === 0 || isUploading}>
            {isUploading ? t('uploadPageSections.uploading') : t({ ko: '업로드{count}', en: 'Upload{count}' }, { count: uploadFiles.length > 0 ? ` (${formatNumber(uploadFiles.length)})` : '' })}
          </Button>
        </>
      }
    >
      <input ref={uploadInputRef} type="file" multiple accept={uploadAccept} className="hidden" onChange={onUploadFileChange} />

      <MediaFileDropSurface
        ariaLabel={t('uploadPageSections.chooseFilesToUpload')}
        active={uploadDropZone.isDragActive}
        onClick={() => uploadInputRef.current?.click()}
        onDrop={uploadDropZone.handleDrop}
        onDragEnter={uploadDropZone.handleDragEnter}
        onDragOver={uploadDropZone.handleDragOver}
        onDragLeave={uploadDropZone.handleDragLeave}
      />

      {uploadFiles.length > 0 ? (
        <Inset className="space-y-3">
          <div className="text-xs text-muted-foreground">{formatBytes(uploadTotalSize)}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {uploadFilePreviews.slice(0, MAX_VISIBLE_FILES).map((preview, index) => (
              <UploadFilePreviewTile
                key={preview.key}
                preview={preview}
                disabled={isUploading}
                removeLabel={t('uploadPageSections.removeFileFromUpload', { fileName: preview.file.name })}
                onRemove={() => onRemoveUploadFile(index)}
              />
            ))}
          </div>
          {uploadFiles.length > MAX_VISIBLE_FILES ? <div className="text-xs text-muted-foreground">{t({ ko: '{count}개 더 있어', en: '…{count} more' }, { count: formatNumber(uploadFiles.length - MAX_VISIBLE_FILES) })}</div> : null}
        </Inset>
      ) : null}

      {(isUploading || uploadProgress || uploadResult) ? (
        <Inset className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="font-medium text-foreground">
              {uploadProgress?.phase === 'processing'
                ? t({ ko: '처리 중', en: 'Processing' })
                : uploadProgress?.phase === 'uploading'
                  ? t({ ko: '전송 중', en: 'Uploading' })
                  : t({ ko: '완료', en: 'Done' })}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t({ ko: '전송', en: 'Transfer' })} · {formatBytes(uploadProgress?.loaded ?? 0)} / {formatBytes(uploadProgress?.total ?? uploadTotalSize)}</span>
              <span>{uploadPercent}%</span>
            </div>
            <ProgressBar percent={uploadPercent} />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {t({ ko: '서버 처리', en: 'Server processing' })} · {t({ ko: '{processed}/{total}개', en: '{processed}/{total} files' }, {
                  processed: formatNumber(uploadProgress?.processedFiles ?? 0),
                  total: formatNumber(uploadProgress?.totalFiles ?? 0),
                })}
              </span>
              <span>{processPercent}%</span>
            </div>
            <ProgressBar percent={processPercent} />
          </div>
        </Inset>
      ) : null}

      {uploadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('uploadPageSections.uploadFailed')}</AlertTitle>
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {uploadResult ? (
        <Inset className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t({ ko: '성공 {count}', en: '{count} succeeded' }, { count: formatNumber(uploadResult.successful) })}</Badge>
            <Badge variant={uploadResult.failed_count > 0 ? 'destructive' : 'secondary'}>{t({ ko: '실패 {count}', en: '{count} failed' }, { count: formatNumber(uploadResult.failed_count) })}</Badge>
          </div>

          {uploadResult.uploaded.length > 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {uploadResultItems?.uploaded.visible.map((file) => {
                const detailPath = getUploadResultDetailPath(file)

                return (
                  <Panel key={`${file.filename}:${file.upload_date}`} tone="container" padding="none" className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 break-all text-foreground">{file.original_name}</div>
                      {detailPath ? (
                        <IconButton asChild variant="ghost" size="icon-xs" label={t({ ko: '상세 열기', en: 'Open details' })}>
                          <Link to={detailPath} state={buildImageSourceState(location)}>
                            <ExternalLink />
                          </Link>
                        </IconButton>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs">{formatDimensions(file.width, file.height)} · {formatBytes(file.file_size)}</div>
                  </Panel>
                )
              })}
              {uploadResultItems && uploadResultItems.uploaded.hiddenCount > 0 ? (
                <div className="text-xs">{t({ ko: '저장된 파일 {count}개 더 있어', en: '…{count} more saved' }, { count: formatNumber(uploadResultItems.uploaded.hiddenCount) })}</div>
              ) : null}
            </div>
          ) : null}

          {uploadResult.failed.length > 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {uploadResultItems?.failed.visible.map((file) => (
                <Panel key={`${file.filename}:${file.error}`} tone="container" padding="none" className="px-3 py-3">
                  <div className="break-all text-foreground">{file.filename}</div>
                  <div className="mt-1 text-xs" style={getThemeToneTextStyle('negative')}>{file.error}</div>
                </Panel>
              ))}
              {uploadResultItems && uploadResultItems.failed.hiddenCount > 0 ? (
                <div className="text-xs">{t({ ko: '실패한 파일 {count}개 더 있어', en: '…{count} more failed' }, { count: formatNumber(uploadResultItems.failed.hiddenCount) })}</div>
              ) : null}
            </div>
          ) : null}
        </Inset>
      ) : null}
    </Section>
  )
}

/** Render the preview/extract half of the upload page. */
export function UploadPageExtractSection({
  extractInputRef,
  imageAccept,
  extractFile,
  extractPreviewUrl,
  extractResult,
  taggerResult,
  kaloscopeResult,
  extractError,
  activeExtractAction,
  selectedExtractAction,
  isConvertingWebP,
  isRewritingMetadata,
  isRewritePanelOpen,
  rewriteDraft,
  extractBusy,
  isDesktopPageLayout,
  extractedPromptCards,
  extractedGenerationParamItems,
  extractDropZone,
  onExtractFileChange,
  onResetExtract,
  onConvertWebP,
  onRewriteMetadata,
  onSelectedExtractActionChange,
  onRunSelectedExtract,
  onToggleRewritePanel,
  onRewriteDraftChange,
}: {
  extractInputRef: RefObject<HTMLInputElement | null>
  imageAccept: string
  extractFile: File | null
  extractPreviewUrl: string | null
  extractResult: ImageRecord | null
  taggerResult: AutoTestTaggerResult | null
  kaloscopeResult: AutoTestKaloscopeResult | null
  extractError: string | null
  activeExtractAction: 'prompt' | 'tagger' | 'kaloscope' | 'all' | null
  selectedExtractAction: 'all' | 'tagger' | 'kaloscope'
  isConvertingWebP: boolean
  isRewritingMetadata: boolean
  isRewritePanelOpen: boolean
  rewriteDraft: RewriteMetadataDraft
  extractBusy: boolean
  isDesktopPageLayout: boolean
  extractedPromptCards: ExtractedPromptCardItem[]
  extractedGenerationParamItems: { id: string; label: string; value: string }[]
  extractDropZone: {
    isDragActive: boolean
    handleDrop: (event: DragEvent<HTMLButtonElement>) => void
    handleDragEnter: (event: DragEvent<HTMLButtonElement>) => void
    handleDragOver: (event: DragEvent<HTMLButtonElement>) => void
    handleDragLeave: (event: DragEvent<HTMLButtonElement>) => void
  }
  onExtractFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onResetExtract: () => void
  onConvertWebP: () => void
  onRewriteMetadata: () => void
  onSelectedExtractActionChange: (value: 'all' | 'tagger' | 'kaloscope') => void
  onRunSelectedExtract: () => void
  onToggleRewritePanel: () => void
  onRewriteDraftChange: (patch: Record<string, unknown>) => void
}) {
  const { t } = useI18n()
  const { addScopedTextChip } = useHomeSearch()

  const handleAddExtractedPromptSearchFilter = (scope: ExtractedPromptActionScope, tag: string) => {
    addScopedTextChip(getTextSearchScopeForExtractedPrompt(scope), tag, { apply: true })
  }

  const handleAddAutoPromptSearchFilter = (tag: string) => {
    addScopedTextChip('auto', tag, { apply: true })
  }

  return (
    <Section
      heading={t('uploadPageSections.previewExtract')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <IconButton variant="ghost" onClick={onResetExtract} disabled={!extractFile && !extractResult && !taggerResult && !kaloscopeResult && !extractError} label={t({ ko: '초기화', en: 'Reset' })}>
            <RotateCcw />
          </IconButton>
          <IconButton variant="secondary" onClick={onConvertWebP} disabled={!extractFile || extractBusy} label={isConvertingWebP ? t('uploadPageSections.convertingWebp') : t('uploadPageSections.convertWebp')}>
            <ImageDown />
          </IconButton>
          <IconButton variant="secondary" onClick={onRewriteMetadata} disabled={!extractFile || extractBusy} label={isRewritingMetadata ? t('uploadPageSections.editingMetadata') : t('uploadPageSections.editMetadata')}>
            <FileDown />
          </IconButton>
          <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 sm:flex-none">
            <Select
              className="min-w-[140px] flex-1 sm:w-40 sm:flex-none"
              value={selectedExtractAction}
              onChange={(event) => onSelectedExtractActionChange(event.target.value as 'all' | 'tagger' | 'kaloscope')}
              disabled={!extractFile || extractBusy}
            >
              <option value="all">{t('uploadPageSections.extractAll')}</option>
              <option value="tagger">{t('uploadPageSections.autoExtract')}</option>
              <option value="kaloscope">{t('uploadPageSections.artistExtract')}</option>
            </Select>
            <Button type="button" onClick={onRunSelectedExtract} disabled={!extractFile || extractBusy}>
              {activeExtractAction === selectedExtractAction ? t('uploadPageSections.extracting') : t('uploadPageSections.runExtract')}
            </Button>
          </div>
        </div>
      }
    >
      <input ref={extractInputRef} type="file" accept={imageAccept} className="hidden" onChange={onExtractFileChange} />

      <MediaFileDropSurface
        ariaLabel={t('uploadPageSections.chooseAnImageToPreview')}
        active={extractDropZone.isDragActive}
        onClick={() => extractInputRef.current?.click()}
        onDrop={extractDropZone.handleDrop}
        onDragEnter={extractDropZone.handleDragEnter}
        onDragOver={extractDropZone.handleDragOver}
        onDragLeave={extractDropZone.handleDragLeave}
        actions={extractFile ? (
          <>
            <IconButton
              variant="ghost"
              size="icon-sm"
              onClick={() => extractInputRef.current?.click()}
              label={t('uploadPageSections.replaceSelectedImage')}
            >
              <RefreshCw />
            </IconButton>
            <IconButton
              variant="destructive"
              size="icon-sm"
              onClick={onResetExtract}
              label={t('uploadPageSections.removeSelectedImage')}
            >
              <Trash2 />
            </IconButton>
          </>
        ) : undefined}
      >
        {extractFile && extractPreviewUrl ? (
          <InlineMediaPreview
            src={extractPreviewUrl}
            mimeType={extractFile.type}
            fileName={extractFile.name}
            alt={extractFile.name}
            frameClassName="w-full bg-transparent p-0"
            mediaClassName="max-h-[420px] w-full object-contain"
          />
        ) : undefined}
      </MediaFileDropSurface>

      {extractFile ? (
        <div className={cn('grid gap-4', isDesktopPageLayout ? 'grid-cols-2 items-start' : 'grid-cols-1')}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-3">
              <SummaryTile label={t({ ko: '파일', en: 'File' })} value={extractFile.name} />
              <SummaryTile label={t({ ko: '크기', en: 'Size' })} value={formatBytes(extractFile.size)} />
              <SummaryTile label={t({ ko: '형식', en: 'Type' })} value={describeFileType(extractFile, t)} />
            </div>
          </div>

          <div className="space-y-4">
            <Inset className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">{t('uploadPageSections.editMetadata')}</div>
                <IconButton variant="ghost" size="icon-sm" onClick={onToggleRewritePanel} aria-expanded={isRewritePanelOpen} label={isRewritePanelOpen ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}>
                  <ChevronDown className={cn('transition-transform', !isRewritePanelOpen && '-rotate-90')} />
                </IconButton>
              </div>

              {isRewritePanelOpen ? (
                <div className="pt-2">
                  <MetadataRewriteForm draft={rewriteDraft} disabled={extractBusy} showHeader={false} onDraftChange={onRewriteDraftChange} />
                </div>
              ) : null}
            </Inset>

            {extractResult ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                  <SummaryTile label={t({ ko: '해상도', en: 'Dimensions' })} value={formatDimensions(extractResult.width, extractResult.height)} />
                  <SummaryTile label={t({ ko: '크기', en: 'Size' })} value={formatBytes(extractResult.file_size)} />
                  <SummaryTile label={t({ ko: '생성 도구', en: 'Tool' })} value={extractResult.ai_metadata?.ai_tool || '—'} />
                  <SummaryTile label={t({ ko: '모델', en: 'Model' })} value={extractResult.ai_metadata?.model_name || '—'} />
                  {extractedGenerationParamItems.map((item) => (
                    <SummaryTile key={item.id} label={item.label} value={item.value} copyValue={item.value} />
                  ))}
                </div>

                {extractResult.ai_metadata?.lora_models?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {extractResult.ai_metadata.lora_models.map((item) => (
                      <Badge key={item} variant="secondary" className="normal-case tracking-normal">
                        {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {extractedPromptCards.length > 0 ? (
                  <ExtractedPromptSections items={extractedPromptCards} onAddSearchFilter={handleAddExtractedPromptSearchFilter} />
                ) : (
                  <Inset className="text-sm text-muted-foreground">{t({ ko: '표시할 프롬프트가 없어.', en: 'No prompts to show.' })}</Inset>
                )}
              </div>
            ) : null}

            {taggerResult ? <WDTaggerResultBlock result={taggerResult} title={t({ ko: '자동', en: 'Auto' })} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
            {kaloscopeResult ? <KaloscopeResultBlock result={kaloscopeResult} title={t({ ko: '작가', en: 'Artist' })} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
          </div>
        </div>
      ) : null}

      {extractError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('uploadPageSections.extractionFailed')}</AlertTitle>
          <AlertDescription>{extractError}</AlertDescription>
        </Alert>
      ) : null}
    </Section>
  )
}

/** Render the image-save-options modal used by the upload flow. */
export function UploadPageSaveOptionsModal({
  open,
  options,
  sourceInfo,
  isSaving,
  onClose,
  onOptionsChange,
  onConfirm,
}: {
  open: boolean
  options: ImageSaveSettings
  sourceInfo: ImageSaveSourceInfo | null
  isSaving: boolean
  onClose: () => void
  onOptionsChange: (patch: Partial<ImageSaveSettings>) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()

  return (
    <ImageSaveOptionsModal
      open={open}
      title={t('uploadPageSections.saveImage')}
      options={options}
      sourceInfo={sourceInfo}
      isSaving={isSaving}
      onClose={onClose}
      onOptionsChange={onOptionsChange}
      onConfirm={onConfirm}
    />
  )
}
