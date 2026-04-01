import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Download, Image as ImageIcon } from 'lucide-react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { KaloscopeResultBlock } from '@/components/common/kaloscope-result-block'
import { PageHeader } from '@/components/common/page-header'
import { SectionHeading } from '@/components/common/section-heading'
import { WDTaggerResultBlock } from '@/components/common/wd-tagger-result-block'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  downloadConvertedWebP,
  downloadRewrittenImage,
  extractImageKaloscopePreview,
  extractImageMetadataPreview,
  extractImageTaggerPreview,
  uploadMultipleImages,
  type AutoTestKaloscopeResult,
  type AutoTestTaggerResult,
  type UploadBatchResult,
  type UploadTransferProgress,
} from '@/lib/api'
import { getImageExtractedPromptCards } from '@/lib/image-extracted-prompts'
import { getThemeToneTextStyle } from '@/lib/theme-tones'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { MetadataRewriteForm } from '../metadata/components/metadata-rewrite-form'
import { buildMetadataRewritePatch, useMetadataRewriteDraft } from '../metadata/use-metadata-rewrite-draft'
import { formatBytes, getImageGenerationParamItems } from '../images/components/detail/image-detail-utils'
import { useDropZoneState } from './use-drop-zone-state'

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,image/bmp,image/gif'
const UPLOAD_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska`
const MAX_VISIBLE_FILES = 6

type ExtractAction = 'prompt' | 'tagger' | 'kaloscope' | 'all'
type ManualExtractAction = 'all' | 'tagger' | 'kaloscope'

function formatDimensions(width?: number | null, height?: number | null) {
  if (!width || !height) return '—'
  return `${width} × ${height}`
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-surface-container p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 min-w-0 whitespace-pre-wrap break-all text-sm text-foreground">{value}</div>
    </div>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-container">
      <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${percent}%` }} />
    </div>
  )
}

