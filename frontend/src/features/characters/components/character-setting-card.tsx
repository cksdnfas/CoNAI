import { UserRound } from 'lucide-react'
import { MediaCard } from '@/components/common/media-card'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
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
  const placeholder = <span className="flex size-full items-center justify-center text-muted-foreground"><UserRound className="size-6" /></span>
  const card = (
    <MediaCard
      mediaClassName="aspect-[3/4] w-full"
      onClick={onOpen}
      onDoubleClick={onDoubleClick}
      selected={selected}
      aria-pressed={selected}
      media={setting.referenceHash
        ? <ChatProfileImage src={characterThumbnailUrl(setting.referenceHash)} fallback={placeholder} />
        : <ChatProfileImage src={avatarUrl} crop={setting.avatarCrop} fallback={placeholder} />}
      leading={<ChatProfileAvatar name={setting.name} imageUrl={avatarUrl} avatarCrop={setting.avatarHash ? setting.avatarCrop : null} engine="llm" size="sm" />}
      title={setting.name}
    />
  )
  return menu ? <ActionContextMenu entries={menu}>{card}</ActionContextMenu> : card
}
