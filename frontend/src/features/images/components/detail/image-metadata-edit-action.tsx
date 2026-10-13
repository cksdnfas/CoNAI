import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Pencil } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import { useImageViewModal } from './image-view-modal-context'

/** ⋯ menu entry that opens the metadata editor for one still image (closes the viewer first); null for other media. */
export function useImageMetadataEditMenuAction(image?: ImageRecord): ActionMenuAction | null {
  const { canEditMetadata, canOpenMetadataEditor } = useImagePermissions()
  const navigate = useNavigate()
  const location = useLocation()
  const imageViewModal = useImageViewModal()
  const { t } = useI18n()

  if (!canEditMetadata || !canOpenMetadataEditor || !image?.composite_hash || image.file_type !== 'image') {
    return null
  }

  const compositeHash = image.composite_hash

  return {
    key: 'metadata',
    icon: Pencil,
    label: t({ ko: '메타 수정', en: 'Edit metadata' }),
    onSelect: () => {
      const sourceState = prepareImageSourceState(location)
      imageViewModal?.closeImageView()
      navigate(`/images/${compositeHash}/metadata`, { state: sourceState })
    },
  }
}