interface DropSurfaceProps {
  active: boolean
  ariaLabel: string
  onClick: () => void
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnter: (event: DragEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void
}

function DropSurface({ active, ariaLabel, onClick, onDrop, onDragEnter, onDragOver, onDragLeave }: DropSurfaceProps) {
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

export function UploadPage() {
  const { showSnackbar } = useSnackbar()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const extractInputRef = useRef<HTMLInputElement | null>(null)

  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadResult, setUploadResult] = useState<UploadBatchResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadTransferProgress | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const [extractFile, setExtractFile] = useState<File | null>(null)
  const [extractPreviewUrl, setExtractPreviewUrl] = useState<string | null>(null)
  const [extractResult, setExtractResult] = useState<ImageRecord | null>(null)
  const [taggerResult, setTaggerResult] = useState<AutoTestTaggerResult | null>(null)
  const [kaloscopeResult, setKaloscopeResult] = useState<AutoTestKaloscopeResult | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [activeExtractAction, setActiveExtractAction] = useState<ExtractAction | null>(null)
  const [selectedExtractAction, setSelectedExtractAction] = useState<ManualExtractAction>('all')
  const [isConvertingWebP, setIsConvertingWebP] = useState(false)
  const [isRewritingMetadata, setIsRewritingMetadata] = useState(false)
  const [isRewritePanelOpen, setIsRewritePanelOpen] = useState(false)
  const { draft: rewriteDraft, patchDraft: patchRewriteDraft } = useMetadataRewriteDraft(extractFile, extractResult)
  const isDesktopPageLayout = useDesktopPageLayout()

  useEffect(() => {
    if (!extractFile) {
      setExtractPreviewUrl(null)
      return
    }

    const previewUrl = URL.createObjectURL(extractFile)
    setExtractPreviewUrl(previewUrl)

    return () => {
      URL.revokeObjectURL(previewUrl)
    }
  }, [extractFile])

  const extractedPromptCards = useMemo(() => {
    if (!extractResult) {
      return []
    }

    return getImageExtractedPromptCards(extractResult)
  }, [extractResult])

  const extractedGenerationParamItems = useMemo(() => {
    if (!extractResult) {
      return []
    }

    return getImageGenerationParamItems(extractResult)
  }, [extractResult])

  const uploadTotalSize = useMemo(() => uploadFiles.reduce((sum, file) => sum + file.size, 0), [uploadFiles])
  const uploadPercent = uploadProgress?.percent ?? (uploadResult ? 100 : 0)
  const extractBusy = activeExtractAction !== null || isConvertingWebP || isRewritingMetadata

  const resetUploadState = () => {
    setUploadResult(null)
    setUploadError(null)
    setUploadProgress(null)
  }

  const applyUploadFiles = (files: File[]) => {
    setUploadFiles(files)
    resetUploadState()
  }

  const resetExtractResults = () => {
    setExtractResult(null)
    setTaggerResult(null)
    setKaloscopeResult(null)
    setExtractError(null)
    setActiveExtractAction(null)
  }

  const applyExtractFile = (file: File | null) => {
    setExtractFile(file)
    setIsRewritePanelOpen(false)
    resetExtractResults()
  }

  const handleUploadFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyUploadFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleExtractFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyExtractFile(event.target.files?.[0] ?? null)
    event.target.value = ''
  }

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || isUploading) {
      return
    }

    setIsUploading(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ loaded: 0, total: uploadTotalSize || null, percent: 0 })

    try {
      const result = await uploadMultipleImages(uploadFiles, (progress) => {
        setUploadProgress(progress)
      })
      setUploadResult(result)
      setUploadProgress((current) => ({
        loaded: current?.total ?? uploadTotalSize,
        total: current?.total ?? uploadTotalSize,
        percent: 100,
      }))
      showSnackbar({
        message: result.failed_count > 0 ? `${result.successful}개 저장, ${result.failed_count}개 실패했어.` : `${result.successful}개 저장 완료.`,
        tone: result.failed_count > 0 ? 'error' : 'info',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '업로드에 실패했어.'
      setUploadError(message)
      showSnackbar({ message, tone: 'error' })
    } finally {
      setIsUploading(false)
    }
  }

  useEffect(() => {
    if (!extractFile) {
      return
    }

    let cancelled = false

    setActiveExtractAction('prompt')
    setExtractError(null)
    setExtractResult(null)

    void extractImageMetadataPreview(extractFile)
      .then((result) => {
        if (cancelled) {
          return
        }

        setExtractResult(result)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : '프롬프트 추출에 실패했어.'
        setExtractError(message)
        showSnackbar({ message, tone: 'error' })
      })
      .finally(() => {
        if (cancelled) {
          return
        }

        setActiveExtractAction((current) => (current === 'prompt' ? null : current))
      })

    return () => {
      cancelled = true
    }
  }, [extractFile, showSnackbar])

  const handleRunSelectedExtract = async () => {
    await handleExtractAction(selectedExtractAction)
  }

  const handleConvertWebP = async () => {
    if (!extractFile || extractBusy) {
      return
    }

    setIsConvertingWebP(true)
    setExtractError(null)

    try {
      const result = await downloadConvertedWebP(extractFile)
      const message = result.metadataState === 'preserved'
        ? `WebP 변환 완료. 메타 보존된 파일(${result.fileName}) 다운로드를 시작했어.`
        : `WebP 변환 완료. 파일(${result.fileName}) 다운로드를 시작했어.`
      showSnackbar({ message, tone: 'info' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WebP 변환에 실패했어.'
      setExtractError(message)
      showSnackbar({ message, tone: 'error' })
    } finally {
      setIsConvertingWebP(false)
    }
  }

  const handleRewriteMetadata = async () => {
    if (!extractFile || extractBusy) {
      return
    }

    setIsRewritingMetadata(true)
    setExtractError(null)

    try {
      const result = await downloadRewrittenImage(extractFile, {
        format: rewriteDraft.format,
        metadataPatch: buildMetadataRewritePatch(rewriteDraft),
      })

      const message = result.rewriteState === 'patched'
        ? `메타 수정 파일(${result.fileName}) 다운로드를 시작했어. XMP ${result.xmpState}, EXIF ${result.exifState}.`
        : `메타 보존 파일(${result.fileName}) 다운로드를 시작했어. XMP ${result.xmpState}, EXIF ${result.exifState}.`
      showSnackbar({ message, tone: 'info' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '메타 수정에 실패했어.'
      setExtractError(message)
      showSnackbar({ message, tone: 'error' })
    } finally {
      setIsRewritingMetadata(false)
    }
  }

  const handleExtractAction = async (action: ExtractAction) => {
    if (!extractFile || extractBusy) {
      return
    }

    setActiveExtractAction(action)
    setExtractError(null)

    try {
      if (action === 'prompt') {
        setExtractResult(null)
        const result = await extractImageMetadataPreview(extractFile)
        setExtractResult(result)
        showSnackbar({ message: '프롬프트 추출 완료.', tone: 'info' })
        return
      }

      if (action === 'tagger') {
        setTaggerResult(null)
        const result = await extractImageTaggerPreview(extractFile)
        setTaggerResult(result)
        showSnackbar({ message: '자동 추출 완료.', tone: 'info' })
        return
      }

      if (action === 'kaloscope') {
        setKaloscopeResult(null)
        const result = await extractImageKaloscopePreview(extractFile)
        setKaloscopeResult(result)
        showSnackbar({ message: '작가 추출 완료.', tone: 'info' })
        return
      }

      setExtractResult(null)
      setTaggerResult(null)
      setKaloscopeResult(null)

      const [promptState, taggerState, kaloscopeState] = await Promise.allSettled([
        extractResult ? Promise.resolve(extractResult) : extractImageMetadataPreview(extractFile),
        extractImageTaggerPreview(extractFile),
        extractImageKaloscopePreview(extractFile),
      ])

      const errors: string[] = []

      if (promptState.status === 'fulfilled') {
        setExtractResult(promptState.value)
      } else {
        errors.push(promptState.reason instanceof Error ? promptState.reason.message : '프롬프트 추출 실패')
      }

      if (taggerState.status === 'fulfilled') {
        setTaggerResult(taggerState.value)
      } else {
        errors.push(taggerState.reason instanceof Error ? taggerState.reason.message : '자동 추출 실패')
      }

      if (kaloscopeState.status === 'fulfilled') {
        setKaloscopeResult(kaloscopeState.value)
      } else {
        errors.push(kaloscopeState.reason instanceof Error ? kaloscopeState.reason.message : '작가 추출 실패')
      }

      if (errors.length > 0) {
        const message = errors[0]
        setExtractError(message)
        showSnackbar({ message, tone: 'error' })
      } else {
        showSnackbar({ message: '한번에 추출 완료.', tone: 'info' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '추출에 실패했어.'
      setExtractError(message)
      showSnackbar({ message, tone: 'error' })
    } finally {
      setActiveExtractAction(null)
    }
  }

  const uploadDropZone = useDropZoneState<HTMLButtonElement>({
    onDropFiles: (files) => {
      if (files.length === 0) {
        return
      }

      applyUploadFiles(files)
    },
  })

  const extractDropZone = useDropZoneState<HTMLButtonElement>({
    onDropFiles: (files) => {
      const imageFile = files.find((file) => file.type.startsWith('image/')) ?? files[0] ?? null

      if (!imageFile) {
        return
      }

      if (!imageFile.type.startsWith('image/')) {
        showSnackbar({ message: '이미지 파일만 미리보기할 수 있어.', tone: 'error' })
        return
      }

      applyExtractFile(imageFile)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Upload" />

      <div className="space-y-6">
        <section>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 px-4 pb-4"
                heading="파일 업로드"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setUploadFiles([])
                        resetUploadState()
                      }}
                      disabled={uploadFiles.length === 0 && !uploadResult && !uploadError}
                    >
                      초기화
                    </Button>
                    <Button type="button" onClick={handleUpload} disabled={uploadFiles.length === 0 || isUploading}>
                      {isUploading ? '업로드 중…' : `업로드${uploadFiles.length > 0 ? ` (${uploadFiles.length})` : ''}`}
                    </Button>
                  </div>
                }
              />

              <div className="space-y-4 px-4 pt-4">
                <input ref={uploadInputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" onChange={handleUploadFileChange} />

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
                  <div className="space-y-3 rounded-sm bg-surface-low p-4">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{uploadFiles.length}개</Badge>
                      <Badge variant="outline">{formatBytes(uploadTotalSize)}</Badge>
                    </div>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {uploadFiles.slice(0, MAX_VISIBLE_FILES).map((file) => (
                        <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center justify-between gap-3 rounded-sm bg-surface-container px-3 py-2">
                          <span className="min-w-0 truncate text-foreground">{file.name}</span>
                          <span className="shrink-0 text-xs">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                      {uploadFiles.length > MAX_VISIBLE_FILES ? <div className="text-xs">…{uploadFiles.length - MAX_VISIBLE_FILES}개 더 있음</div> : null}
                    </div>
                  </div>
                ) : null}

                {(isUploading || uploadProgress || uploadResult) ? (
                  <div className="space-y-3 rounded-sm bg-surface-low p-4">
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
                  </div>
                ) : null}

                {uploadError ? (
                  <Alert variant="destructive">
                    <AlertTitle>업로드 실패</AlertTitle>
                    <AlertDescription>{uploadError}</AlertDescription>
                  </Alert>
                ) : null}

                {uploadResult ? (
                  <div className="space-y-4 rounded-sm bg-surface-low p-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">성공 {uploadResult.successful}</Badge>
                      <Badge variant={uploadResult.failed_count > 0 ? 'outline' : 'secondary'}>실패 {uploadResult.failed_count}</Badge>
                    </div>

                    {uploadResult.uploaded.length > 0 ? (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        {uploadResult.uploaded.slice(0, MAX_VISIBLE_FILES).map((file) => (
                          <div key={`${file.filename}:${file.upload_date}`} className="rounded-sm bg-surface-container px-3 py-3">
                            <div className="break-all text-foreground">{file.original_name}</div>
                            <div className="mt-1 text-xs">{formatDimensions(file.width, file.height)} · {formatBytes(file.file_size)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {uploadResult.failed.length > 0 ? (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        {uploadResult.failed.map((file) => (
                          <div key={`${file.filename}:${file.error}`} className="rounded-sm bg-surface-container px-3 py-3">
                            <div className="break-all text-foreground">{file.filename}</div>
                            <div className="mt-1 text-xs" style={getThemeToneTextStyle('negative')}>{file.error}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <SectionHeading
                variant="inside"
                className="border-b border-border/70 px-4 pb-4"
                heading="미리보기 / 추출"
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="ghost" onClick={() => applyExtractFile(null)} disabled={!extractFile && !extractResult && !taggerResult && !kaloscopeResult && !extractError}>
                      초기화
                    </Button>
                    <Button type="button" variant="outline" onClick={handleConvertWebP} disabled={!extractFile || extractBusy}>
                      <Download className="h-4 w-4" />
                      {isConvertingWebP ? 'WebP 변환 중…' : 'WebP 변환'}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleRewriteMetadata} disabled={!extractFile || extractBusy}>
                      <Download className="h-4 w-4" />
                      {isRewritingMetadata ? '메타 수정 중…' : '메타 수정'}
                    </Button>
                    <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 sm:flex-none">
                      <Select
                        className="min-w-[140px] flex-1 sm:w-40 sm:flex-none"
                        value={selectedExtractAction}
                        onChange={(event) => setSelectedExtractAction(event.target.value as ManualExtractAction)}
                        disabled={!extractFile || extractBusy}
                      >
                        <option value="all">전체 추출</option>
                        <option value="tagger">자동 추출</option>
                        <option value="kaloscope">작가 추출</option>
                      </Select>
                      <Button type="button" onClick={handleRunSelectedExtract} disabled={!extractFile || extractBusy}>
                        {activeExtractAction === selectedExtractAction ? '추출 중…' : '추출 실행'}
                      </Button>
                    </div>
                  </div>
                }
              />

              <div className="space-y-4 px-4 pt-4">
                <input ref={extractInputRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handleExtractFileChange} />

                <div className="rounded-sm bg-surface-low">
                  <DropSurface
                    ariaLabel="미리보기할 이미지 선택"
                    active={extractDropZone.isDragActive}
                    onClick={() => extractInputRef.current?.click()}
                    onDrop={extractDropZone.handleDrop}
                    onDragEnter={extractDropZone.handleDragEnter}
                    onDragOver={extractDropZone.handleDragOver}
                    onDragLeave={extractDropZone.handleDragLeave}
                  />
                </div>

                {extractFile ? (
                  <div className={cn('grid gap-4', isDesktopPageLayout ? 'grid-cols-2 items-start' : 'grid-cols-1')}>
                    <div className="space-y-4">
                      <div className="space-y-4 rounded-sm bg-surface-low p-4">
                        {extractPreviewUrl ? (
                          <div className="overflow-hidden rounded-sm bg-surface-container p-4">
                            <img src={extractPreviewUrl} alt={extractFile.name} className="max-h-[420px] w-full object-contain" />
                          </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-3">
                          <SummaryTile label="file" value={extractFile.name} />
                          <SummaryTile label="size" value={formatBytes(extractFile.size)} />
                          <SummaryTile label="type" value={extractFile.type || '—'} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-sm bg-surface-low p-4">
                        <div className="rounded-sm bg-surface-container p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">메타 수정</div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setIsRewritePanelOpen((current) => !current)}>
                              {isRewritePanelOpen ? '접기' : '펼치기'}
                            </Button>
                          </div>

                          {isRewritePanelOpen ? (
                            <div className="mt-4 border-t border-border pt-4">
                              <MetadataRewriteForm draft={rewriteDraft} disabled={extractBusy} showHeader={false} onDraftChange={patchRewriteDraft} />
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {extractResult ? (
                        <div className="space-y-4 rounded-sm bg-surface-low p-4">
                          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                            <SummaryTile label="dimensions" value={formatDimensions(extractResult.width, extractResult.height)} />
                            <SummaryTile label="size" value={formatBytes(extractResult.file_size)} />
                            <SummaryTile label="tool" value={extractResult.ai_metadata?.ai_tool || '—'} />
                            <SummaryTile label="model" value={extractResult.ai_metadata?.model_name || '—'} />
                            {extractedGenerationParamItems.map((item) => (
                              <SummaryTile key={item.id} label={item.label} value={item.value} />
                            ))}
                          </div>

                          {extractResult.ai_metadata?.lora_models?.length ? (
                            <div className="rounded-sm bg-surface-container p-4">
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
                            <div className="rounded-sm bg-surface-container p-4">
                              <ExtractedPromptSections items={extractedPromptCards} />
                            </div>
                          ) : (
                            <div className="rounded-sm bg-surface-container px-4 py-3 text-sm text-muted-foreground">표시할 프롬프트가 없어.</div>
                          )}
                        </div>
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
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
