import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ChangeEvent } from 'react'
import { useI18n } from '@/i18n'
import { formatBytes } from '@/features/images/components/detail/image-detail-utils'
import { UploadRequestError, uploadMultipleImages, type UploadBatchResult, type UploadTransferProgress } from '@/lib/api-images'
import { getAppSettings } from '@/lib/api-settings-general'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  loadImageSaveSourceInfo,
  shouldBypassImageSaveProcessing,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import { UPLOAD_LIMITS } from '@/lib/upload-limits'
import type { ImageSaveSettings } from '@conai/shared'
import { planUploadBatches } from './upload-batches'
import { getUploadFileTotalSize } from './upload-file-summary'

const RATE_LIMIT_MAX_RETRIES = 2
const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 10
const RATE_LIMIT_MAX_WAIT_SECONDS = 60

/** Send one batch, waiting out upload rate limiting (429) a couple of times before giving up. */
async function uploadBatchWithRateLimitRetry(
  files: File[],
  onProgress: (progress: UploadTransferProgress) => void,
  imageSaveOptions: Parameters<typeof uploadMultipleImages>[2],
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await uploadMultipleImages(files, onProgress, imageSaveOptions)
    } catch (error) {
      if (!(error instanceof UploadRequestError) || error.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw error
      }

      const waitSeconds = Math.min(RATE_LIMIT_MAX_WAIT_SECONDS, error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS)
      await new Promise((resolve) => window.setTimeout(resolve, waitSeconds * 1000))
    }
  }
}

export type PendingUploadSaveState = {
  files: File[]
  processableFiles: File[]
}

