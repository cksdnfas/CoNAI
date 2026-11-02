import { Check, Copy, SquarePen, Star } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import { OverlayCardHoverOnly } from '@/components/common/overlay-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { CharacterSettingSummary } from '@/lib/api-character-library'
import { characterThumbnailUrl, localizedTagName } from '../character-library-shared'

/**
 * One appearance setting in the grid: its reference thumbnail (else the avatar crop) with the name, work and outfit
 * count over it. Thumbnails only; the originals load in the editor. Favorite and select float in the top corners;
 * edit and copy stay in the actions/context menu. A favorite without a key shows a star.
 */
export function CharacterSettingCard({ setting, onOpen, onDoubleClick, menu, selected, open, disabled, onToggleFavorite, onToggleSelect, onCopyTags, onEdit }: {
  setting: CharacterSettingSummary
  onOpen: () => void
  onDoubleClick?: () => void
  /** Right-click / long-press actions; left out for plain picking. */
  menu?: ActionMenuEntry[]
  selected?: boolean
  open?: boolean
  disabled?: boolean
  onToggleFavorite?: () => void
  onToggleSelect?: () => void
  onCopyTags?: () => void
  onEdit?: () => void
}) {
  const { t, language } = useI18n()
  const favoriteLabel = setting.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' })
  const subtitle = [setting.copyright ? localizedTagName(language, setting.copyright, setting.copyrightTranslated) : null, setting.outfitCount > 0 ? t({ ko: '의상 {count}벌', en: '{count} outfits' }, { count: setting.outfitCount }) : null].filter(Boolean).join(' · ')
  return (
    <CharacterCard
      name={setting.name}
      onOpen={onOpen}
      onDoubleClick={onDoubleClick}
      selected={selected}
      current={open}
      disabled={disabled}
      menu={menu ?? [
        onEdit ? { key: 'edit', label: t({ ko: '편집', en: 'Edit' }), icon: SquarePen, onSelect: onEdit } : null,
        onCopyTags ? { key: 'copy', label: t({ ko: '태그 복사', en: 'Copy tags' }), icon: Copy, onSelect: onCopyTags } : null,
      ]}
      mediaSrc={setting.referenceHash ? characterThumbnailUrl(setting.referenceHash) : setting.avatarHash ? characterThumbnailUrl(setting.avatarHash) : null}
      crop={setting.referenceHash ? null : setting.avatarCrop}
      subtitle={subtitle || undefined}
      badges={<>
        <Badge variant="overlay" size="xs">{t({ ko: '참고 {count}', en: 'Refs {count}' }, { count: setting.referenceCount })}</Badge>
        <Badge variant="overlay" size="xs">{t({ ko: '표정 {count}', en: 'Faces {count}' }, { count: setting.expressionCount })}</Badge>
      </>}
      topStart={onToggleFavorite ? (
        <OverlayCardHoverOnly shown={setting.favorite}>
          <IconButton size="icon-sm" variant="overlay" label={favoriteLabel} active={setting.favorite} disabled={disabled} onClick={onToggleFavorite}>
            <Star className={setting.favorite ? 'fill-current' : undefined} />
          </IconButton>
        </OverlayCardHoverOnly>
      ) : setting.favorite ? <Badge variant="overlay" size="sm" aria-label={favoriteLabel}><Star className="fill-current text-warning" /></Badge> : undefined}
      topEnd={onToggleSelect ? (
        <OverlayCardHoverOnly shown={Boolean(selected)}>
          <IconButton size="icon-sm" variant="overlay" label={t({ ko: '선택', en: 'Select' })} active={Boolean(selected)} disabled={disabled} onClick={onToggleSelect}><Check /></IconButton>
        </OverlayCardHoverOnly>
      ) : undefined}
    />
  )
}
