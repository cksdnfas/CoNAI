import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { removeDeletedImagesFromListCaches } from '@/features/images/image-list-cache'
import { useI18n } from '@/i18n'
import { deleteImagesBulk } from '@/lib/api-images'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'

interface ImageDeleteActionProps {
  image?: ImageRecord
  className?: string
  /** Called after the image is in the Recycle Bin, e.g. to step the viewer or leave the detail page. */
  onDeleted?: (compositeHash: string) => void
}

/** Same rule as the gallery selection bars: only admins can delete images. */
export function useCanDeleteImages() {
  const authStatusQuery = useAuthStatusQuery()
  return authStatusQuery.data?.isAdmin === true
}

/** Move one image to the Recycle Bin after a destructive confirm. Renders nothing without the permission. */
export function ImageDeleteAction({ image, className, onDeleted }: ImageDeleteActionProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const canDeleteImages = useCanDeleteImages()
  const [isDeleting, setIsDeleting] = useState(false)
  const compositeHash = typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null

  if (!canDeleteImages || !compositeHash) {
    return null
  }

  const handleDelete = async () => {
    if (isDeleting) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '휴지통으로 보내기', en: 'Move to Recycle Bin' }),
      description: t({ ko: '이 이미지를 휴지통으로 보낼까?', en: 'Move this image to the Recycle Bin?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      const result = await deleteImagesBulk([compositeHash])
      if (result.details.deleted === 0) {
        showSnackbar({
          message: result.details.errors[0] ?? t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }),
          tone: 'error',
        })
        return
      }

      showSnackbar({ message: t({ ko: '휴지통으로 보냈어.', en: 'Moved to the Recycle Bin.' }), tone: 'info' })
      onDeleted?.(compositeHash)
      await removeDeletedImagesFromListCaches(queryClient, [compositeHash])
    } catch (error) {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '이미지를 지우지 못했어.', en: 'Could not delete the image.' }),
        tone: 'error',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const label = isDeleting ? t({ ko: '삭제 중', en: 'Deleting' }) : t({ ko: '휴지통으로 보내기', en: 'Move to Recycle Bin' })

  return (
    <IconButton
      label={label}
      size="icon-sm"
      variant="secondary"
      className={cn(className, 'text-destructive hover:text-destructive')}
      onClick={() => void handleDelete()}
      disabled={isDeleting}
    >
      <Trash2 className="h-4 w-4" />
    </IconButton>
  )
}
