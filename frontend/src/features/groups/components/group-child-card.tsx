import { useState } from 'react'
import { ArrowLeft, ChevronRight, Folder } from 'lucide-react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { useGroupPreviewImage } from '@/features/groups/hooks/use-group-preview-image'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'

interface GroupChildCardProps {
  group: GroupWithHierarchy
  previewSourceKey?: string
  loadPreviewImage?: (groupId: number) => Promise<ImageRecord | null>
  onOpen: (groupId: number) => void
  variant?: 'default' | 'back'
  titleOverride?: string
  subtitleOverride?: string
  cardStyle?: GroupExplorerCardStyle
}

/** Render a group-navigation card using the selected appearance style. */
export function GroupChildCard({
  group,
  previewSourceKey = 'default',
  loadPreviewImage,
  onOpen,
  variant = 'default',
  titleOverride,
  subtitleOverride,
  cardStyle = 'compact-row',
}: GroupChildCardProps) {
  const isBack = variant === 'back'
  const isDisabled = isBack ? false : (group.child_count ?? 0) === 0 && group.image_count === 0
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewQuery = useGroupPreviewImage({
    groupId: group.id,
    sourceKey: previewSourceKey,
    loadPreviewImage,
    enabled: !isBack && !isDisabled && !previewFailed,
  })

  const previewImage = previewFailed ? null : (previewQuery.data ?? null)
  const title = titleOverride ?? group.name
  const subtitle = subtitleOverride ?? `${group.image_count.toLocaleString('ko-KR')} images`

  const handleOpen = () => {
    if (!isDisabled) {
      onOpen(group.id)
    }
  }

  if (cardStyle === 'media-tile') {
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={isDisabled}
        className={cn(
          'group relative isolate block aspect-[5/6] w-full overflow-hidden rounded-sm bg-surface-container text-left transition-transform duration-300',
          isDisabled ? 'cursor-not-allowed opacity-45' : 'hover:-translate-y-0.5 hover:bg-surface-high',
        )}
      >
        {isBack ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface-lowest to-surface-high">
            <ArrowLeft className="h-12 w-12 text-muted-foreground transition-transform duration-300 group-hover:-translate-x-1" />
          </div>
        ) : previewImage ? (
          <ImagePreviewMedia
            image={previewImage}
            alt={group.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-surface-lowest to-surface-high">
            <Folder className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/42 to-transparent" />

        <div className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white/88 backdrop-blur-sm">
          <ChevronRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 space-y-1 p-3">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-[11px] text-white/82">{subtitle}</p>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={isDisabled}
      className={cn(
        'group flex w-full items-center gap-4 rounded-sm bg-surface-container p-4 text-left transition-colors',
        isDisabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-surface-high',
      )}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-low">
        {isBack ? (
          <ArrowLeft className="h-5 w-5 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
        ) : previewImage ? (
          <ImagePreviewMedia
            image={previewImage}
            alt={group.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <Folder className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
