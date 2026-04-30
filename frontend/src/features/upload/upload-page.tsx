import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/common/page-header'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  downloadConvertedWebP,
  downloadRewrittenImage,
  extractImageKaloscopePreview,
  extractImageMetadataPreview,
  extractImageTaggerPreview,
  type AutoTestKaloscopeResult,
  type AutoTestTaggerResult,
} from '@/lib/api'
import { getImageExtractedPromptCards } from '@/lib/image-extracted-prompts'
import { useI18n } from '@/i18n'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import type { ImageRecord } from '@/types/image'
import { buildMetadataRewritePatch, useMetadataRewriteDraft } from '../metadata/use-metadata-rewrite-draft'
import { getImageGenerationParamItems } from '../images/components/detail/image-detail-utils'
import { UploadPageExtractSection, UploadPageSaveOptionsModal, UploadPageUploadSection } from './components/upload-page-sections'
import { useDropZoneState } from './use-drop-zone-state'
import { useUploadPageUploadFlow } from './use-upload-page-upload-flow'

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,image/bmp,image/gif'
const UPLOAD_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska`

type ExtractAction = 'prompt' | 'tagger' | 'kaloscope' | 'all'
type ManualExtractAction = 'all' | 'tagger' | 'kaloscope'

export function UploadPage() {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const extractInputRef = useRef<HTMLInputElement | null>(null)

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

    return getImageExtractedPromptCards(extractResult, t)
  }, [extractResult, t])

  const extractedGenerationParamItems = useMemo(() => {
    if (!extractResult) {
      return []
    }

    return getImageGenerationParamItems(extractResult)
  }, [extractResult])

  const {
    uploadFiles,
    setUploadFiles,
    uploadResult,
    uploadError,
    uploadProgress,
    isUploading,
    uploadImageSaveOptions,
    setUploadImageSaveOptions,
    pendingUploadSave,
    setPendingUploadSave,
    pendingUploadSaveInfo,
    setPendingUploadSaveInfo,
    uploadTotalSize,
    uploadPercent,
    applyUploadFiles,
    resetUploadState,
    handleUploadFileChange,
    handleConfirmUploadSave,
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

  return (
    <div className="space-y-6">
      <PageHeader title={t('pageAccessCatalog.upload')} />

      <div className="space-y-6">
        <UploadPageUploadSection
          uploadInputRef={uploadInputRef}
          uploadAccept={UPLOAD_ACCEPT}
          uploadFiles={uploadFiles}
          uploadResult={uploadResult}
          uploadError={uploadError}
          uploadProgress={uploadProgress}
          uploadPercent={uploadPercent}
          uploadTotalSize={uploadTotalSize}
          isUploading={isUploading}
          uploadDropZone={uploadDropZone}
          onUploadFileChange={handleUploadFileChange}
          onResetUpload={() => {
            setUploadFiles([])
            resetUploadState()
          }}
          onUpload={() => void handleUpload()}
        />

        <UploadPageExtractSection
          extractInputRef={extractInputRef}
          imageAccept={IMAGE_ACCEPT}
          extractFile={extractFile}
          extractPreviewUrl={extractPreviewUrl}
          extractResult={extractResult}
          taggerResult={taggerResult}
          kaloscopeResult={kaloscopeResult}
          extractError={extractError}
          activeExtractAction={activeExtractAction}
          selectedExtractAction={selectedExtractAction}
          isConvertingWebP={isConvertingWebP}
          isRewritingMetadata={isRewritingMetadata}
          isRewritePanelOpen={isRewritePanelOpen}
          rewriteDraft={rewriteDraft}
          extractBusy={extractBusy}
          isDesktopPageLayout={isDesktopPageLayout}
          extractedPromptCards={extractedPromptCards}
          extractedGenerationParamItems={extractedGenerationParamItems}
          extractDropZone={extractDropZone}
          onExtractFileChange={handleExtractFileChange}
          onResetExtract={() => applyExtractFile(null)}
          onConvertWebP={() => void handleConvertWebP()}
          onRewriteMetadata={() => void handleRewriteMetadata()}
          onSelectedExtractActionChange={setSelectedExtractAction}
          onRunSelectedExtract={() => void handleRunSelectedExtract()}
          onToggleRewritePanel={() => setIsRewritePanelOpen((current) => !current)}
          onRewriteDraftChange={patchRewriteDraft}
        />
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
