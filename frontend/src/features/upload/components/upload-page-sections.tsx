import type { ChangeEvent, DragEvent, RefObject } from 'react'
import { Copy, Download, Image as ImageIcon } from 'lucide-react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { MetadataRewriteForm } from '@/features/metadata/components/metadata-rewrite-form'
import { formatBytes } from '@/features/images/components/detail/image-detail-utils'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getThemeToneTextStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { AutoTestKaloscopeResult, AutoTestTaggerResult, UploadBatchResult, UploadTransferProgress } from '@/lib/api'
import type { ExtractedPromptCardItem } from '@/lib/image-extracted-prompts'
import type { ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@/types/settings'

const MAX_VISIBLE_FILES = 6

/** Format image dimensions into a compact width×height label. */
function formatDimensions(width?: number | null, height?: number | null) {
  if (!width || !height) return '—'
  return `${width} × ${height}`
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

  const handleCopy = async () => {
    if (!copyValue) {
      return
    }

    try {
      await copyTextToClipboard(copyValue)
      showSnackbar({ message: `${label} 값을 복사했어.`, tone: 'info' })
    } catch {
      showSnackbar({ message: `${label} 복사에 실패했어.`, tone: 'error' })
    }
  }

  return (
    <PageInset className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        {copyValue ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-primary"
            onClick={() => void handleCopy()}
            aria-label={`${label} 복사`}
            title={`${label} 복사`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 min-w-0 whitespace-pre-wrap break-all text-sm text-foreground">{value}</div>
    </PageInset>
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

/** Render a reusable drag/drop click target for upload and extract surfaces. */
export function DropSurface({
  active,
  ariaLabel,
  onClick,
  onDrop,
  onDragEnter,
  onDragOver,
  onDragLeave,
}: {
  active: boolean
  ariaLabel: string
  onClick: () => void
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnter: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={[
        'flex h-44 w-full items-center justify-center rounded-sm border-2 border-dashed transition-colors',
        active ? 'border-primary bg-primary/6' : 'border-border bg-surface-low hover:border-primary/30 hover:bg-surface-high/60',
      ].join(' ')}
    >
      <ImageIcon className={active ? 'h-12 w-12 text-primary' : 'h-12 w-12 text-muted-foreground'} />
    </button>
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
  uploadTotalSize,
  isUploading,
  uploadDropZone,
  onUploadFileChange,
  onResetUpload,
  onUpload,
}: {
  uploadInputRef: RefObject<HTMLInputElement | null>
  uploadAccept: string
  uploadFiles: File[]
  uploadResult: UploadBatchResult | null
  uploadError: string | null
  uploadProgress: UploadTransferProgress | null
  uploadPercent: number
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
  onResetUpload: () => void
  onUpload: () => void
}) {
  return (
    <PageSection
      title="파일 업로드"
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onResetUpload}
            disabled={uploadFiles.length === 0 && !uploadResult && !uploadError}
          >
            초기화
          </Button>
          <Button type="button" onClick={onUpload} disabled={uploadFiles.length === 0 || isUploading}>
            {isUploading ? '업로드 중…' : `업로드${uploadFiles.length > 0 ? ` (${uploadFiles.length})` : ''}`}
          </Button>
        </>
      }
    >
      <input ref={uploadInputRef} type="file" multiple accept={uploadAccept} className="hidden" onChange={onUploadFileChange} />

      <DropSurface
        ariaLabel="업로드할 파일 선택"
        active={uploadDropZone.isDragActive}
        onClick={() => uploadInputRef.current?.click()}
        onDrop={uploadDropZone.handleDrop}
        onDragEnter={uploadDropZone.handleDragEnter}
        onDragOver={uploadDropZone.handleDragOver}
        onDragLeave={uploadDropZone.handleDragLeave}
      />

      {uploadFiles.length > 0 ? (
        <PageInset className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{uploadFiles.length}개</Badge>
            <Badge variant="outline">{formatBytes(uploadTotalSize)}</Badge>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            {uploadFiles.slice(0, MAX_VISIBLE_FILES).map((file) => (
              <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center justify-between gap-3 rounded-sm border border-border/70 bg-background/50 px-3 py-2">
                <span className="min-w-0 truncate text-foreground">{file.name}</span>
                <span className="shrink-0 text-xs">{formatBytes(file.size)}</span>
              </div>
            ))}
            {uploadFiles.length > MAX_VISIBLE_FILES ? <div className="text-xs">…{uploadFiles.length - MAX_VISIBLE_FILES}개 더 있음</div> : null}
          </div>
        </PageInset>
      ) : null}

      {(isUploading || uploadProgress || uploadResult) ? (
        <PageInset className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="font-medium text-foreground">진행률</div>
            <div className="text-muted-foreground">{uploadPercent}%</div>
          </div>
          <ProgressBar percent={uploadPercent} />
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{formatBytes(uploadProgress?.loaded ?? 0)}</span>
            <span>/</span>
            <span>{formatBytes(uploadProgress?.total ?? uploadTotalSize)}</span>
          </div>
        </PageInset>
      ) : null}

      {uploadError ? (
        <Alert variant="destructive">
          <AlertTitle>업로드 실패</AlertTitle>
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {uploadResult ? (
        <PageInset className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">성공 {uploadResult.successful}</Badge>
            <Badge variant={uploadResult.failed_count > 0 ? 'outline' : 'secondary'}>실패 {uploadResult.failed_count}</Badge>
          </div>

          {uploadResult.uploaded.length > 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {uploadResult.uploaded.slice(0, MAX_VISIBLE_FILES).map((file) => (
                <div key={`${file.filename}:${file.upload_date}`} className="rounded-sm border border-border/70 bg-background/50 px-3 py-3">
                  <div className="break-all text-foreground">{file.original_name}</div>
                  <div className="mt-1 text-xs">{formatDimensions(file.width, file.height)} · {formatBytes(file.file_size)}</div>
                </div>
              ))}
            </div>
          ) : null}

          {uploadResult.failed.length > 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {uploadResult.failed.map((file) => (
                <div key={`${file.filename}:${file.error}`} className="rounded-sm border border-border/70 bg-background/50 px-3 py-3">
                  <div className="break-all text-foreground">{file.filename}</div>
                  <div className="mt-1 text-xs" style={getThemeToneTextStyle('negative')}>{file.error}</div>
                </div>
              ))}
            </div>
          ) : null}
        </PageInset>
      ) : null}
    </PageSection>
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
  rewriteDraft: any
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
  return (
    <PageSection
      title="미리보기 / 추출"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={onResetExtract} disabled={!extractFile && !extractResult && !taggerResult && !kaloscopeResult && !extractError}>
            초기화
          </Button>
          <Button type="button" variant="outline" onClick={onConvertWebP} disabled={!extractFile || extractBusy}>
            <Download className="h-4 w-4" />
            {isConvertingWebP ? 'WebP 변환 중…' : 'WebP 변환'}
          </Button>
          <Button type="button" variant="outline" onClick={onRewriteMetadata} disabled={!extractFile || extractBusy}>
            <Download className="h-4 w-4" />
            {isRewritingMetadata ? '메타 수정 중…' : '메타 수정'}
          </Button>
          <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 sm:flex-none">
            <Select
              className="min-w-[140px] flex-1 sm:w-40 sm:flex-none"
              value={selectedExtractAction}
              onChange={(event) => onSelectedExtractActionChange(event.target.value as 'all' | 'tagger' | 'kaloscope')}
              disabled={!extractFile || extractBusy}
            >
              <option value="all">전체 추출</option>
              <option value="tagger">자동 추출</option>
              <option value="kaloscope">작가 추출</option>
            </Select>
            <Button type="button" onClick={onRunSelectedExtract} disabled={!extractFile || extractBusy}>
              {activeExtractAction === selectedExtractAction ? '추출 중…' : '추출 실행'}
            </Button>
          </div>
        </div>
      }
    >
      <input ref={extractInputRef} type="file" accept={imageAccept} className="hidden" onChange={onExtractFileChange} />

      <PageInset className="px-0 py-0">
        <DropSurface
          ariaLabel="미리보기할 이미지 선택"
          active={extractDropZone.isDragActive}
          onClick={() => extractInputRef.current?.click()}
          onDrop={extractDropZone.handleDrop}
          onDragEnter={extractDropZone.handleDragEnter}
          onDragOver={extractDropZone.handleDragOver}
          onDragLeave={extractDropZone.handleDragLeave}
        />
      </PageInset>

      {extractFile ? (
        <div className={cn('grid gap-4', isDesktopPageLayout ? 'grid-cols-2 items-start' : 'grid-cols-1')}>
          <div className="space-y-4">
            <PageInset className="space-y-4">
              {extractPreviewUrl ? (
                <div className="overflow-hidden rounded-sm border border-border/70 bg-background/50 p-4">
                  <img src={extractPreviewUrl} alt={extractFile.name} className="max-h-[420px] w-full object-contain" />
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-3">
                <SummaryTile label="file" value={extractFile.name} />
                <SummaryTile label="size" value={formatBytes(extractFile.size)} />
                <SummaryTile label="type" value={extractFile.type || '—'} />
              </div>
            </PageInset>
          </div>

          <div className="space-y-4">
            <PageInset className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">메타 수정</div>
                <Button type="button" variant="ghost" size="sm" onClick={onToggleRewritePanel}>
                  {isRewritePanelOpen ? '접기' : '펼치기'}
                </Button>
              </div>

              {isRewritePanelOpen ? (
                <div className="border-t border-border pt-4">
                  <MetadataRewriteForm draft={rewriteDraft} disabled={extractBusy} showHeader={false} onDraftChange={onRewriteDraftChange} />
                </div>
              ) : null}
            </PageInset>

            {extractResult ? (
              <PageInset className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                  <SummaryTile label="dimensions" value={formatDimensions(extractResult.width, extractResult.height)} />
                  <SummaryTile label="size" value={formatBytes(extractResult.file_size)} />
                  <SummaryTile label="tool" value={extractResult.ai_metadata?.ai_tool || '—'} />
                  <SummaryTile label="model" value={extractResult.ai_metadata?.model_name || '—'} />
                  {extractedGenerationParamItems.map((item) => (
                    <SummaryTile key={item.id} label={item.label} value={item.value} copyValue={item.value} />
                  ))}
                </div>

                {extractResult.ai_metadata?.lora_models?.length ? (
                  <div className="rounded-sm border border-border/70 bg-background/50 p-4">
                    <div className="flex flex-wrap gap-2">
                      {extractResult.ai_metadata.lora_models.map((item) => (
                        <Badge key={item} variant="outline">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {extractedPromptCards.length > 0 ? (
                  <div className="rounded-sm border border-border/70 bg-background/50 p-4">
                    <ExtractedPromptSections items={extractedPromptCards} />
                  </div>
                ) : (
                  <PageInset className="text-sm text-muted-foreground">표시할 프롬프트가 없어.</PageInset>
                )}
              </PageInset>
            ) : null}

            {taggerResult ? <WDTaggerResultBlock result={taggerResult} title="자동" /> : null}
            {kaloscopeResult ? <KaloscopeResultBlock result={kaloscopeResult} title="작가" /> : null}
          </div>
        </div>
      ) : null}

      {extractError ? (
        <Alert variant="destructive">
          <AlertTitle>추출 실패</AlertTitle>
          <AlertDescription>{extractError}</AlertDescription>
        </Alert>
      ) : null}
    </PageSection>
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
  return (
    <ImageSaveOptionsModal
      open={open}
      title="이미지 저장"
      options={options}
      sourceInfo={sourceInfo}
      isSaving={isSaving}
      onClose={onClose}
      onOptionsChange={onOptionsChange}
      onConfirm={onConfirm}
    />
  )
}
