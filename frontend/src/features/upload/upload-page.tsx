import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FileDown, FileSearch, ImageDown, Library, RotateCcw, ScanSearch, Settings2, Upload } from 'lucide-react'
import { PageToolbar } from '@/components/common/page-toolbar'
import { SegmentedControl } from '@/components/common/segmented-control'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  downloadConvertedWebP,
  downloadRewrittenImage,
  extractImageKaloscopePreview,
  extractImageMetadataPreview,
  extractImageTaggerPreview,
} from '@/lib/api-images'
import type { AutoTestTaggerResult } from '@/lib/api-settings-tagger'
import type { AutoTestKaloscopeResult } from '@/lib/api-settings-kaloscope'
import { getImageExtractedPromptCards } from '@/lib/image-extracted-prompts'
import { shouldBypassImageSaveProcessing } from '@/lib/image-save-output'
import { createRandomUuid } from '@/lib/random-uuid'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import type { ImageRecord } from '@/types/image'
import { buildMetadataRewritePatch, useMetadataRewriteDraft } from '../metadata/use-metadata-rewrite-draft'
import { getImageGenerationParamItems } from '../images/components/detail/image-detail-utils'
import {
  UploadDropZone,
  UploadInspectDetails,
  UploadInspectPreview,
  UploadPageSaveOptionsModal,
  UploadQueueList,
} from './components/upload-page-sections'
import { useDropZoneState } from './use-drop-zone-state'
import { useUploadPageUploadFlow } from './use-upload-page-upload-flow'

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,image/bmp,image/gif'
const UPLOAD_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska`

type ExtractAction = 'prompt' | 'tagger' | 'kaloscope' | 'all'
type ManualExtractAction = 'all' | 'tagger' | 'kaloscope'
const MANUAL_EXTRACT_ACTIONS: Array<{ action: ManualExtractAction; labelKey: 'uploadPageSections.extractAll' | 'uploadPageSections.autoExtract' | 'uploadPageSections.artistExtract' }> = [
  { action: 'all', labelKey: 'uploadPageSections.extractAll' },
  { action: 'tagger', labelKey: 'uploadPageSections.autoExtract' },
  { action: 'kaloscope', labelKey: 'uploadPageSections.artistExtract' },
]
type UploadPageMode = 'library' | 'inspect'

export function UploadPage() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const [mode, setMode] = useState<UploadPageMode>('library')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const extractInputRef = useRef<HTMLInputElement | null>(null)

  const [extractFile, setExtractFile] = useState<File | null>(null)
  const [extractPreviewUrl, setExtractPreviewUrl] = useState<string | null>(null)
  const [extractResult, setExtractResult] = useState<ImageRecord | null>(null)
  const [taggerResult, setTaggerResult] = useState<AutoTestTaggerResult | null>(null)
  const [kaloscopeResult, setKaloscopeResult] = useState<AutoTestKaloscopeResult | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [activeExtractAction, setActiveExtractAction] = useState<ExtractAction | null>(null)
  const [isConvertingWebP, setIsConvertingWebP] = useState(false)
  const [isRewritingMetadata, setIsRewritingMetadata] = useState(false)
  const [isRewritePanelOpen, setIsRewritePanelOpen] = useState(false)
  const { draft: rewriteDraft, patchDraft: patchRewriteDraft } = useMetadataRewriteDraft(extractFile, extractResult)
  const isDesktopPageLayout = useDesktopPageLayout()
  const chatUploadResourceId = useMemo(() => ({ file: extractFile, id: createRandomUuid() }), [extractFile]).id
  useChatPageRegistration({
    kind: 'upload', title: t({ ko: '업로드·메타데이터 검사', en: 'Upload and metadata inspection' }), resourceId: chatUploadResourceId,
    fields: [
      { id: 'mode', label: t({ ko: '업로드 화면', en: 'Upload view' }), type: 'select', value: mode, options: ['library', 'inspect'] },
      ...(mode === 'inspect' && extractFile ? [
        { id: 'prompt', label: t({ ko: '프롬프트', en: 'Prompt' }), type: 'text' as const, value: rewriteDraft.prompt }, { id: 'negativePrompt', label: t({ ko: '부정 프롬프트', en: 'Negative prompt' }), type: 'text' as const, value: rewriteDraft.negativePrompt },
        { id: 'steps', label: 'Steps', type: 'number' as const, value: rewriteDraft.steps, min: 1, integer: true, allowEmpty: true }, { id: 'sampler', label: t({ ko: '샘플러', en: 'Sampler' }), type: 'text' as const, value: rewriteDraft.sampler }, { id: 'model', label: t({ ko: '모델', en: 'Model' }), type: 'text' as const, value: rewriteDraft.model }, { id: 'format', label: t({ ko: '파일 형식', en: 'File format' }), type: 'select' as const, value: rewriteDraft.format, options: ['png', 'jpeg', 'webp'] },
      ] : []),
    ],
    data: { selected: { fileName: extractFile?.name ?? '', bytes: extractFile?.size ?? 0 } },
    apply: (patch) => { const { mode: nextMode, ...metadata } = patch; if (nextMode !== undefined) setMode(nextMode as UploadPageMode); if (Object.keys(metadata).length) { patchRewriteDraft(metadata as Partial<typeof rewriteDraft>); setIsRewritePanelOpen(true) } },
  })


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

    return getImageExtractedPromptCards(extractResult, t)
  }, [extractResult, t])

  const extractedGenerationParamItems = useMemo(() => {
    if (!extractResult) {
      return []
    }

    return getImageGenerationParamItems(extractResult, t)
  }, [extractResult, t])

  const {
    uploadFiles,
    setUploadFiles,
    uploadResult,
    uploadError,
    uploadProgress,
    isUploading,
    uploadRunFiles,
    uploadImageSaveOptions,
    setUploadImageSaveOptions,
    pendingUploadSave,
    setPendingUploadSave,
    pendingUploadSaveInfo,
    setPendingUploadSaveInfo,
    applyUploadFiles,
    resetUploadState,
    handleUploadFileChange,
    handleConfirmUploadSave,
    handleOpenUploadSaveOptions,
    handleUpload,
  } = useUploadPageUploadFlow({ showSnackbar })
  const extractBusy = activeExtractAction !== null || isConvertingWebP || isRewritingMetadata

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

  const handleExtractFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyExtractFile(event.target.files?.[0] ?? null)
    event.target.value = ''
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

        const message = error instanceof Error ? error.message : t('uploadPage.promptExtractionFailed')
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
  }, [extractFile, showSnackbar, t])

  const handleConvertWebP = async () => {
    if (!extractFile || extractBusy) {
      return
    }

    setIsConvertingWebP(true)
    setExtractError(null)

    try {
      const result = await downloadConvertedWebP(extractFile)
      const message = result.metadataState === 'preserved'
        ? t({ ko: 'WebP 변환 완료. 메타 보존된 파일({fileName}) 다운로드를 시작했어.', en: 'WebP conversion complete. Downloading metadata-preserved file ({fileName}).' }, { fileName: result.fileName })
        : t({ ko: 'WebP 변환 완료. 파일({fileName}) 다운로드를 시작했어.', en: 'WebP conversion complete. Downloading file ({fileName}).' }, { fileName: result.fileName })
      showSnackbar({ message, tone: 'info' })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('uploadPage.webpConversionFailed')
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
        ? t({ ko: '메타 수정 파일({fileName}) 다운로드를 시작했어. XMP {xmpState}, EXIF {exifState}.', en: 'Downloading metadata-edited file ({fileName}). XMP {xmpState}, EXIF {exifState}.' }, { fileName: result.fileName, xmpState: result.xmpState, exifState: result.exifState })
        : t({ ko: '메타 보존 파일({fileName}) 다운로드를 시작했어. XMP {xmpState}, EXIF {exifState}.', en: 'Downloading metadata-preserved file ({fileName}). XMP {xmpState}, EXIF {exifState}.' }, { fileName: result.fileName, xmpState: result.xmpState, exifState: result.exifState })
      showSnackbar({ message, tone: 'info' })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('uploadPage.metadataEditFailed')
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
        showSnackbar({ message: t('uploadPage.promptExtractionComplete'), tone: 'info' })
        return
      }

      if (action === 'tagger') {
        setTaggerResult(null)
        const result = await extractImageTaggerPreview(extractFile)
        setTaggerResult(result)
        showSnackbar({ message: t('uploadPage.autoExtractionComplete'), tone: 'info' })
        return
      }

      if (action === 'kaloscope') {
        setKaloscopeResult(null)
        const result = await extractImageKaloscopePreview(extractFile)
        setKaloscopeResult(result)
        showSnackbar({ message: t('uploadPage.artistExtractionComplete'), tone: 'info' })
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
        errors.push(promptState.reason instanceof Error ? promptState.reason.message : t('uploadPage.promptExtractionFailed2'))
      }

      if (taggerState.status === 'fulfilled') {
        setTaggerResult(taggerState.value)
      } else {
        errors.push(taggerState.reason instanceof Error ? taggerState.reason.message : t('uploadPage.autoExtractionFailed'))
      }

      if (kaloscopeState.status === 'fulfilled') {
        setKaloscopeResult(kaloscopeState.value)
      } else {
        errors.push(kaloscopeState.reason instanceof Error ? kaloscopeState.reason.message : t('uploadPage.artistExtractionFailed'))
      }

      if (errors.length > 0) {
        const message = errors[0]
        setExtractError(message)
        showSnackbar({ message, tone: 'error' })
      } else {
        showSnackbar({ message: t('uploadPage.allExtractionComplete'), tone: 'info' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('uploadPage.extractionFailed')
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
        showSnackbar({ message: t('uploadPage.onlyImageFilesCanBe'), tone: 'error' })
        return
      }

      applyExtractFile(imageFile)
    },
  })

  const hasProcessableUploadFile = uploadFiles.some((file) => !shouldBypassImageSaveProcessing(file))
  const isInspectMode = mode === 'inspect'
  const dropZone = isInspectMode ? extractDropZone : uploadDropZone

  const libraryActions = (
    <>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={() => void handleOpenUploadSaveOptions()}
        disabled={!hasProcessableUploadFile || isUploading}
        label={t({ ko: '저장 옵션', en: 'Save options' })}
      >
        <Settings2 />
      </IconButton>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setUploadFiles([])
          resetUploadState()
        }}
        disabled={isUploading || (uploadFiles.length === 0 && !uploadResult && !uploadError)}
        label={t({ ko: '초기화', en: 'Reset' })}
      >
        <RotateCcw />
      </IconButton>
      <IconButton variant="default" size="icon-sm" className="ml-1" onClick={() => void handleUpload()} disabled={uploadFiles.length === 0 || isUploading} aria-busy={isUploading || undefined} label={isUploading
          ? t('uploadPageSections.uploading')
          : uploadFiles.length > 0
            ? t({ ko: '업로드 {count}', en: 'Upload {count}' }, { count: formatNumber(uploadFiles.length) })
            : t({ ko: '업로드', en: 'Upload' })}>
        <Upload />
      </IconButton>
    </>
  )

  const inspectActions = (
    <>
      <IconButton variant="ghost" size="icon-sm" onClick={() => void handleConvertWebP()} disabled={!extractFile || extractBusy} label={isConvertingWebP ? t('uploadPageSections.convertingWebp') : t('uploadPageSections.convertWebp')}>
        <ImageDown />
      </IconButton>
      <IconButton variant="ghost" size="icon-sm" onClick={() => void handleRewriteMetadata()} disabled={!extractFile || extractBusy} label={isRewritingMetadata ? t('uploadPageSections.editingMetadata') : t('uploadPageSections.editMetadata')}>
        <FileDown />
      </IconButton>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={() => applyExtractFile(null)}
        disabled={!extractFile && !extractResult && !taggerResult && !kaloscopeResult && !extractError}
        label={t({ ko: '초기화', en: 'Reset' })}
      >
        <RotateCcw />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!extractFile || extractBusy}>
          <IconButton
            variant="ghost"
            size="icon-sm"
            disabled={!extractFile || extractBusy}
            label={activeExtractAction !== null && activeExtractAction !== 'prompt'
              ? t('uploadPageSections.extracting')
              : t({ ko: '추출 실행: 태그·작가를 다시 뽑아봐', en: 'Run extraction: tags and artists' })}
          >
            <ScanSearch />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {MANUAL_EXTRACT_ACTIONS.map(({ action, labelKey }) => (
            <DropdownMenuItem key={action} onSelect={() => void handleExtractAction(action)}>
              {t(labelKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  return (
    <div className="mx-auto max-w-5xl">
      <PageToolbar
        start={(
          <SegmentedControl
            value={mode}
            onChange={(next) => setMode(next as UploadPageMode)}
            size="sm"
            semantics="tabs"
            ariaLabel={t({ ko: '업로드 방식', en: 'Upload mode' })}
            items={[
              { value: 'library', label: <Library />, ariaLabel: t({ ko: '라이브러리에 저장: 올린 파일을 라이브러리에 넣어', en: 'Save to library: upload files into the library' }) },
              { value: 'inspect', label: <FileSearch />, ariaLabel: t({ ko: '메타데이터만 보기: 저장 없이 이미지 정보만 확인해', en: 'Metadata only: inspect an image without saving it' }) },
            ]}
          />
        )}
        actions={isInspectMode ? inspectActions : libraryActions}
      />

      <input ref={uploadInputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" onChange={handleUploadFileChange} />
      <input ref={extractInputRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={handleExtractFileChange} />

      <div className="space-y-6">
        <UploadDropZone
          ariaLabel={isInspectMode ? t('uploadPageSections.chooseAnImageToPreview') : t('uploadPageSections.chooseFilesToUpload')}
          dropZone={dropZone}
          onClick={() => (isInspectMode ? extractInputRef : uploadInputRef).current?.click()}
        >
          {isInspectMode && extractFile && extractPreviewUrl ? <UploadInspectPreview file={extractFile} previewUrl={extractPreviewUrl} /> : undefined}
        </UploadDropZone>

        {isInspectMode ? (
          <UploadInspectDetails
            extractFile={extractFile}
            extractResult={extractResult}
            taggerResult={taggerResult}
            kaloscopeResult={kaloscopeResult}
            extractError={extractError}
            isRewritePanelOpen={isRewritePanelOpen}
            rewriteDraft={rewriteDraft}
            extractBusy={extractBusy}
            isDesktopPageLayout={isDesktopPageLayout}
            extractedPromptCards={extractedPromptCards}
            extractedGenerationParamItems={extractedGenerationParamItems}
            onToggleRewritePanel={() => setIsRewritePanelOpen((current) => !current)}
            onRewriteDraftChange={patchRewriteDraft}
          />
        ) : (
          <UploadQueueList
            uploadFiles={uploadFiles}
            uploadRunFiles={uploadRunFiles}
            uploadResult={uploadResult}
            uploadError={uploadError}
            uploadProgress={uploadProgress}
            isUploading={isUploading}
            onRemoveUploadFile={(index) => {
              setUploadFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
              resetUploadState()
            }}
          />
        )}
      </div>

      <UploadPageSaveOptionsModal
        open={pendingUploadSave !== null}
        options={uploadImageSaveOptions}
        sourceInfo={pendingUploadSaveInfo}
        isSaving={isUploading}
        onClose={() => {
          if (!isUploading) {
            setPendingUploadSave(null)
            setPendingUploadSaveInfo(null)
          }
        }}
        onOptionsChange={(patch) => setUploadImageSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmUploadSave()}
      />
    </div>
  )
}
