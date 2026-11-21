import type { ReactNode } from 'react'
import { ImageIcon, Star } from 'lucide-react'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { cn } from '@/lib/utils'

export type ImageChoice = {
  /** Identifies the image among the choices (a library hash, an owner's file id). */
  key: string
  /** The thumbnail's accessible name (several images can share a category, so callers add the position). */
  label: string
  src: string
  /** A star in the corner: the main image (a setting's reference image, a style's cover). */
  marked?: boolean
}

/**
 * Images to pick from when loading into a form (a setting's library images, a style's own copies): each thumbnail
 * toggles, the chosen ones carry a ring. The caller keeps the chosen keys and decides whether one or several may be chosen.
 */
export function ImageChoiceGrid({ images, chosen, onToggle, disabled = false, labelledBy, fallback }: {
  images: ImageChoice[]
  chosen: readonly string[]
  onToggle: (key: string) => void
  disabled?: boolean
  /** The caption's id (the group's accessible name). */
  labelledBy?: string
  /** Shown for a hidden, blocked or deleted image instead of a broken one. */
  fallback?: ReactNode
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {images.map((image) => {
        const isChosen = chosen.includes(image.key)
        return (
          // eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control
          <button
            key={image.key}
            type="button"
            disabled={disabled}
            aria-pressed={isChosen}
            aria-label={image.label}
            title={image.label}
            onClick={() => onToggle(image.key)}
            className={cn('relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed', isChosen ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'opacity-60 hover:opacity-100')}
          >
            <ChatProfileImage
              src={image.src}
              fallback={fallback ?? <span className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-6" /></span>}
            />
            {image.marked ? <span className="absolute top-0.5 left-0.5 rounded-sm bg-primary p-0.5 text-primary-foreground"><Star className="size-3 fill-current" /></span> : null}
          </button>
        )
      })}
    </div>
  )
}
