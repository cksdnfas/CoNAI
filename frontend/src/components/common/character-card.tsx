import type { ComponentProps } from 'react'
import { OverlayCard } from './overlay-card'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'

/**
 * A character's portrait card (appearance settings, catalog characters, chat profiles) on the shared overlay card.
 * Without a picture the frame shows a quiet, neutral silhouette.
 */
export function CharacterCard({ name, mediaSrc, crop, ...cardProps }: {
  name: string
  mediaSrc?: string | null
  crop?: ComponentProps<typeof ChatProfileImage>['crop']
} & Omit<ComponentProps<typeof OverlayCard>, 'media' | 'label' | 'title'>) {
  const fallback = (
    <span className="flex size-full items-end justify-center bg-surface-low text-foreground/10" aria-hidden="true">
      <svg viewBox="0 0 120 160" className="h-5/6 w-4/5" fill="currentColor">
        <circle cx="60" cy="57" r="25" />
        <path d="M12 160c4-36 24-54 48-54s44 18 48 54z" />
      </svg>
    </span>
  )
  return <OverlayCard {...cardProps} label={name} title={name} media={<ChatProfileImage src={mediaSrc} crop={crop} fallback={fallback} />} />
}
