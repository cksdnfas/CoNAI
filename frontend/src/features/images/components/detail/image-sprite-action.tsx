import { Film } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { IconButton } from '@/components/ui/icon-button'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'

/** Video only: open the sprite tab with this video selected. */
export function ImageSpriteAction({ image }: { image?: ImageRecord }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { canEditImages } = useImagePermissions()
  if (!canEditImages || !image?.composite_hash || !image.mime_type?.startsWith('video/')) return null
  return (
    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '스프라이트로', en: 'Make sprites' })} onClick={() => void navigate(`/sprite?video=${encodeURIComponent(image.composite_hash!)}`)}>
      <Film className="size-4" />
    </IconButton>
  )
}
