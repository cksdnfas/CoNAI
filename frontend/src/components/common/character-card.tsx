import type { ComponentProps, ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { MediaCard } from './media-card'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'

/** Shared appearance/profile card: portrait, avatar/name caption, selection, context menu and optional touch action. */
export function CharacterCard({ name, mediaSrc, crop, avatarProps, decorateAvatar, onOpen, menu, actionsButton = false, dimmed = false, children, ...cardProps }: {
  name: string
  mediaSrc?: string | null
  crop?: ComponentProps<typeof ChatProfileImage>['crop']
  avatarProps: ComponentProps<typeof ChatProfileAvatar>
  decorateAvatar?: (avatar: ReactNode) => ReactNode
  onOpen: () => void
  menu?: ActionMenuEntry[]
  actionsButton?: boolean
  dimmed?: boolean
  selected?: boolean
  children?: ReactNode
} & Pick<ComponentProps<'button'>, 'onDoubleClick' | 'draggable' | 'onDragStart' | 'onDragEnd'>) {
  const { t } = useI18n()
  const avatar = <ChatProfileAvatar {...avatarProps} />
  const card = <div className="relative min-w-0">
    <div className={dimmed ? 'opacity-50' : undefined}>
      <MediaCard {...cardProps} className="w-full" mediaClassName="aspect-[3/4] w-full" title={name} onClick={onOpen} aria-pressed={cardProps.selected}
        media={<ChatProfileImage src={mediaSrc} crop={crop} fallback={<span className="flex size-full items-center justify-center text-muted-foreground"><UserRound className="size-6" /></span>} />}
        leading={decorateAvatar ? decorateAvatar(avatar) : avatar} />
    </div>
    {menu && actionsButton ? <div className="absolute right-1 top-1"><ActionMenuButton entries={menu} label={t({ ko: '작업', en: 'Actions' })} /></div> : null}
    {children}
  </div>
  return menu ? <ActionContextMenu entries={menu}>{card}</ActionContextMenu> : card
}
