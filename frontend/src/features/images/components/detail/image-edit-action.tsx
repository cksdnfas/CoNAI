import { Suspense, lazy, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FilePenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getExistingImageEditorSourceUrl, saveEditedImageToCanvas } from '@/lib/api'
import type { ImageRecord } from '@/types/image'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

interface ImageEditActionProps {
  image?: ImageRecord
}

/** Render a reusable image edit action that saves the edited result into save/canvas. */
export function ImageEditAction({ image }: ImageEditActionProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const fileId = typeof image?.file_id === 'number' && image.file_id > 0 ? image.file_id : null
  const sourceImageUrl = getExistingImageEditorSourceUrl(image)
  const canEditImage = Boolean(fileId && sourceImageUrl && image?.file_type === 'image')

  const saveMutation = useMutation({
    mutationFn: async (payload: { sourceImageDataUrl: string }) => saveEditedImageToCanvas(fileId as number, payload.sourceImageDataUrl, 90),
    onSuccess: async (result) => {
      setIsEditorOpen(false)
      showSnackbar({ message: `편집본을 save/canvas에 저장했어: ${result.fileName}`, tone: 'info' })
      await queryClient.invalidateQueries({ queryKey: ['image-attachment-save-images'] })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '편집 이미지를 저장하지 못했어.', tone: 'error' })
    },
  })

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
              await saveMutation.mutateAsync({ sourceImageDataUrl: payload.sourceImageDataUrl })
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}
