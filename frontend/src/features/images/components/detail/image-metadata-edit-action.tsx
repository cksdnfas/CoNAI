import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Pencil } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconButton } from '@/components/ui/icon-button'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import { useImageViewModal } from './image-view-modal-context'

interface ImageMetadataEditActionProps {
  image?: ImageRecord
  /** `ghost` in page toolbars, `overlay` on the viewer's photo stage. */
  variant?: 'ghost' | 'overlay'
}

/** Open the metadata editor for one still image (closes the viewer first). Renders nothing for other media. */
export function ImageMetadataEditAction({ image, variant = 'ghost' }: ImageMetadataEditActionProps) {
  const { canEditMetadata, canOpenMetadataEditor } = useImagePermissions()
  const navigate = useNavigate()
  const location = useLocation()
  const imageViewModal = useImageViewModal()
  const { t } = useI18n()

  if (!canEditMetadata || !canOpenMetadataEditor || !image?.composite_hash || image.file_type !== 'image') {
    return null
  }

  const compositeHash = image.composite_hash

  return (
    <IconButton
      size="icon-sm"
      variant={variant}
      label={t({ ko: '메타 수정', en: 'Edit metadata' })}
      onClick={() => {
        const sourceState = prepareImageSourceState(location)
        imageViewModal?.closeImageView()
        navigate(`/images/${compositeHash}/metadata`, { state: sourceState })
      }}
    >
      <Pencil className="size-4" />
    </IconButton>
  )
}
