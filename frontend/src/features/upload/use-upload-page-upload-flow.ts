import { useQuery } from '@tanstack/react-query'
import { useState, type ChangeEvent } from 'react'
import { getAppSettings, uploadMultipleImages, type UploadBatchResult, type UploadTransferProgress } from '@/lib/api'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  loadImageSaveSourceInfo,
  shouldBypassImageSaveProcessing,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import type { ImageSaveSettings } from '@/types/settings'

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
  const uploadTotalSize = uploadFiles.reduce((sum, file) => sum + file.size, 0)
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
    setIsUploading(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ loaded: 0, total: files.reduce((sum, file) => sum + file.size, 0) || null, percent: 0 })

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
        loaded: current?.total ?? files.reduce((sum, file) => sum + file.size, 0),
        total: current?.total ?? files.reduce((sum, file) => sum + file.size, 0),
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

  const handleConfirmUploadSave = async () => {
    if (!pendingUploadSave) {
      return
    }

    try {
      setPendingUploadSave(null)
      setPendingUploadSaveInfo(null)
      await runUpload(pendingUploadSave.files, uploadImageSaveOptions)
    } catch (error) {
      const message = error instanceof Error ? error.message : '업로드용 이미지 저장 옵션을 적용하지 못했어.'
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