/** Own upload-state, save-option prompting, and upload execution for the upload page. */
export function useUploadPageUploadFlow({
  showSnackbar,
}: {
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const { t, formatNumber } = useI18n()
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadResult, setUploadResult] = useState<UploadBatchResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadTransferProgress | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadImageSaveOptions, setUploadImageSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [pendingUploadSave, setPendingUploadSave] = useState<PendingUploadSaveState | null>(null)
  const [pendingUploadSaveInfo, setPendingUploadSaveInfo] = useState<ImageSaveSourceInfo | null>(null)

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const effectiveImageSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS
  const uploadTotalSize = useMemo(() => getUploadFileTotalSize(uploadFiles), [uploadFiles])
  const uploadPercent = uploadProgress?.percent ?? (uploadResult ? 100 : 0)

  const resetUploadState = () => {
    setUploadResult(null)
    setUploadError(null)
    setUploadProgress(null)
  }

  const applyUploadFiles = (files: File[]) => {
    setUploadFiles(files)
    resetUploadState()
  }

  const handleUploadFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyUploadFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  /** Explain a failed upload request in the user's language instead of echoing raw server text. */
  const describeUploadRequestError = (error: unknown) => {
    const status = error instanceof UploadRequestError ? error.status : null

    if (status === 413) {
      return t(
        {
          ko: '업로드 한도를 넘었어. 요청당 최대 {files}개, 합계 {total}, 파일당 {file}까지 올릴 수 있어.',
          en: 'Upload limit exceeded. Each request allows up to {files} files, {total} in total and {file} per file.',
        },
        {
          files: formatNumber(UPLOAD_LIMITS.maxFilesPerRequest),
          total: formatBytes(UPLOAD_LIMITS.maxRequestBytes),
          file: formatBytes(UPLOAD_LIMITS.maxFileBytes),
        },
      )
    }
    if (status === 415) {
      return t({ ko: '지원하지 않는 파일 형식이야.', en: 'Unsupported file type.' })
    }
    if (status === 429) {
      return t({ ko: '업로드 요청이 너무 많아. 잠시 후 다시 시도해줘.', en: 'Too many upload requests. Please try again shortly.' })
    }
    if (status === 0) {
      return t({ ko: '네트워크 오류로 업로드하지 못했어.', en: 'Upload failed because of a network error.' })
    }

    return error instanceof Error && error.message ? error.message : t('useUploadPageUploadFlow.uploadFailed')
  }

  const runUpload = async (files: File[], options?: ImageSaveSettings) => {
    const { batches, oversized } = planUploadBatches(files)
    const sendableBytes = batches.reduce((sum, batch) => sum + getUploadFileTotalSize(batch), 0)
    const imageSaveOptions = options
      ? {
          enabled: options.applyToUpload,
          format: options.defaultFormat,
          quality: options.quality,
          resizeEnabled: options.resizeEnabled,
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
        }
      : undefined

    const uploaded: UploadBatchResult['uploaded'] = []
    const failed: UploadBatchResult['failed'] = oversized.map((file) => ({
      filename: file.name,
      error: t(
        { ko: '파일이 너무 커. 파일당 최대 {limit}까지 올릴 수 있어.', en: 'File is too large. The per-file limit is {limit}.' },
        { limit: formatBytes(UPLOAD_LIMITS.maxFileBytes) },
      ),
    }))
    let firstRequestError: string | null = null
    let completedBytes = 0

    setIsUploading(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ loaded: 0, total: sendableBytes || null, percent: 0 })

    try {
      for (const batch of batches) {
        const batchBytes = getUploadFileTotalSize(batch)
        const reportBatchProgress = (progress: UploadTransferProgress) => {
          // Request bytes include multipart overhead; scale them onto this batch's file bytes.
          const batchLoaded = progress.total && progress.total > 0
            ? (progress.loaded / progress.total) * batchBytes
            : Math.min(progress.loaded, batchBytes)
          const loaded = Math.min(sendableBytes, completedBytes + batchLoaded)
          setUploadProgress({
            loaded,
            total: sendableBytes || null,
            percent: sendableBytes > 0 ? Math.min(100, Math.round((loaded / sendableBytes) * 100)) : null,
          })
        }

        try {
          const result = await uploadBatchWithRateLimitRetry(batch, reportBatchProgress, imageSaveOptions)
          uploaded.push(...result.uploaded)
          failed.push(...result.failed)
        } catch (error) {
          const message = describeUploadRequestError(error)
          firstRequestError ??= message
          failed.push(...batch.map((file) => ({ filename: file.name, error: message })))
        }

        reportBatchProgress({ loaded: 1, total: 1, percent: 100 })
        completedBytes += batchBytes
      }

      const result: UploadBatchResult = {
        uploaded,
        failed,
        total: files.length,
        successful: uploaded.length,
        failed_count: failed.length,
      }
      setUploadResult(result)
      setUploadProgress({ loaded: sendableBytes, total: sendableBytes || null, percent: 100 })

      if (result.successful === 0 && firstRequestError) {
        setUploadError(firstRequestError)
      }

      showSnackbar({
        message: result.failed_count > 0
          ? t({ ko: '{successful}개 저장, {failed}개 실패했어.', en: '{successful} saved, {failed} failed.' }, {
              successful: formatNumber(result.successful),
              failed: formatNumber(result.failed_count),
            })
          : t({ ko: '{successful}개 저장 완료.', en: '{successful} saved.' }, { successful: formatNumber(result.successful) }),
        tone: result.failed_count > 0 ? 'error' : 'info',
      })
    } catch (error) {
      const message = describeUploadRequestError(error)
      setUploadError(message)
      showSnackbar({ message, tone: 'error' })
    } finally {
      setIsUploading(false)
    }
  }

  const handleConfirmUploadSave = async () => {
    if (!pendingUploadSave) {
      return
    }

    try {
      setPendingUploadSave(null)
      setPendingUploadSaveInfo(null)
      await runUpload(pendingUploadSave.files, uploadImageSaveOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('useUploadPageUploadFlow.failedToApplyImageSave')
      setUploadError(message)
      showSnackbar({ message, tone: 'error' })
    }
  }

  const handleUpload = async () => {
    if (uploadFiles.length === 0 || isUploading) {
      return
    }

    const processableFiles = uploadFiles.filter((file) => !shouldBypassImageSaveProcessing(file))

    if (!effectiveImageSaveSettings.applyToUpload || processableFiles.length === 0) {
      await runUpload(uploadFiles)
      return
    }

    if (effectiveImageSaveSettings.alwaysShowDialog) {
      setUploadImageSaveOptions(effectiveImageSaveSettings)
      setPendingUploadSave({
        files: uploadFiles,
        processableFiles,
      })
      setPendingUploadSaveInfo(
        await loadImageSaveSourceInfo({
          source: processableFiles[0],
          sourceMimeType: processableFiles[0].type,
        }),
      )
      return
    }

    await runUpload(uploadFiles, effectiveImageSaveSettings)
  }

  return {
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
  }
}
