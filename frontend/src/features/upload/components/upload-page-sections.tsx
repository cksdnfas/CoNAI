import { useMemo, type DragEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Check, ChevronDown, Copy, ExternalLink, File as FileIcon, ImagePlus, Video, X } from 'lucide-react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Panel } from '@/components/ui/panel'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { MetadataRewriteForm } from '@/features/metadata/components/metadata-rewrite-form'
import { useHomeSearch, type TextSearchScope } from '@/features/home/home-search-context'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { buildImageSourceState } from '@/features/images/image-source-navigation'
import type { RewriteMetadataDraft } from '@/features/metadata/use-metadata-rewrite-draft'
import { useI18n } from '@/i18n'
import { formatBytes } from '@/features/images/components/detail/image-detail-utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { getUploadResultDetailPath } from '../upload-result-links'
import { getVisibleUploadResultLists } from '../upload-result-list'
import { getUploadQueueFileStates, type UploadQueueFileState } from '../upload-queue-progress'
import { useLocalFilePreviews, type LocalFilePreview } from '../use-local-file-previews'
import type { UploadBatchResult } from '@/lib/api-images'
import type { UploadFlowProgress } from '../use-upload-page-upload-flow'
import type { AutoTestTaggerResult } from '@/lib/api-settings-tagger'
import type { AutoTestKaloscopeResult } from '@/lib/api-settings-kaloscope'
import type { ExtractedPromptActionScope, ExtractedPromptCardItem } from '@/lib/image-extracted-prompts'
import type { ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@conai/shared'

const MAX_VISIBLE_FILES = 60
const MAX_VISIBLE_RESULTS = 12

type DropZoneHandlers = {
  isDragActive: boolean
  handleDrop: (event: DragEvent<HTMLButtonElement>) => void
  handleDragEnter: (event: DragEvent<HTMLButtonElement>) => void
  handleDragOver: (event: DragEvent<HTMLButtonElement>) => void
  handleDragLeave: (event: DragEvent<HTMLButtonElement>) => void
}

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

/** The page's one drop target: a quiet filled area (no dashed box); a primary ring while files hover over it. */
export function UploadDropZone({
  ariaLabel,
  dropZone,
  onClick,
  children,
}: {
  ariaLabel: string
  dropZone: DropZoneHandlers
  onClick: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()

  return (
    <Panel
      asChild
      tone="none"
      padding="none"
      radius="md"
      interactive
      className={cn(
        'bg-fill',
        dropZone.isDragActive && 'bg-primary/6 ring-2 ring-primary/50 ring-inset hover:bg-primary/6',
      )}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        onDrop={dropZone.handleDrop}
        onDragEnter={dropZone.handleDragEnter}
        onDragOver={dropZone.handleDragOver}
        onDragLeave={dropZone.handleDragLeave}
        className="flex min-h-48 w-full items-center justify-center overflow-hidden p-3"
      >
        {children ?? (
          <span className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
            <ImagePlus className={cn('size-7', dropZone.isDragActive ? 'text-primary' : 'text-muted-foreground/70')} aria-hidden />
            {t({ ko: '끌어다 놓거나 눌러서 고르기', en: 'Drop files or click to choose' })}
          </span>
        )}
      </button>
    </Panel>
  )
}

/** Thin inline progress bar for one queue row. */
function RowProgress({ percent, tone = 'primary', className }: { percent: number; tone?: 'primary' | 'destructive'; className?: string }) {
  return (
    <span className={cn('block h-1 w-44 overflow-hidden rounded-full bg-fill', className)} aria-hidden>
      <span
        className={cn('block h-full rounded-full transition-[width] duration-200', tone === 'destructive' ? 'bg-destructive' : 'bg-primary')}
        style={{ width: `${percent}%` }}
      />
    </span>
  )
}

function QueueThumb({ preview }: { preview?: LocalFilePreview }) {
  const isVideo = preview?.file.type.startsWith('video/')

  if (preview?.url && !isVideo) {
    return <img src={preview.url} alt="" loading="lazy" decoding="async" className="size-10 shrink-0 rounded-sm bg-fill object-cover" />
  }

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-fill text-muted-foreground">
      {isVideo ? <Video className="size-4" /> : <FileIcon className="size-4" />}
    </span>
  )
}

function useStatusLabel() {
  const { t } = useI18n()
  return (state: UploadQueueFileState) => {
    switch (state.status) {
      case 'uploading':
        return t({ ko: '전송 중', en: 'Sending' })
      case 'processing':
        return t({ ko: '처리 중', en: 'Processing' })
      case 'done':
        return t({ ko: '완료', en: 'Done' })
      case 'failed':
        return t({ ko: '실패', en: 'Failed' })
      default:
        return t({ ko: '대기', en: 'Waiting' })
    }
  }
}

/** Queue of picked files plus the last run's saved files, as hairline rows with inline progress. */
export function UploadQueueList({
  uploadFiles,
  uploadRunFiles,
  uploadResult,
  uploadError,
  uploadProgress,
  uploadTotalSize,
  isUploading,
  onRemoveUploadFile,
}: {
  uploadFiles: File[]
  uploadRunFiles: File[]
  uploadResult: UploadBatchResult | null
  uploadError: string | null
  uploadProgress: UploadFlowProgress | null
  uploadTotalSize: number
  isUploading: boolean
  onRemoveUploadFile: (index: number) => void
}) {
  const { t, formatNumber } = useI18n()
  const location = useLocation()
  const getStatusLabel = useStatusLabel()
  const previews = useLocalFilePreviews(uploadFiles, MAX_VISIBLE_FILES)
  const states = useMemo(
    () => getUploadQueueFileStates(uploadFiles, uploadRunFiles, uploadProgress, uploadResult),
    [uploadFiles, uploadProgress, uploadResult, uploadRunFiles],
  )
  const savedItems = uploadResult ? getVisibleUploadResultLists(uploadResult, MAX_VISIBLE_RESULTS).uploaded : null
  const hasRows = uploadFiles.length > 0 || (savedItems?.visible.length ?? 0) > 0

  if (!hasRows && !uploadError) {
    return null
  }

  const summary = uploadProgress && uploadProgress.phase !== 'done'
    ? t(
      { ko: '전송 {percent}% · 처리 {processed}/{total}', en: 'Sent {percent}% · processed {processed}/{total}' },
      {
        percent: uploadProgress.percent ?? 0,
        processed: formatNumber(uploadProgress.processedFiles),
        total: formatNumber(uploadProgress.totalFiles),
      },
    )
    : uploadResult
      ? t({ ko: '저장 {successful} · 실패 {failed}', en: '{successful} saved · {failed} failed' }, {
        successful: formatNumber(uploadResult.successful),
        failed: formatNumber(uploadResult.failed_count),
      })
      : t({ ko: '{count}개 · {size}', en: '{count} files · {size}' }, { count: formatNumber(uploadFiles.length), size: formatBytes(uploadTotalSize) })

  return (
    <div className="space-y-4">
      {uploadError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('uploadPageSections.uploadFailed')}</AlertTitle>
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {hasRows ? (
        <div>
          <div className="flex h-8 items-center border-b border-line text-xs text-muted-foreground/75">{summary}</div>

          {uploadFiles.slice(0, MAX_VISIBLE_FILES).map((file, index) => {
            const state = states.get(file) ?? { status: 'waiting', percent: 0 }
            return (
              <ListRow
                key={previews[index]?.key ?? `${file.name}:${index}`}
                size="lg"
                leading={<QueueThumb preview={previews[index]} />}
                trailing={(
                  <>
                    <RowProgress percent={state.percent} tone={state.status === 'failed' ? 'destructive' : 'primary'} className="hidden sm:block" />
                    <span
                      className={cn(
                        'w-14 text-right text-xs',
                        state.status === 'done' && 'text-success',
                        state.status === 'failed' && 'text-destructive',
                      )}
                    >
                      {getStatusLabel(state)}
                    </span>
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      disabled={isUploading}
                      onClick={() => onRemoveUploadFile(index)}
                      label={t('uploadPageSections.removeFileFromUpload', { fileName: file.name })}
                    >
                      <X />
                    </IconButton>
                  </>
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate" title={file.name}>{file.name}</span>
                  <span className={cn('block truncate text-xs', state.error ? 'text-destructive' : 'text-muted-foreground')} title={state.error}>
                    {state.error ?? formatBytes(file.size)}
                  </span>
                  <RowProgress percent={state.percent} tone={state.status === 'failed' ? 'destructive' : 'primary'} className="mt-1.5 w-full sm:hidden" />
                </span>
              </ListRow>
            )
          })}
          {uploadFiles.length > MAX_VISIBLE_FILES ? (
            <ListRow size="sm">
              <span className="text-xs text-muted-foreground">{t({ ko: '{count}개 더 있어', en: '…{count} more' }, { count: formatNumber(uploadFiles.length - MAX_VISIBLE_FILES) })}</span>
            </ListRow>
          ) : null}

          {savedItems?.visible.map((file) => {
            const detailPath = getUploadResultDetailPath(file)
            return (
              <ListRow
                key={`${file.filename}:${file.upload_date}`}
                size="lg"
                leading={(
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-fill text-success">
                    <Check className="size-4" />
                  </span>
                )}
                trailing={(
                  <>
                    <RowProgress percent={100} className="hidden sm:block" />
                    <span className="w-14 text-right text-xs text-success">{t({ ko: '완료', en: 'Done' })}</span>
                    {detailPath ? (
                      <IconButton asChild variant="ghost" size="icon-xs" label={t({ ko: '상세 열기', en: 'Open details' })}>
                        <Link to={detailPath} state={buildImageSourceState(location)}>
                          <ExternalLink />
                        </Link>
                      </IconButton>
                    ) : <span className="size-6" />}
                  </>
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate" title={file.original_name}>{file.original_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatDimensions(file.width, file.height)} · {formatBytes(file.file_size)}</span>
                </span>
              </ListRow>
            )
          })}
          {savedItems && savedItems.hiddenCount > 0 ? (
            <ListRow size="sm">
              <span className="text-xs text-muted-foreground">{t({ ko: '저장된 파일 {count}개 더 있어', en: '…{count} more saved' }, { count: formatNumber(savedItems.hiddenCount) })}</span>
            </ListRow>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** One label / value row of the inspected file, with an optional copy key. */
function InfoRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string | null }) {
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
    <ListRow
      className="items-start"
      trailing={copyValue ? (
        <IconButton size="icon-xs" variant="ghost" onClick={() => void handleCopy()} label={t({ ko: '{label} 복사', en: 'Copy {label}' }, { label })}>
          <Copy />
        </IconButton>
      ) : undefined}
    >
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{value}</span>
    </ListRow>
  )
}

/** Preview inside the drop zone for the "metadata only" mode. */
export function UploadInspectPreview({ file, previewUrl }: { file: File; previewUrl: string }) {
  return (
    <InlineMediaPreview
      src={previewUrl}
      mimeType={file.type}
      fileName={file.name}
      alt={file.name}
      frameClassName="w-full bg-transparent p-0"
      mediaClassName="max-h-[420px] w-full object-contain"
    />
  )
}

/** Results of the "metadata only" mode: file info, generation info, prompts, tagger results, metadata editing. */
export function UploadInspectDetails({
  extractFile,
  extractResult,
  taggerResult,
  kaloscopeResult,
  extractError,
  isRewritePanelOpen,
  rewriteDraft,
  extractBusy,
  isDesktopPageLayout,
  extractedPromptCards,
  extractedGenerationParamItems,
  onToggleRewritePanel,
  onRewriteDraftChange,
}: {
  extractFile: File | null
  extractResult: ImageRecord | null
  taggerResult: AutoTestTaggerResult | null
  kaloscopeResult: AutoTestKaloscopeResult | null
  extractError: string | null
  isRewritePanelOpen: boolean
  rewriteDraft: RewriteMetadataDraft
  extractBusy: boolean
  isDesktopPageLayout: boolean
  extractedPromptCards: ExtractedPromptCardItem[]
  extractedGenerationParamItems: { id: string; label: string; value: string }[]
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
    <div className="space-y-6">
      {extractError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('uploadPageSections.extractionFailed')}</AlertTitle>
          <AlertDescription>{extractError}</AlertDescription>
        </Alert>
      ) : null}

      {extractFile ? (
        <div className={cn('grid gap-10', isDesktopPageLayout ? 'grid-cols-2 items-start' : 'grid-cols-1')}>
          <div className="space-y-8">
            <RowGroup headingAs="h2" heading={t({ ko: '파일', en: 'File' })}>
              <InfoRow label={t({ ko: '이름', en: 'Name' })} value={extractFile.name} />
              <InfoRow label={t({ ko: '크기', en: 'Size' })} value={formatBytes(extractFile.size)} />
              <InfoRow label={t({ ko: '형식', en: 'Type' })} value={describeFileType(extractFile, t)} />
            </RowGroup>

            {extractResult ? (
              <RowGroup headingAs="h2" heading={t({ ko: '생성 정보', en: 'Generation' })}>
                <InfoRow label={t({ ko: '해상도', en: 'Dimensions' })} value={formatDimensions(extractResult.width, extractResult.height)} />
                <InfoRow label={t({ ko: '생성 도구', en: 'Tool' })} value={extractResult.ai_metadata?.ai_tool || '—'} />
                <InfoRow label={t({ ko: '모델', en: 'Model' })} value={extractResult.ai_metadata?.model_name || '—'} />
                {extractedGenerationParamItems.map((item) => (
                  <InfoRow key={item.id} label={item.label} value={item.value} copyValue={item.value} />
                ))}
              </RowGroup>
            ) : null}

            {extractResult?.ai_metadata?.lora_models?.length ? (
              <RowGroup headingAs="h2" heading="LoRA">
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {extractResult.ai_metadata.lora_models.map((item) => (
                    <Chip key={item} size="sm">{item}</Chip>
                  ))}
                </div>
              </RowGroup>
            ) : null}

            <RowGroup
              headingAs="h2"
              heading={t('uploadPageSections.editMetadata')}
              actions={(
                <IconButton variant="ghost" size="icon-sm" onClick={onToggleRewritePanel} aria-expanded={isRewritePanelOpen} label={isRewritePanelOpen ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '펼치기', en: 'Expand' })}>
                  <ChevronDown className={cn('transition-transform', !isRewritePanelOpen && '-rotate-90')} />
                </IconButton>
              )}
            >
              {isRewritePanelOpen ? (
                <div className="pt-2">
                  <MetadataRewriteForm draft={rewriteDraft} disabled={extractBusy} showHeader={false} onDraftChange={onRewriteDraftChange} />
                </div>
              ) : null}
            </RowGroup>
          </div>

          <div className="space-y-8">
            {extractResult ? (
              extractedPromptCards.length > 0 ? (
                <ExtractedPromptSections items={extractedPromptCards} onAddSearchFilter={handleAddExtractedPromptSearchFilter} />
              ) : (
                <p className="text-sm text-muted-foreground">{t({ ko: '표시할 프롬프트가 없어.', en: 'No prompts to show.' })}</p>
              )
            ) : null}

            {taggerResult ? <WDTaggerResultBlock result={taggerResult} title={t({ ko: '자동', en: 'Auto' })} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
            {kaloscopeResult ? <KaloscopeResultBlock result={kaloscopeResult} title={t({ ko: '작가', en: 'Artist' })} onAddSearchFilter={handleAddAutoPromptSearchFilter} /> : null}
          </div>
        </div>
      ) : null}
    </div>
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
