import type { ComponentProps } from 'react'
import { OverlayCard } from './overlay-card'
import { avatarInitialFill } from '@/features/codex-chat/chat-profile-avatar'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'

/**
 * A character's portrait card (appearance settings, catalog characters, chat profiles) on the shared overlay card.
 * Without a picture the frame shows the name's first letter in its avatar colour.
 */
export function CharacterCard({ name, mediaSrc, crop, ...cardProps }: {
  name: string
  mediaSrc?: string | null
  crop?: ComponentProps<typeof ChatProfileImage>['crop']
} & Omit<ComponentProps<typeof OverlayCard>, 'media' | 'label' | 'title'>) {
  const fill = avatarInitialFill(name)
  const fallback = (
    <span className="flex size-full items-center justify-center text-5xl font-bold" style={{ backgroundColor: `color-mix(in srgb, ${fill} 24%, var(--surface-low))`, color: fill }} aria-hidden="true">
      {Array.from(name.trim())[0] ?? '?'}
    </span>
  )
  return <OverlayCard {...cardProps} label={name} title={name} media={<ChatProfileImage src={mediaSrc} crop={crop} fallback={fallback} />} />
}
