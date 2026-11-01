import { Check, Copy, Link2, SquarePen, Star } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import { OverlayCardHoverOnly } from '@/components/common/overlay-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { CharacterSettingSummary } from '@/lib/api-character-library'
import { characterThumbnailUrl } from '../character-library-shared'

/**
 * One appearance setting in the grid: its reference thumbnail (else the avatar crop) with the name, work and outfit
 * count over it. Thumbnails only; the originals load in the editor. Keys show for the handlers given: favorite,
 * select, and the hover actions (copy tags, edit); a favorite without a key shows a star.
 */
export function CharacterSettingCard({ setting, onOpen, onDoubleClick, menu, selected, onToggleFavorite, onToggleSelect, onCopyTags, onEdit }: {
  setting: CharacterSettingSummary
  onOpen: () => void
  onDoubleClick?: () => void
  /** Right-click / long-press actions; left out for plain picking. */
  menu?: ActionMenuEntry[]
  selected?: boolean
  onToggleFavorite?: () => void
  onToggleSelect?: () => void
  onCopyTags?: () => void
  onEdit?: () => void
}) {
  const { t } = useI18n()
  const favoriteLabel = setting.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })
  const subtitle = [setting.copyright, setting.outfitCount > 1 ? t({ ko: '의상 {count}벌', en: '{count} outfits' }, { count: setting.outfitCount }) : null].filter(Boolean).join(' · ')
  return (
    <CharacterCard
      name={setting.name}
      onOpen={onOpen}
      onDoubleClick={onDoubleClick}
      selected={selected}
      menu={menu}
      mediaSrc={setting.referenceHash ? characterThumbnailUrl(setting.referenceHash) : setting.avatarHash ? characterThumbnailUrl(setting.avatarHash) : null}
      crop={setting.referenceHash ? null : setting.avatarCrop}
      subtitle={subtitle || undefined}
      meta={setting.linkedProfileCount ? <span className="flex items-center gap-1" aria-label={t({ ko: '연결 프로필 {count}개', en: '{count} linked profiles' }, { count: setting.linkedProfileCount })}><Link2 />{setting.linkedProfileCount}</span> : undefined}
      topStart={onToggleFavorite ? (
        <OverlayCardHoverOnly shown={setting.favorite}>
          <IconButton size="icon-sm" variant="overlay" label={favoriteLabel} active={setting.favorite} onClick={onToggleFavorite}>
            <Star className={setting.favorite ? 'fill-current' : undefined} />
          </IconButton>
        </OverlayCardHoverOnly>
      ) : setting.favorite ? <Badge variant="overlay" size="sm" aria-label={favoriteLabel}><Star className="fill-current text-warning" /></Badge> : undefined}
      topEnd={onToggleSelect ? (
        <OverlayCardHoverOnly shown={Boolean(selected)}>
          <IconButton size="icon-sm" variant="overlay" label={t({ ko: '선택', en: 'Select' })} active={Boolean(selected)} onClick={onToggleSelect}><Check /></IconButton>
        </OverlayCardHoverOnly>
      ) : undefined}
      actions={onCopyTags || onEdit ? <>
        {onEdit ? <Button variant="overlay" size="compact" className="min-w-0 flex-1" onClick={onEdit}><SquarePen /><span className="truncate">{t({ ko: '편집', en: 'Edit' })}</span></Button> : null}
        {onCopyTags ? <IconButton variant="overlay" size="icon-sm" label={t({ ko: '태그 복사', en: 'Copy tags' })} onClick={onCopyTags}><Copy /></IconButton> : null}
      </> : undefined}
    />
  )
}
