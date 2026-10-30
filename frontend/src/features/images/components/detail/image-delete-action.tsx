import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { removeDeletedImagesFromListCaches } from '@/features/images/image-list-cache'
import { useImageDeleteUndo } from '@/features/images/use-image-delete-undo'
import { useI18n } from '@/i18n'
import { withChatMediaDeleteWarning } from '@/features/images/chat-media-delete-warning'
import { deleteImagesBulk } from '@/lib/api-images'
import type { ImageRecord } from '@/types/image'

interface ImageDeleteActionProps {
  image?: ImageRecord
  className?: string
  /** `ghost` in page toolbars, `overlay` when the button sits on the photo stage (viewer toolbar). */
  variant?: 'ghost' | 'secondary' | 'overlay'
  /** Called after the image is in the Recycle Bin, e.g. to step the viewer or leave the detail page. */
  onDeleted?: (compositeHash: string) => void
}

/** Shared image deletion feature, independent of page access. */
export function useCanDeleteImages() {
  return useImagePermissions().canDeleteImages
}

/** Move one image to the Recycle Bin after a destructive confirm. Renders nothing without the permission. */
export function ImageDeleteAction({ image, className, variant = 'secondary', onDeleted }: ImageDeleteActionProps) {
  const action = useImageDeleteMenuAction(image, onDeleted)

  if (!action) {
    return null
  }

  return (
    <IconButton
      label={action.label}
      size="icon-sm"
      variant={variant === 'overlay' ? 'overlay' : 'destructive-ghost'}
      className={className}
      onClick={action.onSelect}
      disabled={action.disabled}
    >
      <Trash2 className="h-4 w-4" />
    </IconButton>
  )
}

export function useImageDeletion(image: ImageRecord | undefined, onDeleted?: (compositeHash: string) => void) {
  const queryClient = useQueryClient()
  const notifyImageDeleted = useImageDeleteUndo()
  const { t } = useI18n()
  const canDeleteImages = useCanDeleteImages()
  const [isDeleting, setIsDeleting] = useState(false)
  const compositeHash = typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null
  const deleteImage = async () => {
    if (!canDeleteImages || !compositeHash || isDeleting) throw new Error(t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }))
    try {
      setIsDeleting(true)
      const result = await deleteImagesBulk([compositeHash])
      if (result.details.deleted === 0) throw new Error(result.details.errors[0] ?? t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }))
      onDeleted?.(compositeHash)
      await removeDeletedImagesFromListCaches(queryClient, [compositeHash])
      notifyImageDeleted(result.details)
      if (result.details.failed) throw new Error(result.details.errors.join(', ') || t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }))
    } finally {
      setIsDeleting(false)
    }
  }
  return { canDeleteImages, compositeHash, isDeleting, deleteImage }
}

/** The same deletion as a ⋯ menu entry (destructive, confirm first); null without the permission. */
export function useImageDeleteMenuAction(image: ImageRecord | undefined, onDeleted?: (compositeHash: string) => void): (ActionMenuAction & { label: string }) | null {
  const { canDeleteImages, compositeHash, isDeleting, deleteImage } = useImageDeletion(image, onDeleted)
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  if (!canDeleteImages || !compositeHash) return null
  const handleDelete = async () => {
    if (isDeleting) return
    const confirmed = await confirm({
      title: t({ ko: '이미지 삭제', en: 'Delete image' }),
      description: await withChatMediaDeleteWarning(t({ ko: '이 이미지를 삭제할까? 삭제 보호가 켜져 있으면 휴지통으로 보내고 되돌릴 수 있어. 꺼져 있으면 영구 삭제돼.', en: 'Delete this image? With deletion protection on, files move to the Recycle Bin and can be undone. Otherwise they are permanently deleted.' }), [compositeHash], t),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) return
    try { await deleteImage() }
    catch (error) { showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }), tone: 'error' }) }
  }

  return {
    key: 'delete',
    icon: Trash2,
    label: isDeleting ? t({ ko: '삭제 중', en: 'Deleting' }) : t({ ko: '휴지통으로 보내기', en: 'Move to Recycle Bin' }),
    destructive: true,
    disabled: isDeleting,
    onSelect: () => void handleDelete(),
  }
}
