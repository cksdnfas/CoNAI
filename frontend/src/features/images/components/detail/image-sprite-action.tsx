import { Film } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'

/** Video only: ⋯ menu entry that opens the sprite tab with this video selected. */
export function useImageSpriteMenuAction(image?: ImageRecord): ActionMenuAction | null {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { canEditImages } = useImagePermissions()
  if (!canEditImages || !image?.composite_hash || !image.mime_type?.startsWith('video/')) return null
  const compositeHash = image.composite_hash
  return { key: 'sprite', icon: Film, label: t({ ko: '스프라이트로', en: 'Make sprites' }), onSelect: () => void navigate(`/sprite?video=${encodeURIComponent(compositeHash)}`) }
}
