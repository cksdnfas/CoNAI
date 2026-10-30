import { CharacterCard } from '@/components/common/character-card'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import type { CharacterSettingSummary } from '@/lib/api-character-library'
import { characterThumbnailUrl } from '../character-library-shared'

/**
 * One appearance setting in the grid: its reference thumbnail (else the avatar crop) with the avatar and name below.
 * Thumbnails only; the originals load in the editor.
 */
export function CharacterSettingCard({ setting, onOpen, onDoubleClick, menu, selected }: {
  setting: CharacterSettingSummary
  onOpen: () => void
  onDoubleClick?: () => void
  /** Right-click / long-press actions; left out for plain picking. */
  menu?: ActionMenuEntry[]
  selected?: boolean
}) {
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
    />
  )
}
