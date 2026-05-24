import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ChangeEvent } from 'react'
import { useI18n } from '@/i18n'
import { uploadMultipleImages, type UploadBatchResult, type UploadTransferProgress } from '@/lib/api-images'
import { getAppSettings } from '@/lib/api-settings'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  loadImageSaveSourceInfo,
  shouldBypassImageSaveProcessing,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import type { ImageSaveSettings } from '@/types/settings'
import { getUploadFileTotalSize } from './upload-file-summary'

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

  const runUpload = async (files: File[], options?: ImageSaveSettings) => {
    const totalSize = getUploadFileTotalSize(files)

    setIsUploading(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ loaded: 0, total: totalSize || null, percent: 0 })

    try {
      const result = await uploadMultipleImages(
        files,
        (progress) => {
          setUploadProgress(progress)
        },
        options
          ? {
              enabled: options.applyToUpload,
              format: options.defaultFormat,
              quality: options.quality,
              resizeEnabled: options.resizeEnabled,
              maxWidth: options.maxWidth,
              maxHeight: options.maxHeight,
            }
          : undefined,
      )
      setUploadResult(result)
      setUploadProgress((current) => ({
        loaded: current?.total ?? totalSize,
        total: current?.total ?? totalSize,
        percent: 100,
      }))
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
      const message = error instanceof Error ? error.message : t('useUploadPageUploadFlow.uploadFailed')
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
