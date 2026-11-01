import { Star } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { CharacterSettingSummary } from '@/lib/api-character-library'
import { characterThumbnailUrl } from '../character-library-shared'

/**
 * One appearance setting in the grid: its reference thumbnail (else the avatar crop) with the avatar and name below.
 * Thumbnails only; the originals load in the editor. A favorite shows a star (a key with `onToggleFavorite`).
 */
export function CharacterSettingCard({ setting, onOpen, onDoubleClick, menu, selected, onToggleFavorite }: {
  setting: CharacterSettingSummary
  onOpen: () => void
  onDoubleClick?: () => void
  /** Right-click / long-press actions; left out for plain picking. */
  menu?: ActionMenuEntry[]
  selected?: boolean
  onToggleFavorite?: () => void
}) {
  const { t } = useI18n()
  const avatarUrl = setting.avatarHash ? characterThumbnailUrl(setting.avatarHash) : null
  return (
    <CharacterCard
      name={setting.name}
      onOpen={onOpen}
      onDoubleClick={onDoubleClick}
      selected={selected}
      menu={menu}
      mediaSrc={setting.referenceHash ? characterThumbnailUrl(setting.referenceHash) : avatarUrl}
      crop={setting.referenceHash ? null : setting.avatarCrop}
      avatarProps={{ name: setting.name, imageUrl: avatarUrl, avatarCrop: setting.avatarHash ? setting.avatarCrop : null, engine: 'llm', size: 'sm' }}
    >
      {onToggleFavorite ? (
        <div className="absolute top-1 left-1">
          <IconButton size="icon-xs" variant="subtle" label={setting.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })} active={setting.favorite} onClick={onToggleFavorite}>
            <Star className={setting.favorite ? 'fill-current' : undefined} />
          </IconButton>
        </div>
      ) : setting.favorite ? <Star className="absolute top-2 left-2 size-3.5 fill-current text-warning" aria-label={t({ ko: '즐겨찾기', en: 'Favorite' })} /> : null}
    </CharacterCard>
  )
}
