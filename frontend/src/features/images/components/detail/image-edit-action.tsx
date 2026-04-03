import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePenLine } from 'lucide-react'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings, getExistingImageEditorSourceUrl, saveEditedImageToCanvas } from '@/lib/api'
import {
  DEFAULT_IMAGE_SAVE_SETTINGS,
  buildImageSaveOutput,
  loadImageSaveSourceInfo,
  type ImageSaveSourceInfo,
} from '@/lib/image-save-output'
import type { ImageRecord } from '@/types/image'
import type { ImageSaveSettings } from '@/types/settings'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

interface ImageEditActionProps {
  image?: ImageRecord
}

/** Render a reusable image edit action that saves the edited result into save/canvas. */
export function ImageEditAction({ image }: ImageEditActionProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [imageSaveOptions, setImageSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [pendingCanvasSaveDataUrl, setPendingCanvasSaveDataUrl] = useState<string | null>(null)
  const [pendingCanvasSaveInfo, setPendingCanvasSaveInfo] = useState<ImageSaveSourceInfo | null>(null)
  const fileId = typeof image?.file_id === 'number' && image.file_id > 0 ? image.file_id : null
  const sourceImageUrl = getExistingImageEditorSourceUrl(image)
  const canEditImage = Boolean(fileId && sourceImageUrl && image?.file_type === 'image')

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const effectiveImageSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

  const saveMutation = useMutation({
    mutationFn: async (payload: { sourceImageDataUrl: string; options: ImageSaveSettings }) => {
      const output = await buildImageSaveOutput(
        {
          source: payload.sourceImageDataUrl,
          sourceMimeType: 'image/png',
        },
        payload.options,
      )

      return saveEditedImageToCanvas(fileId as number, output.dataUrl, {
        format: output.format,
        quality: payload.options.quality,
      })
    },
    onSuccess: async (result) => {
      setIsEditorOpen(false)
      showSnackbar({ message: `편집본을 save/canvas에 저장했어: ${result.fileName}`, tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['image-attachment-save-images'] })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '편집 이미지를 저장하지 못했어.', tone: 'error' })
    },
  })

  const handleEditorSave = async (payload: { sourceImageDataUrl: string }) => {
    if (!effectiveImageSaveSettings.applyToCanvasSave) {
      await saveEditedImageToCanvas(fileId as number, payload.sourceImageDataUrl, {
        format: 'webp',
        quality: 90,
      })
      setIsEditorOpen(false)
      showSnackbar({ message: '편집본을 save/canvas에 저장했어.', tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['image-attachment-save-images'] })
      return
    }

    if (effectiveImageSaveSettings.alwaysShowDialog) {
      setImageSaveOptions(effectiveImageSaveSettings)
      setPendingCanvasSaveInfo(await loadImageSaveSourceInfo({ source: payload.sourceImageDataUrl, sourceMimeType: 'image/png' }))
      setPendingCanvasSaveDataUrl(payload.sourceImageDataUrl)
      return
    }

    await saveMutation.mutateAsync({ sourceImageDataUrl: payload.sourceImageDataUrl, options: effectiveImageSaveSettings })
  }

  const handleConfirmCanvasSave = async () => {
    if (!pendingCanvasSaveDataUrl) {
      return
    }

    await saveMutation.mutateAsync({
      sourceImageDataUrl: pendingCanvasSaveDataUrl,
      options: imageSaveOptions,
    })
    setPendingCanvasSaveDataUrl(null)
    setPendingCanvasSaveInfo(null)
  }

  if (!canEditImage) {
    return null
  }

  return (
    <>
      <Button size="icon-sm" variant="outline" onClick={() => setIsEditorOpen(true)} disabled={saveMutation.isPending} aria-label="이미지 편집" title="이미지 편집">
        <FilePenLine className="h-4 w-4" />
      </Button>

      {isEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditorModal
            open={isEditorOpen}
            title="Image Editor"
            sourceImageDataUrl={sourceImageUrl ?? undefined}
            sourceFileName={image?.original_file_path?.replace(/\\/g, '/').split('/').at(-1) || image?.composite_hash || 'image'}
            enableMaskEditing={false}
            onClose={() => {
              if (!saveMutation.isPending) {
                setIsEditorOpen(false)
              }
            }}
            onSave={async (payload) => {
              await handleEditorSave({ sourceImageDataUrl: payload.sourceImageDataUrl })
            }}
          />
        </Suspense>
      ) : null}

      <ImageSaveOptionsModal
        open={pendingCanvasSaveDataUrl !== null}
        title="이미지 저장"
        options={imageSaveOptions}
        sourceInfo={pendingCanvasSaveInfo}
        isSaving={saveMutation.isPending}
        onClose={() => {
          if (!saveMutation.isPending) {
            setPendingCanvasSaveDataUrl(null)
            setPendingCanvasSaveInfo(null)
          }
        }}
        onOptionsChange={(patch) => setImageSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmCanvasSave()}
      />
    </>
  )
}
