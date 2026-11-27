import { Check, Star } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import { OverlayCardHoverOnly } from '@/components/common/overlay-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { artStyleThumbnailUrl, type ArtStyleSummary } from '@/lib/api-art-styles'

/** Badges a card shows before "+N". */
const CARD_BADGES = 3

/**
 * One art style in the grid, on the appearance library's card: its cover thumbnail (none without the read right), the title
 * and description over it, its first badges and the image count. Favorite and select float in the top corners; the
 * rest is in the context menu.
 */
export function ArtStyleCard({ style, onOpen, onDoubleClick, menu, selected, open, disabled, onToggleFavorite, onToggleSelect }: {
  style: ArtStyleSummary
  onOpen: () => void
  onDoubleClick?: () => void
  /** Right-click / long-press actions; left out for plain picking. */
  menu?: ActionMenuEntry[]
  selected?: boolean
  open?: boolean
  disabled?: boolean
  onToggleFavorite?: () => void
  onToggleSelect?: () => void
}) {
  const { t } = useI18n()
  const favoriteLabel = style.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })
  const hidden = style.badges.length - CARD_BADGES
  return (
    <CharacterCard
      name={style.title}
      onOpen={onOpen}
      onDoubleClick={onDoubleClick}
      selected={selected}
      current={open}
      disabled={disabled}
      menu={menu}
      mediaSrc={style.coverImageId ? artStyleThumbnailUrl(style.id, style.coverImageId) : null}
      subtitle={style.description || undefined}
      badges={<>
        {style.badges.slice(0, CARD_BADGES).map((badge) => <Badge key={badge} variant="overlay" size="xs" casing="sentence">{badge}</Badge>)}
        {hidden > 0 ? <Badge variant="overlay" size="xs">+{hidden}</Badge> : null}
        {style.imageCount > 0 ? <Badge variant="overlay" size="xs">{t({ ko: '이미지 {count}', en: 'Images {count}' }, { count: style.imageCount })}</Badge> : null}
      </>}
      topStart={onToggleFavorite ? (
        <OverlayCardHoverOnly shown={style.favorite}>
          <IconButton size="icon-sm" variant="overlay" label={favoriteLabel} active={style.favorite} disabled={disabled} onClick={onToggleFavorite}>
            <Star className={style.favorite ? 'fill-current' : undefined} />
          </IconButton>
        </OverlayCardHoverOnly>
      ) : style.favorite ? <Badge variant="overlay" size="sm" aria-label={favoriteLabel}><Star className="fill-current text-warning" /></Badge> : undefined}
      topEnd={onToggleSelect ? (
        <OverlayCardHoverOnly shown={Boolean(selected)}>
          <IconButton size="icon-sm" variant="overlay" label={t({ ko: '선택', en: 'Select' })} active={Boolean(selected)} disabled={disabled} onClick={onToggleSelect}><Check /></IconButton>
        </OverlayCardHoverOnly>
      ) : undefined}
    />
  )
}
